import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import { DEFAULT_HANDOFF_THRESHOLD, toolRuleName } from '@shared/events'
import type {
  EffectiveSettings,
  EffortLevel,
  KeyStorage,
  RelaySettings,
  SaveSettingsPatch,
  SettingsSource,
  ThemeMode,
  VisiblePermissionMode,
  WorkspaceConfigInfo,
  WorkspaceConfigValues
} from '@shared/events'

interface PersistedApiKey {
  scheme: 'safeStorage'
  data: string
}

export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

interface PersistedSettings {
  version: 3
  baseUrl: string
  model: string
  effort: EffortLevel
  permissionMode: VisiblePermissionMode
  workspace: string
  theme: ThemeMode
  devMode: boolean
  handoffThreshold: number
  apiKey?: PersistedApiKey | null
  windowState?: WindowState
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com/anthropic'
const DEFAULT_MODEL = 'deepseek-flash[1m]'
const RELAY_DIR = '.relay'
const SETTINGS_FILE = 'settings.json'
const LOCAL_FILE = 'settings.local.json'

type WorkspaceFile = 'settings.json' | 'settings.local.json'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pickWorkspaceValues(raw: Record<string, unknown>): WorkspaceConfigValues {
  const values: WorkspaceConfigValues = {}
  if (typeof raw.model === 'string' && raw.model.trim()) values.model = raw.model.trim()
  if (raw.effort === 'high' || raw.effort === 'max') values.effort = raw.effort
  if (
    raw.permissionMode === 'default' ||
    raw.permissionMode === 'plan' ||
    raw.permissionMode === 'acceptEdits'
  ) {
    values.permissionMode = raw.permissionMode
  }
  if (typeof raw.systemPromptAppend === 'string' && raw.systemPromptAppend.trim()) {
    values.systemPromptAppend = raw.systemPromptAppend
  }
  if (Array.isArray(raw.allowedTools)) {
    const rules = new Set<string>()
    for (const entry of raw.allowedTools) {
      if (typeof entry !== 'string') continue
      // Grants are per tool; older builds stored per-target rules.
      const name = toolRuleName(entry)
      if (name) rules.add(name)
    }
    if (rules.size > 0) values.allowedTools = [...rules]
  }
  return values
}

function readConfigObject(path: string): {
  exists: boolean
  raw: Record<string, unknown>
  values: WorkspaceConfigValues
  error: string | null
} {
  if (!existsSync(path)) return { exists: false, raw: {}, values: {}, error: null }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!isRecord(parsed)) {
      return { exists: true, raw: {}, values: {}, error: `${path} 不是 JSON 对象` }
    }
    return { exists: true, raw: parsed, values: pickWorkspaceValues(parsed), error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exists: true, raw: {}, values: {}, error: `${path} 解析失败：${message}` }
  }
}

export class ConfigService {
  private readonly filePath: string
  private data: PersistedSettings
  /** Only used when the OS keychain (safeStorage) is unavailable. */
  private memoryKey: string | null = null

  constructor(private readonly userDataDir: string) {
    this.filePath = join(userDataDir, 'settings.json')
    this.data = this.load()
  }

  private defaults(): PersistedSettings {
    return {
      version: 3,
      baseUrl: DEFAULT_BASE_URL,
      model: DEFAULT_MODEL,
      effort: 'high',
      permissionMode: 'default',
      workspace: join(this.userDataDir, 'workspace'),
      theme: 'system',
      devMode: false,
      handoffThreshold: DEFAULT_HANDOFF_THRESHOLD,
      apiKey: null
    }
  }

