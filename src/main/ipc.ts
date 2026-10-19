import { dialog, ipcMain, type BrowserWindow } from 'electron'
import type { IpcResult } from '@shared/events'
import { IPC_CHANNELS } from '@shared/ipc'
import {
  apiKeySchema,
  permissionDecisionSchema,
  sendSchema,
  settingsPatchSchema,
  startSessionSchema
} from '@shared/schemas'
import type { ConfigService } from './services/config-service'
import { RelayError, type SessionManager } from './services/session-manager'

interface IpcDeps {
  appVersion: string
  config: ConfigService
  sessions: SessionManager
  getWindow: () => BrowserWindow | null
}

function fail(code: string, message: string): IpcResult<never> {
  return { ok: false, error: { code, message } }
}

function toFailure(error: unknown): IpcResult<never> {
  if (error instanceof RelayError) return fail(error.code, error.message)
  const message = error instanceof Error ? error.message : String(error)
  return fail('internal_error', message)
}

async function run<T>(fn: () => Promise<T> | T): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    if (error && typeof error === 'object' && 'issues' in error) {
      const issues = (error as { issues?: Array<{ message?: string }> }).issues
      return fail('invalid_argument', issues?.[0]?.message ?? '参数校验失败')
    }
    return toFailure(error)
  }
}

export function registerIpc({ appVersion, config, sessions, getWindow }: IpcDeps): void {
  ipcMain.handle(IPC_CHANNELS.bootstrap, () =>
    run(() => {
      const meta = config.bootstrapMeta()
      const sdk = sessions.getSdkInfo()
      return {
        appVersion,
        electronVersion: process.versions.electron,
        platform: process.platform,
        arch: process.arch,
        ...meta,
        session: sessions.getCurrent(),
        sdk
      }
    })
  )

  ipcMain.handle(IPC_CHANNELS.setApiKey, (_event, raw: unknown) =>
    run(() => {
      const { key } = apiKeySchema.parse(raw)
      const keyStorage = config.setApiKey(key)
      return { keyStorage }
    })
  )

  ipcMain.handle(IPC_CHANNELS.clearApiKey, () =>
    run(() => {
      config.clearApiKey()
      return undefined
    })
  )

  ipcMain.handle(IPC_CHANNELS.saveSettings, (_event, raw: unknown) =>
    run(() => {
      const patch = settingsPatchSchema.parse(raw)
      return config.updateSettings(patch)
    })
  )

  ipcMain.handle(IPC_CHANNELS.chooseWorkspace, () =>
    run(async () => {
      const window = getWindow()
      const result = window
        ? await dialog.showOpenDialog(window, {
            title: '选择工作区',
            properties: ['openDirectory', 'createDirectory']
          })
        : await dialog.showOpenDialog({
            title: '选择工作区',
            properties: ['openDirectory', 'createDirectory']
          })
      if (result.canceled || !result.filePaths[0]) return null
      config.updateSettings({ workspace: result.filePaths[0] })
      return result.filePaths[0]
    })
  )

  ipcMain.handle(IPC_CHANNELS.startSession, (_event, raw: unknown) =>
    run(async () => {
      const options = raw === undefined ? {} : startSessionSchema.parse(raw)
      return sessions.startSession(options)
    })
  )

  ipcMain.handle(IPC_CHANNELS.send, (_event, raw: unknown) =>
    run(() => {
      const { text } = sendSchema.parse(raw)
      sessions.send(text)
      return undefined
    })
  )

  ipcMain.handle(IPC_CHANNELS.interrupt, () =>
    run(async () => {
      await sessions.interrupt()
      return undefined
    })
  )

  ipcMain.handle(IPC_CHANNELS.permissionResponse, (_event, raw: unknown) =>
    run(() => {
      const decision = permissionDecisionSchema.parse(raw)
      sessions.respondPermission(decision)
      return undefined
    })
  )
}
