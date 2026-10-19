import { app } from 'electron'

/** Subset of Electron's GPUFeatureStatus that matters for the UI decision. */
interface GpuStatusView {
  gpu_compositing?: unknown
  rasterization?: unknown
  webgl?: unknown
}

function gpuStatus(): GpuStatusView {
  try {
    return app.getGPUFeatureStatus() as unknown as GpuStatusView
  } catch {
    return {}
  }
}

/**
 * Whether the renderer should trade the glass look for cheaper effects.
 *
 * The UI leans on backdrop-filter over large surfaces; when Chromium falls
 * back to software compositing (VM, remote session, blocked GPU process) that
 * costs every repaint. `RELAY_DISABLE_GPU=1` always implies software mode.
 */
export function lowEffects(): boolean {
  if (process.env.RELAY_DISABLE_GPU === '1') return true
  return gpuStatus().gpu_compositing !== 'enabled'
}

export function logGpuStatus(): void {
  const status = gpuStatus()
  console.log(
    `[relay] gpu compositing=${String(status.gpu_compositing)} rasterization=${String(
      status.rasterization
    )} webgl=${String(status.webgl)} lowEffects=${lowEffects()}`
  )
}
