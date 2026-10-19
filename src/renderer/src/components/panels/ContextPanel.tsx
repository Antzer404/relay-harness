import { useRelayStore } from '../../store/useRelayStore'
import { cost, number, shortModel } from '../../lib/format'

export function ContextPanel(): React.JSX.Element {
  const usage = useRelayStore((state) => state.usage)
  const session = useRelayStore((state) => state.session)
  const phase = useRelayStore((state) => state.phase)

  if (!usage) {
    return (
      <div className="ef-panel-empty">
        <div className="ef-label">NO USAGE YET</div>
        <p>完成一轮对话后，这里会显示上下文占用、缓存读写与会话成本。</p>
        <p className="ef-empty-sub">当前状态：{phase}{session ? ` · ${shortModel(session.model)}` : ''}</p>
      </div>
    )
  }

  const high = usage.percent >= 75

  return (
    <div className="ef-context">
      <div className="ef-context-hero">
        <span className={`ef-context-number ef-num${high ? ' is-high' : ''}`}>
          {usage.percent.toFixed(1)}
          <span className="ef-context-unit">%</span>
        </span>
        <div className="ef-context-hero-meta">
          <span className="ef-label">CONTEXT USED</span>
          <span className="ef-num">
            {number(usage.contextTokens)} / {number(usage.contextWindow)}
          </span>
        </div>
      </div>

      <div className={`ef-meter-track${high ? ' is-high' : ''}`}>
        <span className="ef-meter-fill" style={{ width: `${Math.min(100, usage.percent)}%` }} />
        <span className="ef-meter-tick" style={{ left: '75%' }} aria-hidden="true" />
      </div>

      <div className="ef-spec-list">
        <div className="ef-spec-row">
          <span className="ef-label">MODEL</span>
          <span className="ef-num">{usage.model || shortModel(session?.model)}</span>
        </div>
        <div className="ef-spec-row">
          <span className="ef-label">INPUT</span>
          <span className="ef-num">{number(usage.inputTokens)}</span>
        </div>
        <div className="ef-spec-row">
          <span className="ef-label">OUTPUT</span>
          <span className="ef-num">{number(usage.outputTokens)}</span>
        </div>
        <div className="ef-spec-row">
          <span className="ef-label">CACHE READ</span>
          <span className="ef-num">{number(usage.cacheRead)}</span>
        </div>
        <div className="ef-spec-row">
          <span className="ef-label">CACHE WRITE</span>
          <span className="ef-num">{number(usage.cacheWrite)}</span>
        </div>
        <div className="ef-spec-row">
          <span className="ef-label">SESSION COST</span>
          <span className="ef-num">{cost(usage.costUsd)}</span>
        </div>
        <div className="ef-spec-row">
          <span className="ef-label">SOURCE</span>
          <span className="ef-num">{usage.estimated ? 'CLI USAGE · ESTIMATE' : 'CLI USAGE'}</span>
        </div>
      </div>

      <p className="ef-panel-note">
        上下文占比按最近一次请求的 input、缓存读写与 output 之和估算；窗口大小取自 CLI 的
        modelUsage。
      </p>
    </div>
  )
}
