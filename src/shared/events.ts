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

/** Kept for the developer trace; the product UI does not display usage. */
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

export interface DiffLine {
  kind: 'context' | 'add' | 'del'
  text: string
  /** Null when the hunk was rebuilt from tool input without file context. */
  oldNo: number | null
  newNo: number | null
}

export interface DiffHunk {
  lines: DiffLine[]
}

export type DiffMode = 'create' | 'edit' | 'write'

/** A file change computed in the main process and carried by `tool_result`. */
export interface FileDiff {
  path: string
  /** create: the file did not exist; edit: known before/after; write: overwrite preview. */
  mode: DiffMode
  added: number
  removed: number
  hunks: DiffHunk[]
  /** The diff was clipped because the file or the change set was too large. */
  truncated: boolean
}

export type HarnessEvent =
  | {
      type: 'session_started'
      sessionId: string
      model: string
      cwd: string
      cliVersion: string
    }
  | { type: 'user_message'; text: string }
  | { type: 'status'; state: SessionPhase; detail?: string }
  | { type: 'text_delta'; text: string }
  | { type: 'text_done'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'thinking_done'; text: string; durationMs?: number | null }
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
      /** Present for successful Edit/MultiEdit/Write calls. */
      diff?: FileDiff
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

export type ThemeMode = 'light' | 'dark' | 'system'

export interface RelaySettings {
  baseUrl: string
  model: string
  effort: EffortLevel
  permissionMode: VisiblePermissionMode
  workspace: string
  theme: ThemeMode
  devMode: boolean
}

export type SettingsSource = 'app' | 'workspace' | 'workspace-local'

/**
 * What the runtime will actually use after layering the app settings and the
 * workspace's `.relay/settings.json` (plus `settings.local.json`).
 */
export interface EffectiveSettings {
  model: string
  effort: EffortLevel
  permissionMode: VisiblePermissionMode
  systemPromptAppend: string | null
  allowedTools: string[]
  sources: {
    model: SettingsSource
    effort: SettingsSource
    permissionMode: SettingsSource
    systemPromptAppend: SettingsSource | null
  }
}

export interface WorkspaceConfigValues {
  model?: string
  effort?: EffortLevel
  permissionMode?: VisiblePermissionMode
  systemPromptAppend?: string
  allowedTools?: string[]
}

export interface WorkspaceConfigInfo {
  /** `<cwd>/.relay` */
  dir: string
  /** `<cwd>/.relay/settings.json` */
  path: string
  /** `<cwd>/.relay/settings.local.json` */
  localPath: string
  exists: boolean
  values: WorkspaceConfigValues
  sources: Partial<Record<keyof WorkspaceConfigValues, 'workspace' | 'workspace-local'>>
  error: string | null
}

export type KeyStorage = 'safeStorage' | 'memory' | 'none'

export interface SessionRecord {
  id: string
  title: string
  cwd: string
  model: string
  createdAt: number
  updatedAt: number
  cliSessionId: string | null
  eventCount: number
}

export interface SessionDetail {
  record: SessionRecord
  events: RelayEvent[]
}

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
  effective: EffectiveSettings
  workspaceConfig: WorkspaceConfigInfo
  session: SessionSummary | null
  sessions: SessionRecord[]
  /** Chromium has no GPU compositing; the renderer drops blur-heavy effects. */
  lowEffects: boolean
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
  theme?: ThemeMode
  devMode?: boolean
}

/** Resume `sessionId` (a SessionRecord id); omit to create a new session. */
export interface StartSessionOptions {
  sessionId?: string
}

export const MODEL_OPTIONS = [
  { id: 'deepseek-flash[1m]', label: 'DeepSeek Flash', note: '1M 上下文 · 快速' },
  { id: 'deepseek-v4-pro[1m]', label: 'DeepSeek V4 Pro', note: '1M 上下文 · 深度' }
] as const

export const EFFORT_OPTIONS: ReadonlyArray<{ id: EffortLevel; label: string }> = [
  { id: 'high', label: 'High' },
  { id: 'max', label: 'Max' }
]

export const PERMISSION_OPTIONS: ReadonlyArray<{
  id: VisiblePermissionMode
  label: string
  note: string
}> = [
  { id: 'default', label: '每次询问', note: '写入与命令执行前请求批准' },
  { id: 'plan', label: '仅规划', note: '只读分析，不执行修改' },
  { id: 'acceptEdits', label: '自动接受编辑', note: '文件编辑不再询问' }
]

export const THEME_OPTIONS: ReadonlyArray<{ id: ThemeMode; label: string }> = [
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
  { id: 'system', label: '跟随系统' }
]
