import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { IpcResult } from '@shared/events'
import { IPC_CHANNELS } from '@shared/ipc'
import {
  acceptHandoffSchema,
  apiKeySchema,
  handoffIdSchema,
  listHandoffsSchema,
  permissionDecisionSchema,
  removeAllowedToolSchema,
  renameSessionSchema,
  sendSchema,
  sessionIdSchema,
  setPermissionModeSchema,
  settingsPatchSchema,
  startSessionSchema,
  updateHandoffSchema,
  windowControlSchema,
  workspaceConfigCwdSchema,
  workspaceConfigSchema
} from '@shared/schemas'
import type { HostRegistry, SessionHost } from './hosts'
import type { ConfigService } from './services/config-service'
import { RelayError } from './services/session-manager'
import { lowEffects } from './perf'

interface IpcDeps {
  appVersion: string
  config: ConfigService
  hosts: HostRegistry
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

function hostOf(hosts: HostRegistry, event: IpcMainInvokeEvent): SessionHost {
  const host = hosts.hostFor(event.sender.id)
  if (!host) throw new RelayError('window_missing', '找不到这个窗口对应的会话')
  return host
}

function parseCwd(host: SessionHost, config: ConfigService, raw: unknown): string {
  if (host.kind === 'project' && host.folder) return host.folder
  const parsed = workspaceConfigCwdSchema.parse(raw ?? {})
  return parsed.cwd ?? config.getSettings().workspace
}

function scopedCwd(host: SessionHost, config: ConfigService, cwd: string | undefined): string {
  if (host.kind === 'project' && host.folder) return host.folder
  return cwd ?? config.getSettings().workspace
}

export function registerIpc({ appVersion, config, hosts }: IpcDeps): void {
  ipcMain.handle(IPC_CHANNELS.bootstrap, (event) =>
    run(() => {
      const host = hostOf(hosts, event)
      config.ensureWorkspace()
      const settings = config.getSettings()
      const cwd = host.folder ?? settings.workspace
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
        session: host.sessions.getCurrent(),
        sessions: host.sessions.getSessions(),
        lowEffects: lowEffects(),
        windowKind: host.kind,
        project: host.sessions.getProjectInfo(),
        memory: host.sessions.getMemoryInfo(cwd),
        sdk: host.sessions.getSdkInfo()
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

  ipcMain.handle(IPC_CHANNELS.chooseWorkspace, (event) =>
    run(async () => {
      const host = hostOf(hosts, event)
      if (host.kind !== 'main') {
        throw new RelayError('project_window', 'Project 窗口的工作文件夹在打开时已固定')
      }
      const window = host.window
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

  ipcMain.handle(IPC_CHANNELS.openProjectWindow, (event) =>
    run(async () => {
      const host = hostOf(hosts, event)
      if (host.kind !== 'main') {
        throw new RelayError('project_window', '只有主窗口可以打开 Project')
      }
      const options = {
        title: '选择 Project 工作文件夹',
        properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>
      }
      const result = await dialog.showOpenDialog(host.window, options)
      if (result.canceled || !result.filePaths[0]) return false
      hosts.openProject(result.filePaths[0])
      return true
    })
  )

  ipcMain.handle(IPC_CHANNELS.startSession, (event, raw: unknown) =>
    run(async () => {
      const host = hostOf(hosts, event)
      const options = raw === undefined ? {} : startSessionSchema.parse(raw)
      return host.sessions.startSession(options)
    })
  )

  ipcMain.handle(IPC_CHANNELS.stopSession, (event) =>
    run(async () => {
      await hostOf(hosts, event).sessions.stopCurrent()
      return undefined
    })
  )

  ipcMain.handle(IPC_CHANNELS.send, (event, raw: unknown) =>
    run(() => {
      const host = hostOf(hosts, event)
      const { text } = sendSchema.parse(raw)
      host.sessions.send(text)
      return undefined
    })
  )

  ipcMain.handle(IPC_CHANNELS.interrupt, (event) =>
    run(async () => {
      await hostOf(hosts, event).sessions.interrupt()
      return undefined
    })
  )

  ipcMain.handle(IPC_CHANNELS.setPermissionMode, (event, raw: unknown) =>
    run(async () => {
      const host = hostOf(hosts, event)
      const { mode } = setPermissionModeSchema.parse(raw)
      return host.sessions.setPermissionMode(mode)
    })
  )

  ipcMain.handle(IPC_CHANNELS.permissionResponse, (event, raw: unknown) =>
    run(() => {
      const host = hostOf(hosts, event)
      const decision = permissionDecisionSchema.parse(raw)
      host.sessions.respondPermission(decision)
      return undefined
    })
  )

  ipcMain.handle(IPC_CHANNELS.listSessions, (event) =>
    run(() => hostOf(hosts, event).sessions.getSessions())
  )

  ipcMain.handle(IPC_CHANNELS.loadSession, (event, raw: unknown) =>
    run(() => {
      const host = hostOf(hosts, event)
      const { sessionId } = sessionIdSchema.parse(raw)
      return host.sessions.loadSession(sessionId)
    })
  )

  ipcMain.handle(IPC_CHANNELS.renameSession, (event, raw: unknown) =>
    run(() => {
      const host = hostOf(hosts, event)
      const { sessionId, title } = renameSessionSchema.parse(raw)
      return host.sessions.renameSession(sessionId, title)
    })
  )

  ipcMain.handle(IPC_CHANNELS.deleteSession, (event, raw: unknown) =>
    run(async () => {
      const host = hostOf(hosts, event)
      const { sessionId } = sessionIdSchema.parse(raw)
      await host.sessions.deleteSession(sessionId)
      return undefined
    })
  )

  ipcMain.handle(IPC_CHANNELS.readWorkspaceConfig, (event, raw: unknown) =>
    run(() => {
      const host = hostOf(hosts, event)
      return config.readWorkspaceConfig(parseCwd(host, config, raw))
    })
  )

  ipcMain.handle(IPC_CHANNELS.writeWorkspaceConfig, (event, raw: unknown) =>
    run(() => {
      const host = hostOf(hosts, event)
      const { cwd, values } = workspaceConfigSchema.parse(raw)
      return config.writeWorkspaceConfig(scopedCwd(host, config, cwd), values)
    })
  )

  ipcMain.handle(IPC_CHANNELS.clearWorkspaceConfig, (event, raw: unknown) =>
    run(() => {
      const host = hostOf(hosts, event)
      return config.clearWorkspaceConfig(parseCwd(host, config, raw))
    })
  )

  ipcMain.handle(IPC_CHANNELS.removeAllowedTool, (event, raw: unknown) =>
    run(() => {
      const host = hostOf(hosts, event)
      const { cwd, rule } = removeAllowedToolSchema.parse(raw)
      return config.removeWorkspaceAllowedTool(scopedCwd(host, config, cwd), rule)
    })
  )

  ipcMain.handle(IPC_CHANNELS.requestHandoff, (event) =>
    run(() => hostOf(hosts, event).sessions.requestHandoff())
  )

  ipcMain.handle(IPC_CHANNELS.listHandoffs, (event, raw: unknown) =>
    run(() => {
      const host = hostOf(hosts, event)
      const { sessionId } = raw === undefined ? {} : listHandoffsSchema.parse(raw)
      return host.sessions.listHandoffs(sessionId)
    })
  )

  ipcMain.handle(IPC_CHANNELS.updateHandoff, (event, raw: unknown) =>
    run(() => {
      const host = hostOf(hosts, event)
      const { handoffId, markdown } = updateHandoffSchema.parse(raw)
      return host.sessions.updateHandoff(handoffId, markdown)
    })
  )

  ipcMain.handle(IPC_CHANNELS.deleteHandoff, (event, raw: unknown) =>
    run(() => {
      const host = hostOf(hosts, event)
      const { handoffId } = handoffIdSchema.parse(raw)
      host.sessions.deleteHandoff(handoffId)
      return undefined
    })
  )

  ipcMain.handle(IPC_CHANNELS.acceptHandoff, (event, raw: unknown) =>
    run(() => {
      const host = hostOf(hosts, event)
      const { handoffId, markdown } = acceptHandoffSchema.parse(raw)
      return host.sessions.acceptHandoff(handoffId, markdown)
    })
  )

  ipcMain.handle(IPC_CHANNELS.windowControl, (event, raw: unknown) =>
    run(() => {
      const { action } = windowControlSchema.parse(raw)
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) return undefined
      if (action === 'minimize') window.minimize()
      else if (action === 'close') window.close()
      else if (window.isMaximized()) window.unmaximize()
      else window.maximize()
      return undefined
    })
  )
}
