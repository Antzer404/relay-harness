import { app } from 'electron'
import { ConfigService } from './services/config-service'
import { HostRegistry } from './hosts'
import { registerIpc } from './ipc'
import { logGpuStatus } from './perf'

let registry: HostRegistry | null = null

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
    const target = registry?.getMain()?.window ?? registry?.all()[0]?.window
    if (!target || target.isDestroyed()) return
    if (target.isMinimized()) target.restore()
    target.focus()
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('com.antzer404.relay')
    logGpuStatus()

    const userDataDir = app.getPath('userData')
    const config = new ConfigService(userDataDir)
    registry = new HostRegistry({
      isPackaged: app.isPackaged,
      userDataDir,
      config
    })
    registry.createMain()
    registerIpc({
      appVersion: app.getVersion(),
      config,
      hosts: registry
    })

    app.on('activate', () => {
      if (!registry?.getMain()) registry?.createMain()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    void registry?.disposeAll()
  })
}
