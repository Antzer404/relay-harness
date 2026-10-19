import { app, BrowserWindow } from 'electron'
import { ConfigService } from './services/config-service'
import { SessionManager } from './services/session-manager'
import { registerIpc } from './ipc'
import { createMainWindow } from './window'
import { logGpuStatus } from './perf'
import { IPC_CHANNELS } from '@shared/ipc'

let mainWindow: BrowserWindow | null = null
let sessions: SessionManager | null = null

function wireWindow(window: BrowserWindow): void {
  window.on('closed', () => {
    sessions?.denyPendingPermissions('窗口已关闭，操作已自动拒绝。')
    void sessions?.dispose()
    if (mainWindow === window) mainWindow = null
  })

  window.webContents.on('render-process-gone', () => {
    sessions?.denyPendingPermissions('渲染进程已崩溃，操作已自动拒绝。')
  })
}

// Some Windows machines (VMs, remote sessions, locked-down GPU drivers) cannot
// launch Chromium's GPU process; this console UI does not need hardware
// acceleration, so allow opting out without a code change.
if (process.env.RELAY_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
  // Keep the GPU pipeline in the browser process when a child GPU process
  // cannot be spawned at all.
  app.commandLine.appendSwitch('in-process-gpu')
  console.log('[relay] hardware acceleration disabled (RELAY_DISABLE_GPU=1)')
}

// Last-resort switch for environments where Chromium child process launch is
// blocked by an external sandbox/policy. Dev only.
if (process.env.RELAY_NO_SANDBOX === '1') {
  app.commandLine.appendSwitch('no-sandbox')
  console.log('[relay] Chromium sandbox disabled (RELAY_NO_SANDBOX=1)')
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('com.antzer404.relay')
    logGpuStatus()

    const userDataDir = app.getPath('userData')
    const config = new ConfigService(userDataDir)
    sessions = new SessionManager(config, {
      isPackaged: app.isPackaged,
      userDataDir,
      emit: (event) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.event, event)
        }
      }
    })

    mainWindow = createMainWindow(config)
    wireWindow(mainWindow)
    registerIpc({
      appVersion: app.getVersion(),
      config,
      sessions,
      getWindow: () => mainWindow
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow(config)
        wireWindow(mainWindow)
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    void sessions?.dispose()
  })
}
