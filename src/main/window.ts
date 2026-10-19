import { BrowserWindow, shell } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export function createMainWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const isWindows = process.platform === 'win32'

  const window = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    title: 'Relay',
    backgroundColor: '#F4F4F2',
    titleBarStyle: isMac ? 'hiddenInset' : isWindows ? 'hidden' : 'default',
    ...(isMac ? { trafficLightPosition: { x: 16, y: 15 } } : {}),
    ...(isWindows
      ? { titleBarOverlay: { color: '#161616', symbolColor: '#F4F4F2', height: 44 } }
      : {}),
    webPreferences: {
      preload: join(here, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  window.once('ready-to-show', () => window.show())

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
