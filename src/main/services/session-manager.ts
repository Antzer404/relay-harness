import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type {
  HandoffDoc,
  HarnessEvent,
  PermissionDecision,
  RelayEvent,
  SessionDetail,
  SessionPhase,
  SessionRecord,
  SessionSummary,
  SetPermissionModeResult,
  StartSessionOptions,
  VisiblePermissionMode
} from '@shared/events'
import { ClaudeAgentRuntime } from '../runtime/claude-agent-runtime'
import { readSdkInfo, resolveClaudeExecutable } from '../runtime/binary'
import type { ConfigService } from './config-service'
import { deepSeekHandoffGenerator } from './handoff-service'
import { HandoffStore } from './handoff-store'
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

/**
 * The block appended to the follow-up session's system prompt. It is plain
 * Markdown so it survives whatever custom append the workspace already set.
 */
export function handoffContextBlock(doc: HandoffDoc): string {
  return [
    '## 交接上下文',
    '这是你从上一段会话接手的交接文档。把它当作已经达成共识的背景继续工作，不要要求用户重复说明。',
    '',
    doc.markdown.trim()
  ].join('\n')
}

interface PendingGrant {
  toolName: string
  /** False for plan approvals, whose suggestions only switch the mode. */
  toolLevel: boolean
}

export class SessionManager {
  private readonly runtime = new ClaudeAgentRuntime()
  private readonly store: SessionStore
  private readonly handoffs: HandoffStore
  private current: SessionSummary | null = null
  private readonly permissionSuggestions = new Map<string, PendingGrant>()
  private seq = 0
  private handoffInFlight = false
  private phase: SessionPhase = 'idle'

  constructor(
    private readonly config: ConfigService,
    private readonly options: SessionManagerOptions
  ) {
    this.store = new SessionStore(options.userDataDir)
    this.handoffs = new HandoffStore(options.userDataDir)
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

    const apiKey = this.requireApiKey()

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
        eventCount: 0,
        handoffFrom: null
      })

    // A follow-up session carries the handoff document inside its system
    // prompt; the workspace's own append stays after it.
    const handoff = this.handoffs.findForTarget(record.id)
    const appendParts: string[] = []
    if (handoff) appendParts.push(handoffContextBlock(handoff))
    if (effective.systemPromptAppend) appendParts.push(effective.systemPromptAppend)
    const systemPromptAppend = appendParts.join('\n\n').trim() || undefined

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
        systemPromptAppend,
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

  // ------------------------------------------------------------------ handoff

  listHandoffs(sessionId?: string): HandoffDoc[] {
    return this.handoffs.list(sessionId)
  }

  updateHandoff(handoffId: string, markdown: string): HandoffDoc {
    const updated = this.handoffs.update(handoffId, { markdown: markdown.trim() })
    if (!updated) throw new RelayError('handoff_missing', '找不到这份交接文档')
    return updated
  }

  deleteHandoff(handoffId: string): void {
    this.handoffs.remove(handoffId)
  }

  /**
   * Generates a handoff document from the active session's event log. The
   * summary call goes straight to the provider instead of through the live
   * session, so it neither spends the session's context nor shows up in the
   * timeline.
   */
  async requestHandoff(): Promise<HandoffDoc> {
    if (!this.current) throw new RelayError('no_session', '当前没有运行中的会话')
    if (this.phase === 'busy' || this.phase === 'starting') {
      throw new RelayError('session_busy', '当前回合还在运行，结束后再生成交接文档')
    }
    if (this.handoffInFlight) {
      throw new RelayError('handoff_running', '交接文档正在生成中，请稍候')
    }
    const sessionId = this.current.id
    const record = this.store.get(sessionId)
    if (!record) throw new RelayError('session_missing', '找不到这个会话')
    const events = this.store.loadEvents(sessionId)
    if (events.length === 0) {
      throw new RelayError('handoff_empty', '这个会话还没有内容可以交接')
    }

    const settings = this.config.getSettings()
    const usage = this.runtime.getUsage(sessionId)
    // `[1m]` is a Claude Code convention; the provider expects the bare name.
    const model = (record.model || settings.model).replace(/\[1m\]$/, '')

    this.handoffInFlight = true
    try {
      const markdown = await deepSeekHandoffGenerator.generate({
        events,
        meta: {
          title: record.title,
          cwd: record.cwd,
          model: record.model,
          contextPercent: usage?.percent ?? null
        },
        baseUrl: settings.baseUrl,
        apiKey: this.requireApiKey(),
        model
      })
      return this.handoffs.create({
        id: crypto.randomUUID(),
        fromSessionId: sessionId,
        fromTitle: record.title,
        markdown,
        model,
        contextPercent: usage?.percent ?? null,
        createdAt: Date.now(),
        toSessionId: null,
        usedAt: null
      })
    } finally {
      this.handoffInFlight = false
    }
  }

  /**
   * Creates the follow-up session record. It is not started here: the
   * renderer opens it like any other session, and `startSession` injects the
   * document through the system prompt.
   */
  acceptHandoff(handoffId: string, markdown?: string): SessionRecord {
    const doc = this.handoffs.get(handoffId)
    if (!doc) throw new RelayError('handoff_missing', '找不到这份交接文档')
    if (doc.toSessionId) {
      throw new RelayError('handoff_used', '这份交接文档已经创建过会话')
    }
    const source = this.store.get(doc.fromSessionId)
    const cwd = source?.cwd ?? this.config.getSettings().workspace
    mkdirSync(cwd, { recursive: true })
    const effective = this.config.effectiveSettings(cwd)
    const created = this.store.create({
      id: crypto.randomUUID(),
      title: `接力 · ${doc.fromTitle}`.slice(0, 40),
      cwd,
      model: effective.model,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      cliSessionId: null,
      eventCount: 0,
      handoffFrom: doc.fromSessionId
    })
    this.handoffs.update(handoffId, {
      toSessionId: created.id,
      usedAt: Date.now(),
      ...(markdown?.trim() ? { markdown: markdown.trim() } : {})
    })
    return created
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

    if (event.type === 'status') this.phase = event.state

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

  private requireApiKey(): string {
    const apiKey =
      this.config.getApiKey() ??
      (!this.options.isPackaged ? process.env.RELAY_DEV_API_KEY?.trim() || null : null)
    if (!apiKey) {
      throw new RelayError('no_api_key', '尚未配置 DeepSeek API Key。请在设置中保存密钥。')
    }
    return apiKey
  }
}
