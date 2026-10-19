import { useRelayStore } from '../store/useRelayStore'
import { IconClose } from './icons'

function summarize(payload: unknown): string {
  try {
    return JSON.stringify(payload).replace(/\s+/g, ' ').slice(0, 180)
  } catch {
    return String(payload)
  }
}

export function TraceDrawer(): React.JSX.Element | null {
  const drawer = useRelayStore((state) => state.drawer)
  const openDrawer = useRelayStore((state) => state.openDrawer)
  const trace = useRelayStore((state) => state.trace)

  if (drawer !== 'trace') return null

  const visible = trace.slice(-150).reverse()

  return (
    <div className="rly-scrim rly-scrim-right" onMouseDown={() => openDrawer(null)}>
      <aside
        className="rly-trace-drawer"
        role="dialog"
        aria-label="事件轨迹"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="rly-trace-head">
          <div>
            <h2>事件轨迹</h2>
            <span className="rly-hint">{trace.length} 条事件 · 仅本次运行</span>
          </div>
          <button
            type="button"
            className="rly-icon-btn"
            aria-label="关闭事件轨迹"
            onClick={() => openDrawer(null)}
          >
            <IconClose />
          </button>
        </header>

        {visible.length === 0 ? (
          <p className="rly-trace-empty">发送消息后，运行时事件会按顺序记录在这里。</p>
        ) : (
          <ol className="rly-trace-list">
            {visible.map((entry) => (
              <li key={`${entry.sessionId}-${entry.seq}`} className="rly-trace-row">
                <details>
                  <summary>
                    <span className="rly-trace-seq">#{String(entry.seq).padStart(4, '0')}</span>
                    <span className="rly-trace-time">
                      {new Date(entry.ts).toLocaleTimeString('zh-CN', { hour12: false })}
                    </span>
                    <span className="rly-trace-type">{entry.event.type}</span>
                  </summary>
                  <div className="rly-trace-summary">{summarize(entry.event)}</div>
                  <pre>{JSON.stringify(entry.event, null, 2)}</pre>
                </details>
              </li>
            ))}
          </ol>
        )}
      </aside>
    </div>
  )
}
