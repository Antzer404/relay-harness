import type {
  EffortLevel,
  HarnessEvent,
  PermissionDecision,
  UsageSnapshot,
  VisiblePermissionMode
} from '@shared/events'

export interface StartSessionOptions {
  sessionId: string
  cwd: string
  model: string
  effort: EffortLevel
  permissionMode: VisiblePermissionMode
  /** Extra `.relay/settings.local.json` rules forwarded to the CLI. */
  allowedTools?: string[]
  /** Appended to the preset `claude_code` system prompt. */
  systemPromptAppend?: string
  baseUrl: string
  apiKey: string
  claudeConfigDir: string
  /** CLI transcript id to resume; omit to start a fresh transcript. */
  cliSessionId?: string
  executablePath?: string
}

export interface RuntimeSessionHandle {
  sessionId: string
  cwd: string
  model: string
}

export interface UserInput {
  text: string
}

export interface RuntimeAdapter {
  startSession(options: StartSessionOptions): Promise<RuntimeSessionHandle>
  send(sessionId: string, input: UserInput): void
  interrupt(sessionId: string): Promise<void>
  respondPermission(decision: PermissionDecision): void
  denyAllPermissions(sessionId: string, reason: string): void
  getUsage(sessionId: string): UsageSnapshot | null
  dispose(sessionId: string): Promise<void>
  disposeAll(): Promise<void>
  onEvent(listener: (sessionId: string, event: HarnessEvent) => void): () => void
}
