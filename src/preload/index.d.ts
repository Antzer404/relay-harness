import type { RelayApi } from '@shared/ipc'

declare global {
  interface Window {
    relay: RelayApi
  }
}

export {}
