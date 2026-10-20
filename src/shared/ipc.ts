import type {
  BootstrapState,
  HandoffDoc,
  IpcResult,
  PermissionDecision,
  RelayEvent,
  RelaySettings,
  SaveSettingsPatch,
  SessionDetail,
  SessionRecord,
  SessionSummary,
  SetPermissionModeResult,
  StartSessionOptions,
  VisiblePermissionMode,
  WorkspaceConfigInfo,
  WorkspaceConfigValues
} from './events'

export const IPC_CHANNELS = {
  bootstrap: 'relay:bootstrap',
  setApiKey: 'relay:set-api-key',
  clearApiKey: 'relay:clear-api-key',
  saveSettings: 'relay:save-settings',
  chooseWorkspace: 'relay:choose-workspace',
  startSession: 'relay:start-session',
  stopSession: 'relay:stop-session',
  send: 'relay:send',
  interrupt: 'relay:interrupt',
  setPermissionMode: 'relay:set-permission-mode',
  permissionResponse: 'relay:permission-response',
  listSessions: 'relay:list-sessions',
  loadSession: 'relay:load-session',
  renameSession: 'relay:rename-session',
  deleteSession: 'relay:delete-session',
  readWorkspaceConfig: 'relay:read-workspace-config',
  writeWorkspaceConfig: 'relay:write-workspace-config',
  clearWorkspaceConfig: 'relay:clear-workspace-config',
  removeAllowedTool: 'relay:remove-allowed-tool',
  requestHandoff: 'relay:request-handoff',
  listHandoffs: 'relay:list-handoffs',
  updateHandoff: 'relay:update-handoff',
  deleteHandoff: 'relay:delete-handoff',
  acceptHandoff: 'relay:accept-handoff',
  windowControl: 'relay:window-control',
  event: 'relay:event',
  permissionCancelled: 'relay:permission-cancelled',
  windowMaximized: 'relay:window-maximized'
} as const

export interface SetApiKeyResult {
  keyStorage: 'safeStorage' | 'memory'
}

export type WindowControlAction = 'minimize' | 'toggle-maximize' | 'close'

export interface RelayApi {
  bootstrap(): Promise<IpcResult<BootstrapState>>
  setApiKey(key: string): Promise<IpcResult<SetApiKeyResult>>
  clearApiKey(): Promise<IpcResult<void>>
  saveSettings(patch: SaveSettingsPatch): Promise<IpcResult<RelaySettings>>
  chooseWorkspace(): Promise<IpcResult<string | null>>
  startSession(options?: StartSessionOptions): Promise<IpcResult<SessionSummary>>
  stopSession(): Promise<IpcResult<void>>
  send(text: string): Promise<IpcResult<void>>
  interrupt(): Promise<IpcResult<void>>
  setPermissionMode(mode: VisiblePermissionMode): Promise<IpcResult<SetPermissionModeResult>>
  respondPermission(decision: PermissionDecision): Promise<IpcResult<void>>
  listSessions(): Promise<IpcResult<SessionRecord[]>>
  loadSession(sessionId: string): Promise<IpcResult<SessionDetail>>
  renameSession(sessionId: string, title: string): Promise<IpcResult<SessionRecord>>
  deleteSession(sessionId: string): Promise<IpcResult<void>>
  readWorkspaceConfig(cwd?: string): Promise<IpcResult<WorkspaceConfigInfo>>
  writeWorkspaceConfig(
    cwd: string | undefined,
    values: WorkspaceConfigValues
  ): Promise<IpcResult<WorkspaceConfigInfo>>
  clearWorkspaceConfig(cwd?: string): Promise<IpcResult<WorkspaceConfigInfo>>
  removeAllowedTool(
    cwd: string | undefined,
    rule: string
  ): Promise<IpcResult<WorkspaceConfigInfo>>
  /** Generates a handoff document from the active session's event log. */
  requestHandoff(): Promise<IpcResult<HandoffDoc>>
  listHandoffs(sessionId?: string): Promise<IpcResult<HandoffDoc[]>>
  updateHandoff(handoffId: string, markdown: string): Promise<IpcResult<HandoffDoc>>
  deleteHandoff(handoffId: string): Promise<IpcResult<void>>
  /** Creates (does not start) the follow-up session; open it to resume work. */
  acceptHandoff(handoffId: string, markdown?: string): Promise<IpcResult<SessionRecord>>
  windowControl(action: WindowControlAction): Promise<IpcResult<void>>
  onEvent(callback: (event: RelayEvent) => void): () => void
  onPermissionCancelled(callback: (requestId: string) => void): () => void
  onWindowMaximized(callback: (maximized: boolean) => void): () => void
}
