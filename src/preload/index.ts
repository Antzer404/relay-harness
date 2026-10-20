import { contextBridge, ipcRenderer } from 'electron'
import type { RelayEvent } from '@shared/events'
import { IPC_CHANNELS, type RelayApi } from '@shared/ipc'

const api: RelayApi = {
  bootstrap: () => ipcRenderer.invoke(IPC_CHANNELS.bootstrap),
  setApiKey: (key) => ipcRenderer.invoke(IPC_CHANNELS.setApiKey, { key }),
  clearApiKey: () => ipcRenderer.invoke(IPC_CHANNELS.clearApiKey),
  saveSettings: (patch) => ipcRenderer.invoke(IPC_CHANNELS.saveSettings, patch),
  chooseWorkspace: () => ipcRenderer.invoke(IPC_CHANNELS.chooseWorkspace),
  startSession: (options) => ipcRenderer.invoke(IPC_CHANNELS.startSession, options ?? {}),
  stopSession: () => ipcRenderer.invoke(IPC_CHANNELS.stopSession),
  send: (text) => ipcRenderer.invoke(IPC_CHANNELS.send, { text }),
  interrupt: () => ipcRenderer.invoke(IPC_CHANNELS.interrupt),
  setPermissionMode: (mode) =>
    ipcRenderer.invoke(IPC_CHANNELS.setPermissionMode, { mode }),
  respondPermission: (decision) =>
    ipcRenderer.invoke(IPC_CHANNELS.permissionResponse, decision),
  listSessions: () => ipcRenderer.invoke(IPC_CHANNELS.listSessions),
  loadSession: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.loadSession, { sessionId }),
  renameSession: (sessionId, title) =>
    ipcRenderer.invoke(IPC_CHANNELS.renameSession, { sessionId, title }),
  deleteSession: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.deleteSession, { sessionId }),
  readWorkspaceConfig: (cwd) => ipcRenderer.invoke(IPC_CHANNELS.readWorkspaceConfig, { cwd }),
  writeWorkspaceConfig: (cwd, values) =>
    ipcRenderer.invoke(IPC_CHANNELS.writeWorkspaceConfig, { cwd, values }),
  clearWorkspaceConfig: (cwd) =>
    ipcRenderer.invoke(IPC_CHANNELS.clearWorkspaceConfig, { cwd }),
  removeAllowedTool: (cwd, rule) =>
    ipcRenderer.invoke(IPC_CHANNELS.removeAllowedTool, { cwd, rule }),
  windowControl: (action) => ipcRenderer.invoke(IPC_CHANNELS.windowControl, { action }),
  onEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: RelayEvent): void => {
      callback(payload)
    }
    ipcRenderer.on(IPC_CHANNELS.event, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.event, listener)
    }
  },
  onPermissionCancelled: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, requestId: string): void => {
      callback(requestId)
    }
    ipcRenderer.on(IPC_CHANNELS.permissionCancelled, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.permissionCancelled, listener)
    }
  },
  onWindowMaximized: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, maximized: boolean): void => {
      callback(maximized)
    }
    ipcRenderer.on(IPC_CHANNELS.windowMaximized, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.windowMaximized, listener)
    }
  }
}

contextBridge.exposeInMainWorld('relay', api)
