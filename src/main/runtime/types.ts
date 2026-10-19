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
  baseUrl: string
  apiKey: string
  claudeConfigDir: string
  /** Set when starting from a previous SDK transcript. */
  resume?: boolean
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
