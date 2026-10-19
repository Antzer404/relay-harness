import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type {
  HarnessEvent,
  PermissionDecision,
  RelayEvent,
  SessionSummary
} from '@shared/events'
import { ClaudeAgentRuntime } from '../runtime/claude-agent-runtime'
import { readSdkInfo, resolveClaudeExecutable } from '../runtime/binary'
import type { ConfigService } from './config-service'

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

export class SessionManager {
  private readonly runtime = new ClaudeAgentRuntime()
  private current: SessionSummary | null = null
  private seq = 0

  constructor(
    private readonly config: ConfigService,
    private readonly options: SessionManagerOptions
  ) {
    this.runtime.onEvent((sessionId, event) => this.handleRuntimeEvent(sessionId, event))
  }

  getSdkInfo(): ReturnType<typeof readSdkInfo> {
    return readSdkInfo()
  }

  getCurrent(): SessionSummary | null {
    return this.current
  }

  async startSession(request: { cwd?: string; resumeSessionId?: string } = {}): Promise<SessionSummary> {
    const settings = this.config.getSettings()
    const cwd = request.cwd ?? this.config.ensureWorkspace()
    mkdirSync(cwd, { recursive: true })

    const apiKey =
      this.config.getApiKey() ??
      (!this.options.isPackaged ? process.env.RELAY_DEV_API_KEY?.trim() || null : null)
    if (!apiKey) {
      throw new RelayError('no_api_key', '尚未配置 DeepSeek API Key。请在右侧 SETUP 面板中保存密钥。')
    }

    if (this.current) {
      await this.runtime.dispose(this.current.id)
      this.current = null
    }

    const sessionId = request.resumeSessionId ?? crypto.randomUUID()
    const summary: SessionSummary = {
      id: sessionId,
      cwd,
      model: settings.model,
      startedAt: Date.now(),
      cliVersion: null,
      resumed: Boolean(request.resumeSessionId)
    }

    // Register the session before spawning so early runtime events (status,
    // session_started) are forwarded instead of dropped.
    this.current = summary

    try {
      await this.runtime.startSession({
        sessionId,
        cwd,
        model: settings.model,
        effort: settings.effort,
        permissionMode: settings.permissionMode,
        baseUrl: settings.baseUrl,
        apiKey,
        claudeConfigDir: join(this.options.userDataDir, 'claude-config'),
        resume: Boolean(request.resumeSessionId),
        executablePath: resolveClaudeExecutable(this.options.isPackaged)
      })
    } catch (error) {
      this.current = null
      const detail = error instanceof Error ? error.message : String(error)
      throw new RelayError('start_failed', `无法启动运行时：${detail}`)
    }

    return summary
  }

  send(text: string): void {
    if (!this.current) throw new RelayError('no_session', '尚未启动会话')
    this.runtime.send(this.current.id, { text })
  }

  async interrupt(): Promise<void> {
    if (!this.current) return
    await this.runtime.interrupt(this.current.id)
  }

  respondPermission(decision: PermissionDecision): void {
    this.runtime.respondPermission(decision)
  }

  denyPendingPermissions(reason: string): void {
    if (!this.current) return
    this.runtime.denyAllPermissions(this.current.id, reason)
  }

  async dispose(): Promise<void> {
    await this.runtime.disposeAll()
    this.current = null
  }

  private handleRuntimeEvent(sessionId: string, event: HarnessEvent): void {
    if (!this.current || this.current.id !== sessionId) return

    if (event.type === 'session_started') {
      this.current.cliVersion = event.cliVersion
      this.current.model = event.model
      this.current.cwd = event.cwd
    }

    this.seq += 1
    this.options.emit({
      sessionId,
      seq: this.seq,
      ts: Date.now(),
      event
    })
  }
}
