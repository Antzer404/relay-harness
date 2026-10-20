import { BrowserWindow } from 'electron'
import { resolve } from 'node:path'
import type { RelayEvent } from '@shared/events'
import { IPC_CHANNELS } from '@shared/ipc'
import type { ConfigService } from './services/config-service'
import { HandoffStore } from './services/handoff-store'
import { MemoryStore } from './services/memory-store'
import { SessionManager, type SharedStores } from './services/session-manager'
import { SessionStore } from './services/session-store'
import { createMainWindow, createProjectWindow } from './window'

export interface SessionHost {
  kind: 'main' | 'project'
  /** Fixed working folder for a project window; null for the main window. */
  folder: string | null
  sessions: SessionManager
  window: BrowserWindow
}

interface HostRegistryOptions {
  isPackaged: boolean
  userDataDir: string
  config: ConfigService
}

function projectKey(folder: string): string {
  const resolved = resolve(folder)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/**
 * One SessionManager per window, sharing the on-disk stores. The main window
 * runs ordinary chat; each Project window is pinned to one folder and owns
 * its own team session.
 */
export class HostRegistry {
  private main: SessionHost | null = null
  private readonly projects = new Map<string, SessionHost>()
  private readonly byWebContents = new Map<number, SessionHost>()
  private readonly stores: SharedStores

  constructor(private readonly options: HostRegistryOptions) {
    this.stores = {
      sessions: new SessionStore(options.userDataDir),
      handoffs: new HandoffStore(options.userDataDir),
      memory: new MemoryStore(options.userDataDir)
    }
  }

  getMain(): SessionHost | null {
    return this.main && !this.main.window.isDestroyed() ? this.main : null
  }

  hostFor(webContentsId: number): SessionHost | null {
    return this.byWebContents.get(webContentsId) ?? null
  }

  all(): SessionHost[] {
    return [...this.byWebContents.values()]
  }

  createMain(): SessionHost {
    const existing = this.getMain()
    if (existing) return existing
    const window = createMainWindow(this.options.config)
    this.main = this.createHost('main', null, window)
    return this.main
  }

  /** Opens a project window, or focuses the one already bound to the folder. */
  openProject(rawFolder: string): SessionHost {
    const folder = resolve(rawFolder)
    const key = projectKey(folder)
    const existing = this.projects.get(key)
    if (existing && !existing.window.isDestroyed()) {
      if (existing.window.isMinimized()) existing.window.restore()
      existing.window.show()
      existing.window.focus()
      return existing
    }
    const window = createProjectWindow(folder)
    const host = this.createHost('project', folder, window)
    this.projects.set(key, host)
    return host
  }

  async disposeAll(): Promise<void> {
    await Promise.all(
      this.all().map(async (host) => {
        host.sessions.denyPendingPermissions('应用正在退出，操作已自动拒绝。')
        await host.sessions.dispose()
      })
    )
  }

  private createHost(
    kind: SessionHost['kind'],
    folder: string | null,
    window: BrowserWindow
  ): SessionHost {
    const webContentsId = window.webContents.id
    const host: SessionHost = {
      kind,
      folder,
      window,
      sessions: null as unknown as SessionManager
    }
    host.sessions = new SessionManager(this.options.config, {
      isPackaged: this.options.isPackaged,
      userDataDir: this.options.userDataDir,
      stores: this.stores,
      emit: (event: RelayEvent) => {
        if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.event, event)
      },
      ...(folder ? { workspaceOverride: folder, projectMode: true } : {})
    })

    this.byWebContents.set(webContentsId, host)

    window.on('closed', () => {
      this.byWebContents.delete(webContentsId)
      host.sessions.denyPendingPermissions('窗口已关闭，操作已自动拒绝。')
      void host.sessions.dispose()
      if (kind === 'main' && this.main === host) this.main = null
      if (kind === 'project' && folder && this.projects.get(projectKey(folder)) === host) {
        this.projects.delete(projectKey(folder))
      }
    })
    window.webContents.on('render-process-gone', () => {
      host.sessions.denyPendingPermissions('渲染进程已崩溃，操作已自动拒绝。')
    })

    return host
  }
}
