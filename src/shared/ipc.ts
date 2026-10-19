import type {
  BootstrapState,
  IpcResult,
  PermissionDecision,
  RelayEvent,
  RelaySettings,
  SaveSettingsPatch,
  SessionSummary,
  StartSessionOptions
} from './events'

export const IPC_CHANNELS = {
  bootstrap: 'relay:bootstrap',
  setApiKey: 'relay:set-api-key',
  clearApiKey: 'relay:clear-api-key',
  saveSettings: 'relay:save-settings',
  chooseWorkspace: 'relay:choose-workspace',
  startSession: 'relay:start-session',
  send: 'relay:send',
  interrupt: 'relay:interrupt',
  permissionResponse: 'relay:permission-response',
  event: 'relay:event',
  permissionCancelled: 'relay:permission-cancelled'
} as const

export interface SetApiKeyResult {
  keyStorage: 'safeStorage' | 'memory'
}

export interface RelayApi {
  bootstrap(): Promise<IpcResult<BootstrapState>>
  setApiKey(key: string): Promise<IpcResult<SetApiKeyResult>>
  clearApiKey(): Promise<IpcResult<void>>
  saveSettings(patch: SaveSettingsPatch): Promise<IpcResult<RelaySettings>>
  chooseWorkspace(): Promise<IpcResult<string | null>>
  startSession(options?: StartSessionOptions): Promise<IpcResult<SessionSummary>>
  send(text: string): Promise<IpcResult<void>>
  interrupt(): Promise<IpcResult<void>>
  respondPermission(decision: PermissionDecision): Promise<IpcResult<void>>
  onEvent(callback: (event: RelayEvent) => void): () => void
  onPermissionCancelled(callback: (requestId: string) => void): () => void
}
