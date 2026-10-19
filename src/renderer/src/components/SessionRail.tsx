import { useRelayStore } from '../store/useRelayStore'
import { baseName, dateStamp, number, clock } from '../lib/format'

export function SessionRail(): React.JSX.Element {
  const session = useRelayStore((state) => state.session)
  const usage = useRelayStore((state) => state.usage)
  const phase = useRelayStore((state) => state.phase)
  const bootstrap = useRelayStore((state) => state.bootstrap)
  const startSession = useRelayStore((state) => state.startSession)
  const setRightTab = useRelayStore((state) => state.setRightTab)

  const busy = phase === 'busy' || phase === 'starting'

  return (
    <aside className="ef-rail">
      <div className="ef-rail-head">
        <div>
          <div className="ef-eyebrow">
            <span className="ef-label">SESSIONS</span>
          </div>
          <h2 className="ef-title-cn">会话</h2>
        </div>
        <span className="ef-rail-count ef-num">{session ? '01' : '00'}</span>
      </div>

      <div className="ef-rail-list">
        {session ? (
          <div className="ef-record ef-record-current">
            <span className="ef-record-trace" aria-hidden="true" />
            <div className="ef-record-top">
              <span className="ef-record-no ef-num">No.001</span>
              <span className="ef-record-date ef-num">{dateStamp(session.startedAt)}</span>
            </div>
            <div className="ef-record-name">{baseName(session.cwd)}</div>
            <div className="ef-record-bottom">
              <span className="ef-label">{session.resumed ? 'RESUMED' : 'CURRENT'}</span>
              <span className="ef-record-metric ef-num">
                {usage ? `${usage.percent.toFixed(1)}%` : '—'}
              </span>
            </div>
          </div>
        ) : (
          <p className="ef-rail-empty">
            还没有会话。配置密钥后新建一个，时间线会从这里开始记录。
          </p>
        )}
      </div>

      <div className="ef-rail-meta">
        <div className="ef-field-row">
          <span className="ef-label">STARTED</span>
          <span className="ef-num">{session ? clock(session.startedAt) : '—'}</span>
        </div>
        <div className="ef-field-row">
          <span className="ef-label">SDK</span>
          <span className="ef-num">{bootstrap?.sdk.version ?? '—'}</span>
        </div>
        <div className="ef-field-row">
          <span className="ef-label">CLI</span>
          <span className="ef-num">{session?.cliVersion ?? bootstrap?.sdk.cliVersion ?? '—'}</span>
        </div>
        <div className="ef-field-row">
          <span className="ef-label">CTX</span>
          <span className="ef-num">
            {usage ? `${number(usage.contextTokens)} / ${number(usage.contextWindow)}` : '—'}
          </span>
        </div>
      </div>

      <div className="ef-rail-foot">
        <button
          type="button"
          className="ef-button ef-button-primary ef-button-block"
          onClick={() => void startSession()}
          disabled={!bootstrap?.hasApiKey || phase === 'starting'}
        >
          新建会话
        </button>
        {!bootstrap?.hasApiKey ? (
          <button
            type="button"
            className="ef-link-button"
            onClick={() => setRightTab('setup')}
          >
            先配置 API Key
          </button>
        ) : (
          <p className="ef-rail-note">
            {busy ? '当前会话运行中；新建会先结束当前会话。' : '当前版本一次只运行一个会话。'}
          </p>
        )}
      </div>
    </aside>
  )
}
