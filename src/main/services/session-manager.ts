import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type {
  HarnessEvent,
  PermissionDecision,
  RelayEvent,
  SessionDetail,
  SessionRecord,
  SessionSummary,
  SetPermissionModeResult,
  StartSessionOptions,
  VisiblePermissionMode
} from '@shared/events'
import { ClaudeAgentRuntime } from '../runtime/claude-agent-runtime'
import { readSdkInfo, resolveClaudeExecutable } from '../runtime/binary'
import type { ConfigService } from './config-service'
import { SessionStore } from './session-store'

export class RelayError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'RelayError'
  }
}

interface SessionManagerOptions {
  isPackaged: boolean
  userDataDir: string
  emit: (event: RelayEvent) => void
}

const DEFAULT_TITLE = '新会话'

function titleFromText(text: string): string {
  const line = text.trim().split('\n')[0] ?? ''
  const clean = line.replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim()
  if (!clean) return DEFAULT_TITLE
  return clean.length > 32 ? `${clean.slice(0, 32)}…` : clean
}

interface PendingGrant {
  toolName: string
  /** False for plan approvals, whose suggestions only switch the mode. */
  toolLevel: boolean
}

export class SessionManager {
  private readonly runtime = new ClaudeAgentRuntime()
  private readonly store: SessionStore
  private current: SessionSummary | null = null
  private readonly permissionSuggestions = new Map<string, PendingGrant>()
  private seq = 0

  constructor(
    private readonly config: ConfigService,
    private readonly options: SessionManagerOptions
  ) {
    this.store = new SessionStore(options.userDataDir)
    this.runtime.onEvent((sessionId, event) => this.handleRuntimeEvent(sessionId, event))
  }

  getSdkInfo(): ReturnType<typeof readSdkInfo> {
    return readSdkInfo()
  }

  getCurrent(): SessionSummary | null {
    return this.current
  }

  getSessions(): SessionRecord[] {
    return this.store.list()
  }

  loadSession(sessionId: string): SessionDetail {
    const detail = this.store.load(sessionId)
    if (!detail) throw new RelayError('session_missing', '找不到这个会话')
    return detail
  }

  renameSession(sessionId: string, title: string): SessionRecord {
    const record = this.store.update(sessionId, { title })
    if (!record) throw new RelayError('session_missing', '找不到这个会话')
    return record
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (this.current?.id === sessionId) {
      await this.stopCurrent()
    }
    this.store.remove(sessionId)
  }

  async startSession(request: StartSessionOptions = {}): Promise<SessionSummary> {
    const existing = request.sessionId ? this.store.get(request.sessionId) : null
    if (request.sessionId && !existing) {
      throw new RelayError('session_missing', '找不到这个会话')
    }

    const settings = this.config.getSettings()
    const cwd = existing?.cwd ?? settings.workspace
    mkdirSync(cwd, { recursive: true })
    const effective = this.config.effectiveSettings(cwd)

    const apiKey =
      this.config.getApiKey() ??
      (!this.options.isPackaged ? process.env.RELAY_DEV_API_KEY?.trim() || null : null)
    if (!apiKey) {
      throw new RelayError('no_api_key', '尚未配置 DeepSeek API Key。请在设置中保存密钥。')
    }

    if (this.current) {
      await this.runtime.dispose(this.current.id)
      this.current = null
    }

    const record =
      existing ??
      this.store.create({
        id: crypto.randomUUID(),
        title: DEFAULT_TITLE,
        cwd,
        model: effective.model,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        cliSessionId: null,
        eventCount: 0
      })

    const summary: SessionSummary = {
      id: record.id,
      cwd: record.cwd,
      model: effective.model,
      startedAt: record.createdAt,
      cliVersion: null,
      resumed: Boolean(record.cliSessionId)
    }

    // Register the session before spawning so early runtime events (status,
    // session_started) are forwarded instead of dropped.
    this.current = summary

    try {
      await this.runtime.startSession({
        sessionId: record.id,
        cwd: record.cwd,
        model: effective.model,
        effort: effective.effort,
        permissionMode: effective.permissionMode,
        allowedTools: effective.allowedTools,
        systemPromptAppend: effective.systemPromptAppend ?? undefined,
        baseUrl: settings.baseUrl,
        apiKey,
        claudeConfigDir: join(this.options.userDataDir, 'claude-config'),
        cliSessionId: record.cliSessionId ?? undefined,
        executablePath: resolveClaudeExecutable(this.options.isPackaged)
      })
    } catch (error) {
      this.current = null
      const detail = error instanceof Error ? error.message : String(error)
      throw new RelayError('start_failed', `无法启动运行时：${detail}`)
    }

    this.store.update(record.id, { model: effective.model, updatedAt: Date.now() })
    return summary
  }

