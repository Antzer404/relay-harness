import { useRelayStore } from '../../store/useRelayStore'

function summarize(payload: unknown): string {
  try {
    return JSON.stringify(payload).replace(/\s+/g, ' ').slice(0, 220)
  } catch {
    return String(payload)
  }
}

export function TracePanel(): React.JSX.Element {
  const trace = useRelayStore((state) => state.trace)
  const visible = trace.slice(-120)

  return (
    <div className="ef-trace">
      <div className="ef-trace-head">
        <span className="ef-label">EVENTS</span>
        <span className="ef-num">{trace.length} 条已记录</span>
      </div>
      {visible.length === 0 ? (
        <div className="ef-panel-empty">
          <div className="ef-label">NO EVENTS</div>
          <p>运行时事件会按顺序记录在这里，用于核对流式输出与工具调用。</p>
        </div>
      ) : (
        <ol className="ef-trace-list">
          {visible.map((entry) => (
            <li key={`${entry.sessionId}-${entry.seq}`} className="ef-trace-row">
              <details>
                <summary>
                  <span className="ef-num ef-trace-seq">
                    #{String(entry.seq).padStart(4, '0')}
                  </span>
                  <span className="ef-num ef-trace-time">
                    {new Date(entry.ts).toLocaleTimeString('zh-CN', { hour12: false })}
                  </span>
                  <span className="ef-trace-type">{entry.event.type}</span>
                  <span className="ef-trace-summary">{summarize(entry.event)}</span>
                </summary>
                <pre>{JSON.stringify(entry.event, null, 2)}</pre>
              </details>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
