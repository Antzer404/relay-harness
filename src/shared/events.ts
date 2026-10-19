/**
 * Shared contract between main, preload and renderer.
 * Nothing in here may import Electron or Node built-ins.
 */

export type SessionPhase =
  | 'starting'
  | 'ready'
  | 'busy'
  | 'idle'
  | 'stopped'
  | 'error'

export interface UsageSnapshot {
  model: string
  inputTokens: number
  outputTokens: number
  cacheRead: number
  cacheWrite: number
  contextWindow: number
  contextTokens: number
  percent: number
  costUsd: number
  estimated: boolean
}

export interface PermissionSuggestionView {
  /** Human-readable scope, e.g. `Write(*.ts)` or `切换到 acceptEdits`. */
  label: string
  destination: string
  toolName?: string
  ruleContent?: string
  mode?: string
}

export type HarnessEvent =
  | {
      type: 'session_started'
      sessionId: string
      model: string
      cwd: string
      cliVersion: string
    }
  | { type: 'status'; state: SessionPhase; detail?: string }
  | { type: 'text_delta'; text: string }
  | { type: 'text_done'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'thinking_done'; text: string }
  | {
      type: 'tool_call'
      toolUseId: string
      name: string
      input: unknown
      startedAt: number
    }
  | {
      type: 'tool_result'
      toolUseId: string
      output: string
      isError: boolean
      durationMs: number | null
    }
  | {
      type: 'permission_request'
      requestId: string
      toolName: string
      input: unknown
      suggestions: PermissionSuggestionView[]
      decisionReason?: string
      title?: string
      blockedPath?: string
    }
  | { type: 'usage'; usage: UsageSnapshot }
  | {
      type: 'compact_boundary'
      trigger: 'manual' | 'auto'
      preTokens: number
      postTokens?: number
    }
  | {
      type: 'turn_end'
      reason: string | null
      isError: boolean
      durationMs: number | null
      costUsd: number | null
    }
  | { type: 'error'; code: string; message: string; retryable: boolean }
  | { type: 'memory_note'; message: string }

/** Envelope added by the main process. `seq` is monotonic per app run. */
export interface RelayEvent {
  sessionId: string
  seq: number
  ts: number
  event: HarnessEvent
}

export type PermissionDecisionKind = 'allow' | 'always' | 'deny'

export interface PermissionDecision {
  requestId: string
  decision: PermissionDecisionKind
  message?: string
}

export type EffortLevel = 'high' | 'max'

export type VisiblePermissionMode = 'default' | 'plan' | 'acceptEdits'

export interface RelaySettings {
  baseUrl: string
  model: string
  effort: EffortLevel
  permissionMode: VisiblePermissionMode
  workspace: string
}

export type KeyStorage = 'safeStorage' | 'memory' | 'none'

export interface SessionSummary {
  id: string
  cwd: string
  model: string
  startedAt: number
  cliVersion: string | null
  resumed: boolean
}

export interface BootstrapState {
  appVersion: string
  electronVersion: string
  platform: string
  arch: string
  hasApiKey: boolean
  keyStorage: KeyStorage
  settings: RelaySettings
  session: SessionSummary | null
  sdk: {
    version: string
    cliVersion: string | null
  }
}

export interface IpcError {
  code: string
  message: string
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError }

export interface SaveSettingsPatch {
  baseUrl?: string
  model?: string
  effort?: EffortLevel
  permissionMode?: VisiblePermissionMode
  workspace?: string
}

export interface StartSessionOptions {
  cwd?: string
  resumeSessionId?: string
}

export const MODEL_OPTIONS = [
  { id: 'deepseek-flash[1m]', label: 'DEEPSEEK FLASH', note: '1M 上下文 · 快速' },
  { id: 'deepseek-v4-pro[1m]', label: 'DEEPSEEK V4 PRO', note: '1M 上下文 · 深度' }
] as const

export const EFFORT_OPTIONS: ReadonlyArray<{ id: EffortLevel; label: string }> = [
  { id: 'high', label: 'HIGH' },
  { id: 'max', label: 'MAX' }
]

export const PERMISSION_OPTIONS: ReadonlyArray<{ id: VisiblePermissionMode; label: string }> = [
  { id: 'default', label: 'DEFAULT' },
  { id: 'plan', label: 'PLAN' },
  { id: 'acceptEdits', label: 'ACCEPT EDITS' }
]