  send(text: string): void {
    if (!this.current) throw new RelayError('no_session', '尚未启动会话')
    const sessionId = this.current.id
    const record = this.store.get(sessionId)

    const envelope: RelayEvent = {
      sessionId,
      seq: (this.seq += 1),
      ts: Date.now(),
      event: { type: 'user_message', text }
    }
    this.store.appendEvent(sessionId, envelope)
    this.options.emit(envelope)

    if (record && (record.title === DEFAULT_TITLE || !record.title)) {
      this.store.update(sessionId, { title: titleFromText(text) })
    }

    this.runtime.send(sessionId, { text })
  }

  async interrupt(): Promise<void> {
    if (!this.current) return
    await this.runtime.interrupt(this.current.id)
  }

  /**
   * A live session switches immediately; with no session running the choice
   * becomes the app default that the next session picks up.
   */
  async setPermissionMode(mode: VisiblePermissionMode): Promise<SetPermissionModeResult> {
    if (this.current) {
      await this.runtime.setPermissionMode(this.current.id, mode)
      return { scope: 'session', mode }
    }
    this.config.updateSettings({ permissionMode: mode })
    return { scope: 'default', mode }
  }

  respondPermission(decision: PermissionDecision): void {
    if (decision.decision === 'always' && this.current) {
      const grant = this.permissionSuggestions.get(decision.requestId)
      if (grant?.toolLevel) {
        try {
          this.config.addWorkspaceAllowedTools(this.current.cwd, [grant.toolName])
        } catch {
          // A read-only workspace must not break the approval itself.
        }
      }
    }
    this.permissionSuggestions.delete(decision.requestId)
    this.runtime.respondPermission(decision)
  }

  denyPendingPermissions(reason: string): void {
    if (!this.current) return
    this.runtime.denyAllPermissions(this.current.id, reason)
  }

  async stopCurrent(): Promise<void> {
    if (!this.current) return
    const id = this.current.id
    await this.runtime.dispose(id)
    if (this.current?.id === id) this.current = null
    this.permissionSuggestions.clear()
  }

  async dispose(): Promise<void> {
    await this.runtime.disposeAll()
    this.current = null
    this.permissionSuggestions.clear()
  }

  private handleRuntimeEvent(sessionId: string, event: HarnessEvent): void {
    if (!this.current || this.current.id !== sessionId) return

    if (event.type === 'session_started') {
      this.current.cliVersion = event.cliVersion
      this.current.model = event.model
      this.current.cwd = event.cwd
      this.store.update(sessionId, {
        cliSessionId: event.sessionId,
        model: event.model,
        cwd: event.cwd,
        updatedAt: Date.now()
      })
    }

    if (event.type === 'permission_request') {
      this.permissionSuggestions.set(event.requestId, {
        toolName: event.toolName,
        toolLevel:
          event.toolName !== 'ExitPlanMode' &&
          !event.suggestions.some((entry) => entry.mode !== undefined)
      })
    }

    const envelope: RelayEvent = {
      sessionId,
      seq: (this.seq += 1),
      ts: Date.now(),
      event
    }
    this.store.appendEvent(sessionId, envelope)
    this.options.emit(envelope)
  }
}
