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
  send: (text) => ipcRenderer.invoke(IPC_CHANNELS.send, { text }),
  interrupt: () => ipcRenderer.invoke(IPC_CHANNELS.interrupt),
  respondPermission: (decision) =>
    ipcRenderer.invoke(IPC_CHANNELS.permissionResponse, decision),
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
  }
}

contextBridge.exposeInMainWorld('relay', api)
