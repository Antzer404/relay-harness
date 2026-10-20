import { useEffect, useState } from 'react'
import { useRelayStore } from './store/useRelayStore'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { Timeline } from './components/Timeline'
import { Composer } from './components/Composer'
import { SettingsDialog } from './components/SettingsDialog'
import { TraceDrawer } from './components/TraceDrawer'
import { HandoffDialog } from './components/HandoffDialog'
import { AgentDrawer } from './components/AgentDrawer'

export function App(): React.JSX.Element {
  const init = useRelayStore((state) => state.init)
  const bootstrapped = useRelayStore((state) => state.bootstrapped)
  const fatal = useRelayStore((state) => state.fatal)
  const themeMode = useRelayStore((state) => state.themeMode)
  const platform = useRelayStore((state) => state.bootstrap?.platform ?? 'unknown')
  const lowEffects = useRelayStore((state) => state.bootstrap?.lowEffects ?? false)
  const [resolved, setResolved] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      setResolved(themeMode === 'system' ? (query.matches ? 'dark' : 'light') : themeMode)
    }
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [themeMode])

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])

  // Software compositing makes large backdrop-filter surfaces expensive, so
  // the main process tells us when to fall back to flat surfaces.
  useEffect(() => {
    document.documentElement.dataset.lowfx = lowEffects ? '1' : '0'
  }, [lowEffects])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const state = useRelayStore.getState()
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault()
        state.openDrawer('settings')
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        state.setSidebarOpen(!state.sidebarOpen)
        return
      }
      if (event.key === 'Escape' && state.drawer) {
        state.openDrawer(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="rly-app" data-platform={platform} data-theme={resolved}>
      <div className="rly-ambient" aria-hidden="true">
        <span className="rly-ambient-blob rly-ambient-a" />
        <span className="rly-ambient-blob rly-ambient-b" />
      </div>

      <TopBar />
      <div className="rly-shell">
        <Sidebar />
        <main className="rly-main">
          {fatal ? (
            <div className="rly-fatal">
              <div className="rly-fatal-mark">!</div>
              <h1>运行时不可用</h1>
              <p>{fatal}</p>
              <button
                type="button"
                className="rly-btn rly-btn-primary"
                onClick={() => window.location.reload()}
              >
                重新加载
              </button>
            </div>
          ) : bootstrapped ? (
            <>
              <Timeline />
              <Composer />
            </>
          ) : (
            <div className="rly-booting">
              <span className="rly-booting-dot" />
              <span>正在读取本机配置…</span>
            </div>
          )}
        </main>
      </div>

      <SettingsDialog />
      <TraceDrawer />
      <AgentDrawer />
      <HandoffDialog />
    </div>
  )
}
