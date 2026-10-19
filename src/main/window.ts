import { BrowserWindow, shell } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { IPC_CHANNELS } from '@shared/ipc'
import type { ConfigService } from './services/config-service'

const here = dirname(fileURLToPath(import.meta.url))

export function createMainWindow(config: ConfigService): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const saved = config.getWindowState()

  const window = new BrowserWindow({
    width: saved?.width ?? 1280,
    height: saved?.height ?? 840,
    ...(saved?.x !== undefined && saved?.y !== undefined ? { x: saved.x, y: saved.y } : {}),
    minWidth: 940,
    minHeight: 620,
    show: false,
    title: 'Relay',
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

  if (saved?.maximized) window.maximize()

  const sendMaximized = (): void => {
    if (window.isDestroyed()) return
    window.webContents.send(IPC_CHANNELS.windowMaximized, window.isMaximized())
  }
  window.on('maximize', sendMaximized)
  window.on('unmaximize', sendMaximized)

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

  window.once('ready-to-show', () => {
    window.show()
    sendMaximized()
  })

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
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(here, '../renderer/index.html'))
  }

  return window
}
