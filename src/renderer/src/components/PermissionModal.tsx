import { useEffect, useState } from 'react'
import { useRelayStore } from '../store/useRelayStore'
import { prettyJson } from '../lib/format'

export function PermissionModal(): React.JSX.Element | null {
  const pending = useRelayStore((state) => state.pendingPermission)
  const respond = useRelayStore((state) => state.respondPermission)
  const [reason, setReason] = useState('')

  useEffect(() => {
    setReason('')
  }, [pending?.requestId])

  useEffect(() => {
    if (!pending) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        void respond('deny')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, respond])

  if (!pending) return null

  const canAlways = pending.suggestions.length > 0

  return (
    <div className="ef-scrim">
      <div className="ef-permission" role="dialog" aria-modal="true" aria-labelledby="ef-permission-title">
        <div className="ef-permission-head">
          <div>
            <div className="ef-eyebrow">
              <span className="ef-permission-mark" aria-hidden="true" />
              <span className="ef-label">PERMISSION</span>
            </div>
            <h2 id="ef-permission-title" className="ef-permission-title">
              权限请求 · {pending.toolName}
            </h2>
          </div>
          <span className="ef-permission-id ef-num">#{pending.requestId.slice(0, 8)}</span>
        </div>

        <div className="ef-permission-body">
          <p className="ef-permission-lead">
            {pending.title ?? `Claude 请求使用工具「${pending.toolName}」。`}
          </p>
          {pending.decisionReason ? (
            <p className="ef-permission-reason">{pending.decisionReason}</p>
          ) : null}
          {pending.blockedPath ? (
            <p className="ef-permission-reason">
              触发路径：<code>{pending.blockedPath}</code>
            </p>
          ) : null}

          <div className="ef-detail-block">
            <div className="ef-label">PARAMETERS</div>
            <pre>{prettyJson(pending.input)}</pre>
          </div>

          <div className="ef-permission-scope">
            <div className="ef-label">ALWAYS ALLOW SCOPE</div>
            {canAlways ? (
              <ul>
                {pending.suggestions.map((suggestion, index) => (
                  <li key={`${suggestion.label}-${index}`}>
                    <span className="ef-num">{suggestion.label}</span>
                    <span className="ef-label">{suggestion.destination}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ef-detail-note">CLI 没有提供可持久化的授权范围，只能允许本次。</p>
            )}
          </div>

          <label className="ef-field-label" htmlFor="ef-deny-reason">
            拒绝说明（可选）
          </label>
          <input
            id="ef-deny-reason"
            className="ef-input"
            value={reason}
            placeholder="告诉模型为什么拒绝，便于它换一种做法"
            onChange={(event) => setReason(event.target.value)}
          />
        </div>

        <div className="ef-permission-actions">
          <button
            type="button"
            className="ef-button ef-button-ghost"
            autoFocus
            onClick={() => void respond('deny', reason)}
          >
            拒绝
            <span className="ef-key-hint">ESC</span>
          </button>
          <button
            type="button"
            className="ef-button ef-button-ghost"
            onClick={() => void respond('allow')}
          >
            仅本次允许
          </button>
          <button
            type="button"
            className="ef-button ef-button-primary"
            disabled={!canAlways}
            title={canAlways ? '把 CLI 建议的规则应用到建议的作用域' : '没有可用的持久化范围'}
            onClick={() => void respond('always')}
          >
            总是允许
          </button>
        </div>
      </div>
    </div>
  )
}
