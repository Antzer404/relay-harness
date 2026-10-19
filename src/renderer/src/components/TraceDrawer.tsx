import { useRelayStore } from '../store/useRelayStore'
import { IconClose } from './icons'

function summarize(payload: unknown): string {
  try {
    return JSON.stringify(payload).replace(/\s+/g, ' ').slice(0, 180)
  } catch {
    return String(payload)
  }
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 10_000) return `${Math.round(value / 1000)}k`
  return value.toLocaleString('en-US')
}

function UsagePanel(): React.JSX.Element {
  const usage = useRelayStore((state) => state.usage)

  if (!usage) {
    return (
      <div className="rly-usage-panel">
        <div className="rly-usage-head">
          <span>上下文填充率</span>
          <span className="rly-usage-percent">—</span>
        </div>
        <p className="rly-usage-empty">本轮尚未上报 usage，发送一条消息后这里会显示填充率。</p>
      </div>
    )
  }

  const level = usage.percent >= 90 ? 'danger' : usage.percent >= 80 ? 'warn' : 'ok'

  return (
    <div className="rly-usage-panel">
      <div className="rly-usage-head">
        <span>上下文填充率{usage.estimated ? <em>估算</em> : null}</span>
        <span className={`rly-usage-percent is-${level}`}>{usage.percent.toFixed(2)}%</span>
      </div>
      <div className="rly-usage-bar" role="progressbar" aria-valuenow={usage.percent} aria-valuemin={0} aria-valuemax={100}>
        <span className={`is-${level}`} style={{ width: `${Math.min(100, Math.max(0.5, usage.percent))}%` }} />
      </div>
      <div className="rly-usage-grid">
        <div>
          <span>上下文</span>
          <em>
            {formatTokens(usage.contextTokens)} / {formatTokens(usage.contextWindow)}
          </em>
        </div>
        <div>
          <span>本轮成本</span>
          <em>${usage.costUsd.toFixed(4)}</em>
        </div>
        <div>
          <span>输入 / 输出</span>
          <em>
            {formatTokens(usage.inputTokens)} / {formatTokens(usage.outputTokens)}
          </em>
        </div>
        <div>
          <span>缓存读 / 写</span>
          <em>
            {formatTokens(usage.cacheRead)} / {formatTokens(usage.cacheWrite)}
          </em>
        </div>
        <div className="rly-usage-model">
          <span>模型</span>
          <em title={usage.model}>{usage.model || '—'}</em>
        </div>
      </div>
    </div>
  )
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

        <UsagePanel />

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
