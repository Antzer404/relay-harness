import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import type {
  BootstrapState,
  KeyStorage,
  RelaySettings,
  SaveSettingsPatch
} from '@shared/events'

interface PersistedApiKey {
  scheme: 'safeStorage'
  data: string
}

interface PersistedSettings {
  version: 1
  baseUrl: string
  model: string
  effort: 'high' | 'max'
  permissionMode: 'default' | 'plan' | 'acceptEdits'
  workspace: string
  apiKey?: PersistedApiKey | null
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com/anthropic'
const DEFAULT_MODEL = 'deepseek-flash[1m]'

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
      version: 1,
      baseUrl: DEFAULT_BASE_URL,
      model: DEFAULT_MODEL,
      effort: 'high',
      permissionMode: 'default',
      workspace: join(this.userDataDir, 'workspace'),
      apiKey: null
    }
  }

  private load(): PersistedSettings {
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<PersistedSettings>
      const base = this.defaults()
      return {
        ...base,
        ...raw,
        version: 1,
        // Never accept a persisted plaintext key.
        apiKey:
          raw.apiKey && raw.apiKey.scheme === 'safeStorage' && typeof raw.apiKey.data === 'string'
            ? { scheme: 'safeStorage', data: raw.apiKey.data }
            : null
      }
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
      workspace: this.data.workspace
    }
  }

  updateSettings(patch: SaveSettingsPatch): RelaySettings {
    if (patch.baseUrl !== undefined) this.data.baseUrl = patch.baseUrl.replace(/\/+$/, '')
    if (patch.model !== undefined) this.data.model = patch.model
    if (patch.effort !== undefined) this.data.effort = patch.effort
    if (patch.permissionMode !== undefined) this.data.permissionMode = patch.permissionMode
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

  bootstrapMeta(): Pick<BootstrapState, 'hasApiKey' | 'keyStorage' | 'settings'> {
    return {
      hasApiKey: this.hasApiKey(),
      keyStorage: this.getKeyStorage(),
      settings: this.getSettings()
    }
  }
}
