import { dialog, ipcMain, type BrowserWindow } from 'electron'
import type { IpcResult } from '@shared/events'
import { IPC_CHANNELS } from '@shared/ipc'
import {
  apiKeySchema,
  permissionDecisionSchema,
  renameSessionSchema,
  sendSchema,
  sessionIdSchema,
  setPermissionModeSchema,
  settingsPatchSchema,
  startSessionSchema,
  windowControlSchema,
  workspaceConfigCwdSchema,
  workspaceConfigSchema
} from '@shared/schemas'
import type { ConfigService } from './services/config-service'
import { RelayError, type SessionManager } from './services/session-manager'
import { lowEffects } from './perf'

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

function parseCwd(config: ConfigService, raw: unknown): string {
  const parsed = workspaceConfigCwdSchema.parse(raw ?? {})
  return parsed.cwd ?? config.getSettings().workspace
}

export function registerIpc({ appVersion, config, sessions, getWindow }: IpcDeps): void {
  ipcMain.handle(IPC_CHANNELS.bootstrap, () =>
    run(() => {
      config.ensureWorkspace()
      const settings = config.getSettings()
      const cwd = settings.workspace
      return {
        appVersion,
        electronVersion: process.versions.electron,
        platform: process.platform,
        arch: process.arch,
        hasApiKey: config.hasApiKey(),
        keyStorage: config.getKeyStorage(),
        settings,
        effective: config.effectiveSettings(cwd),
        workspaceConfig: config.readWorkspaceConfig(cwd),
        session: sessions.getCurrent(),
        sessions: sessions.getSessions(),
        lowEffects: lowEffects(),
        sdk: sessions.getSdkInfo()
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
      const options = {
        title: '选择工作目录',
        properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>
      }
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
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

  ipcMain.handle(IPC_CHANNELS.stopSession, () =>
    run(async () => {
      await sessions.stopCurrent()
      return undefined
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

  ipcMain.handle(IPC_CHANNELS.setPermissionMode, (_event, raw: unknown) =>
    run(async () => {
      const { mode } = setPermissionModeSchema.parse(raw)
      return sessions.setPermissionMode(mode)
    })
  )

  ipcMain.handle(IPC_CHANNELS.permissionResponse, (_event, raw: unknown) =>
    run(() => {
      const decision = permissionDecisionSchema.parse(raw)
      sessions.respondPermission(decision)
      return undefined
    })
  )

  ipcMain.handle(IPC_CHANNELS.listSessions, () => run(() => sessions.getSessions()))

  ipcMain.handle(IPC_CHANNELS.loadSession, (_event, raw: unknown) =>
    run(() => {
      const { sessionId } = sessionIdSchema.parse(raw)
      return sessions.loadSession(sessionId)
    })
  )

  ipcMain.handle(IPC_CHANNELS.renameSession, (_event, raw: unknown) =>
    run(() => {
      const { sessionId, title } = renameSessionSchema.parse(raw)
      return sessions.renameSession(sessionId, title)
    })
  )

  ipcMain.handle(IPC_CHANNELS.deleteSession, (_event, raw: unknown) =>
    run(async () => {
      const { sessionId } = sessionIdSchema.parse(raw)
      await sessions.deleteSession(sessionId)
      return undefined
    })
  )

  ipcMain.handle(IPC_CHANNELS.readWorkspaceConfig, (_event, raw: unknown) =>
    run(() => config.readWorkspaceConfig(parseCwd(config, raw)))
  )

  ipcMain.handle(IPC_CHANNELS.writeWorkspaceConfig, (_event, raw: unknown) =>
    run(() => {
      const { cwd, values } = workspaceConfigSchema.parse(raw)
      return config.writeWorkspaceConfig(cwd ?? config.getSettings().workspace, values)
    })
  )

  ipcMain.handle(IPC_CHANNELS.clearWorkspaceConfig, (_event, raw: unknown) =>
    run(() => config.clearWorkspaceConfig(parseCwd(config, raw)))
  )

  ipcMain.handle(IPC_CHANNELS.windowControl, (_event, raw: unknown) =>
    run(() => {
      const { action } = windowControlSchema.parse(raw)
      const window = getWindow()
      if (!window) return undefined
      if (action === 'minimize') window.minimize()
      else if (action === 'close') window.close()
      else if (window.isMaximized()) window.unmaximize()
      else window.maximize()
      return undefined
    })
  )
}
