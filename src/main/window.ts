import { BrowserWindow, shell } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { IPC_CHANNELS } from '@shared/ipc'
import type { ConfigService } from './services/config-service'

const here = dirname(fileURLToPath(import.meta.url))

interface ShellOptions {
  title: string
  width: number
  height: number
  minWidth: number
  minHeight: number
  x?: number
  y?: number
}

function buildWindow(options: ShellOptions): BrowserWindow {
  const isMac = process.platform === 'darwin'
  return new BrowserWindow({
    width: options.width,
    height: options.height,
    ...(options.x !== undefined && options.y !== undefined
      ? { x: options.x, y: options.y }
      : {}),
    minWidth: options.minWidth,
    minHeight: options.minHeight,
    show: false,
    title: options.title,
    backgroundColor: '#f2f3f6',
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 18 } }
      : { frame: false }),
    webPreferences: {
      preload: join(here, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })
}

function wireMaximized(window: BrowserWindow): void {
  const sendMaximized = (): void => {
    if (window.isDestroyed()) return
    window.webContents.send(IPC_CHANNELS.windowMaximized, window.isMaximized())
  }
  window.on('maximize', sendMaximized)
  window.on('unmaximize', sendMaximized)
  window.once('ready-to-show', () => {
    window.show()
    sendMaximized()
  })
}

function wireNavigation(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const current = window.webContents.getURL()
    if (url === current) return
    event.preventDefault()
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    // Frameless window has no menu; give dev runs a way into DevTools.
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        window.webContents.toggleDevTools()
        event.preventDefault()
      }
    })
  }
}

function loadRenderer(window: BrowserWindow): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(here, '../renderer/index.html'))
  }
}

export function createMainWindow(config: ConfigService): BrowserWindow {
  const saved = config.getWindowState()
  const window = buildWindow({
    title: 'Relay',
    width: saved?.width ?? 1280,
    height: saved?.height ?? 840,
    ...(saved?.x !== undefined ? { x: saved.x } : {}),
    ...(saved?.y !== undefined ? { y: saved.y } : {}),
    minWidth: 940,
    minHeight: 620
  })

  if (saved?.maximized) window.maximize()

  const saveBounds = (): void => {
    const bounds = window.getNormalBounds()
    config.saveWindowState({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized: window.isMaximized()
    })
  }
  window.on('close', saveBounds)

  wireMaximized(window)
  wireNavigation(window)
  loadRenderer(window)

  return window
}

function folderName(folder: string): string {
  const parts = folder.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? folder
}

/**
 * A Project window is pinned to one folder and runs its own team session;
 * its bounds are not persisted (the main window keeps the app's window state).
 */
export function createProjectWindow(folder: string): BrowserWindow {
  const window = buildWindow({
    title: `Relay Project · ${folderName(folder)}`,
    width: 1360,
    height: 900,
    minWidth: 1040,
    minHeight: 640
  })

  wireMaximized(window)
  wireNavigation(window)
  loadRenderer(window)

  return window
}
