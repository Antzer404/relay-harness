import { useEffect } from 'react'
import { useRelayStore } from './store/useRelayStore'
import { CommandBar } from './components/CommandBar'
import { SessionRail } from './components/SessionRail'
import { Timeline } from './components/Timeline'
import { Composer } from './components/Composer'
import { RightPanel } from './components/RightPanel'
import { PermissionModal } from './components/PermissionModal'

export function App(): React.JSX.Element {
  const init = useRelayStore((state) => state.init)
  const bootstrapped = useRelayStore((state) => state.bootstrapped)
  const fatal = useRelayStore((state) => state.fatal)
  const theme = useRelayStore((state) => state.theme)
  const platform = useRelayStore((state) => state.bootstrap?.platform ?? 'unknown')

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  return (
    <div className="ef-app" data-platform={platform}>
      <CommandBar />
      <div className="ef-body">
        <SessionRail />
        <main className="ef-main">
          <div className="ef-tricolor" aria-hidden="true" />
          {fatal ? (
            <div className="ef-fatal">
              <div className="ef-flag" aria-hidden="true" />
              <div>
                <div className="ef-label">RUNTIME ERROR</div>
                <div className="ef-fatal-title">运行时不可用</div>
                <p>{fatal}</p>
              </div>
            </div>
          ) : bootstrapped ? (
            <>
              <Timeline />
              <Composer />
            </>
          ) : (
            <div className="ef-loading">
              <span className="ef-label">BOOTING</span>
              <span>正在读取本机配置…</span>
            </div>
          )}
        </main>
        <RightPanel />
      </div>
      <PermissionModal />
    </div>
  )
}