  private load(): PersistedSettings {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      const raw = isRecord(parsed) ? parsed : {}
      const base = this.defaults()
      const settings: PersistedSettings = {
        ...base,
        version: 3,
        baseUrl: typeof raw.baseUrl === 'string' && raw.baseUrl ? raw.baseUrl : base.baseUrl,
        model: typeof raw.model === 'string' && raw.model ? raw.model : base.model,
        effort: raw.effort === 'high' || raw.effort === 'max' ? raw.effort : base.effort,
        permissionMode:
          raw.permissionMode === 'default' ||
          raw.permissionMode === 'plan' ||
          raw.permissionMode === 'acceptEdits'
            ? raw.permissionMode
            : base.permissionMode,
        workspace:
          typeof raw.workspace === 'string' && raw.workspace ? raw.workspace : base.workspace,
        theme:
          raw.theme === 'light' || raw.theme === 'dark' || raw.theme === 'system'
            ? raw.theme
            : base.theme,
        devMode: raw.devMode === true,
        handoffThreshold:
          typeof raw.handoffThreshold === 'number' &&
          Number.isInteger(raw.handoffThreshold) &&
          raw.handoffThreshold >= 50 &&
          raw.handoffThreshold <= 90
            ? raw.handoffThreshold
            : base.handoffThreshold,
        // Never accept a persisted plaintext key.
        apiKey:
          isRecord(raw.apiKey) &&
          raw.apiKey.scheme === 'safeStorage' &&
          typeof raw.apiKey.data === 'string'
            ? { scheme: 'safeStorage', data: raw.apiKey.data }
            : null
      }
      if (isRecord(raw.windowState)) {
        const state = raw.windowState
        const width = typeof state.width === 'number' ? state.width : 0
        const height = typeof state.height === 'number' ? state.height : 0
        if (width >= 800 && height >= 560) {
          settings.windowState = {
            width,
            height,
            maximized: state.maximized === true,
            ...(typeof state.x === 'number' ? { x: state.x } : {}),
            ...(typeof state.y === 'number' ? { y: state.y } : {})
          }
        }
      }
      return settings
    } catch {
      return this.defaults()
    }
  }

  private persist(): void {
    mkdirSync(this.userDataDir, { recursive: true })
    writeFileSync(this.filePath, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 })
  }

  getSettings(): RelaySettings {
    return {
      baseUrl: this.data.baseUrl,
      model: this.data.model,
      effort: this.data.effort,
      permissionMode: this.data.permissionMode,
      workspace: this.data.workspace,
      theme: this.data.theme,
      devMode: this.data.devMode,
      handoffThreshold: this.data.handoffThreshold
    }
  }

  updateSettings(patch: SaveSettingsPatch): RelaySettings {
    if (patch.baseUrl !== undefined) this.data.baseUrl = patch.baseUrl.replace(/\/+$/, '')
    if (patch.model !== undefined) this.data.model = patch.model
    if (patch.effort !== undefined) this.data.effort = patch.effort
    if (patch.permissionMode !== undefined) this.data.permissionMode = patch.permissionMode
    if (patch.theme !== undefined) this.data.theme = patch.theme
    if (patch.devMode !== undefined) this.data.devMode = patch.devMode
    if (patch.handoffThreshold !== undefined) this.data.handoffThreshold = patch.handoffThreshold
    if (patch.workspace !== undefined) {
      this.data.workspace = patch.workspace
      mkdirSync(patch.workspace, { recursive: true })
    }
    this.persist()
    return this.getSettings()
  }

  ensureWorkspace(): string {
    mkdirSync(this.data.workspace, { recursive: true })
    return this.data.workspace
  }

  getWindowState(): WindowState | null {
    return this.data.windowState ?? null
  }

  saveWindowState(state: WindowState): void {
    this.data.windowState = state
    this.persist()
  }

  // ---------------------------------------------------------------- workspace

  readWorkspaceConfig(cwd: string): WorkspaceConfigInfo {
    const dir = join(cwd, RELAY_DIR)
    const path = join(dir, SETTINGS_FILE)
    const localPath = join(dir, LOCAL_FILE)
    const base = readConfigObject(path)
    const local = readConfigObject(localPath)

    const values: WorkspaceConfigValues = { ...base.values }
    const sources: WorkspaceConfigInfo['sources'] = {}
    for (const key of Object.keys(base.values) as Array<keyof WorkspaceConfigValues>) {
      sources[key] = 'workspace'
    }
    if (local.values.model !== undefined) {
      values.model = local.values.model
      sources.model = 'workspace-local'
    }
    if (local.values.effort !== undefined) {
      values.effort = local.values.effort
      sources.effort = 'workspace-local'
    }
    if (local.values.permissionMode !== undefined) {
      values.permissionMode = local.values.permissionMode
      sources.permissionMode = 'workspace-local'
    }
    if (local.values.systemPromptAppend !== undefined) {
      values.systemPromptAppend = local.values.systemPromptAppend
      sources.systemPromptAppend = 'workspace-local'
    }
    if (local.values.allowedTools !== undefined) {
      const merged = new Set([...(values.allowedTools ?? []), ...local.values.allowedTools])
      values.allowedTools = [...merged]
      sources.allowedTools = 'workspace-local'
    }

    const errors = [base.error, local.error].filter((entry): entry is string => Boolean(entry))
    return {
      dir,
      path,
      localPath,
      exists: base.exists || local.exists,
      values,
      sources,
      error: errors.length > 0 ? errors.join('\n') : null
    }
  }

  effectiveSettings(cwd: string): EffectiveSettings {
    const app = this.getSettings()
    const workspace = this.readWorkspaceConfig(cwd)
    const values = workspace.values
    const sourceOf = (key: keyof WorkspaceConfigValues): SettingsSource | null =>
      workspace.sources[key] ?? null

    return {
      model: values.model ?? app.model,
      effort: values.effort ?? app.effort,
      permissionMode: values.permissionMode ?? app.permissionMode,
      systemPromptAppend: values.systemPromptAppend ?? null,
      allowedTools: values.allowedTools ?? [],
      sources: {
        model: sourceOf('model') ?? 'app',
        effort: sourceOf('effort') ?? 'app',
        permissionMode: sourceOf('permissionMode') ?? 'app',
        systemPromptAppend: sourceOf('systemPromptAppend')
      }
    }
  }

  /**
   * Writes `<cwd>/.relay/settings.json`. Keys not present in `values` are
   * removed from that file; `allowedTools` lives in `settings.local.json` and
   * is preserved here.
   */
  writeWorkspaceConfig(cwd: string, values: WorkspaceConfigValues): WorkspaceConfigInfo {
    const dir = join(cwd, RELAY_DIR)
    mkdirSync(dir, { recursive: true })
    const next: Record<string, unknown> = {}
    if (values.model) next.model = values.model
    if (values.effort) next.effort = values.effort
    if (values.permissionMode) next.permissionMode = values.permissionMode
    if (values.systemPromptAppend !== undefined) {
      if (values.systemPromptAppend.trim()) next.systemPromptAppend = values.systemPromptAppend
    }
    writeFileSync(join(dir, SETTINGS_FILE), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    if (values.allowedTools && values.allowedTools.length > 0) {
      this.addWorkspaceAllowedTools(cwd, values.allowedTools)
    }
    return this.readWorkspaceConfig(cwd)
  }

  /** Appends rules granted through "always allow" to `settings.local.json`. */
  addWorkspaceAllowedTools(cwd: string, rules: string[]): void {
    if (rules.length === 0) return
    const dir = join(cwd, RELAY_DIR)
    mkdirSync(dir, { recursive: true })
    const localPath = join(dir, LOCAL_FILE)
    const existing = readConfigObject(localPath)
    const merged = new Set([...(existing.values.allowedTools ?? []), ...rules])
    const next: Record<string, unknown> = { ...existing.raw, allowedTools: [...merged] }
    writeFileSync(localPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  }

  /**
   * Revokes a tool grant. Matching is normalised, so removing `WebFetch` also
   * clears legacy `WebFetch(domain:…)` entries written by older builds.
   */
  removeWorkspaceAllowedTool(cwd: string, rule: string): WorkspaceConfigInfo {
    const dir = join(cwd, RELAY_DIR)
    const localPath = join(dir, LOCAL_FILE)
    const target = toolRuleName(rule) ?? rule
    const existing = readConfigObject(localPath)
    const kept = (existing.values.allowedTools ?? []).filter(
      (entry) => toolRuleName(entry) !== target
    )
    if (existing.exists) {
      const next: Record<string, unknown> = { ...existing.raw, allowedTools: kept }
      writeFileSync(localPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    }
    return this.readWorkspaceConfig(cwd)
  }

  clearWorkspaceConfig(cwd: string): WorkspaceConfigInfo {
    const dir = join(cwd, RELAY_DIR)
    for (const name of [SETTINGS_FILE, LOCAL_FILE] as const) {
      const path = join(dir, name)
      if (existsSync(path)) unlinkSync(path)
    }
    return this.readWorkspaceConfig(cwd)
  }

  // --------------------------------------------------------------- credentials

  setApiKey(key: string): 'safeStorage' | 'memory' {
    this.memoryKey = null
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(key).toString('base64')
      this.data.apiKey = { scheme: 'safeStorage', data: encrypted }
      this.persist()
      return 'safeStorage'
    }
    // No OS keychain: keep the key for this process only, never on disk.
    this.memoryKey = key
    this.data.apiKey = null
    this.persist()
    return 'memory'
  }

  getApiKey(): string | null {
    if (this.memoryKey) return this.memoryKey
    if (!this.data.apiKey) return null
    if (!safeStorage.isEncryptionAvailable()) return null
    try {
      return safeStorage.decryptString(Buffer.from(this.data.apiKey.data, 'base64'))
    } catch {
      return null
    }
  }

  clearApiKey(): void {
    this.memoryKey = null
    this.data.apiKey = null
    this.persist()
  }

  getKeyStorage(): KeyStorage {
    if (this.memoryKey) return 'memory'
    if (this.data.apiKey && safeStorage.isEncryptionAvailable()) return 'safeStorage'
    return 'none'
  }

  hasApiKey(): boolean {
    return this.getApiKey() !== null
  }
}
