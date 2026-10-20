import { app } from 'electron'
import { join } from 'node:path'
import { ConfigService } from './services/config-service'
import {
  BUILTIN_MANIFEST,
  builtinSkillsSourceDir,
  installBuiltinSkills
} from './services/builtin-skills'
import { HostRegistry } from './hosts'
import { registerIpc } from './ipc'
import { gpuCompositingEnabled, logGpuStatus } from './perf'

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
} else {
  // Chromium otherwise aborts the whole app ("GPU process isn't usable.
  // Goodbye.") after a few failed GPU launches, so a host whose GPU process
  // cannot start never reaches the window. With the limit disabled the app
  // keeps running and compositing falls back to software; the renderer sees
  // that through getGPUFeatureStatus() and switches to low effects.
  app.commandLine.appendSwitch('disable-gpu-process-crash-limit')
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
    if (!gpuCompositingEnabled()) {
      console.warn('[relay] GPU compositing unavailable; running with software rendering')
    }

    const userDataDir = app.getPath('userData')
    const config = new ConfigService(userDataDir)
    // Bundled skills are copied into the user-level skills folder before any
    // window opens, so the settings list and new sessions see them.
    const builtins = installBuiltinSkills({
      sourceDir: builtinSkillsSourceDir({
        isPackaged: app.isPackaged,
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath
      }),
      targetDir: config.getSkillsDir(),
      manifestPath: join(userDataDir, BUILTIN_MANIFEST),
      log: (message) => console.warn(`[relay] ${message}`)
    })
    if (builtins.installed.length > 0 || builtins.updated.length > 0) {
      console.log(
        `[relay] builtin skills installed=${builtins.installed.join(',') || '-'} updated=${
          builtins.updated.join(',') || '-'
        }`
      )
    }
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
