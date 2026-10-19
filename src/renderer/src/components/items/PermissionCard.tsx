import { useRelayStore, type PermissionItem } from '../../store/useRelayStore'
import { prettyJson } from '../../lib/format'
import { permissionParamsKey } from '../../lib/item-open-state'
import { useItemOpen } from '../../lib/use-item-open'

export function PermissionCard({ item }: { item: PermissionItem }): React.JSX.Element {
  const respond = useRelayStore((state) => state.respondPermission)
  const [showParams, toggleParams] = useItemOpen(permissionParamsKey(item.id), false)

  const canAlways = item.suggestions.length > 0 && item.status === 'pending'

  return (
    <article className={`rly-permission is-${item.status}`}>
      <header className="rly-permission-head">
        <span className="rly-permission-dot" aria-hidden="true" />
        <span className="rly-permission-title">
          {item.status === 'pending'
            ? '需要批准'
            : item.status === 'allowed'
              ? '已允许'
              : '已拒绝'}
        </span>
        <span className="rly-permission-tool">{item.toolName}</span>
      </header>

      <p className="rly-permission-lead">
        {item.status === 'pending'
          ? (item.title ?? `模型请求使用工具「${item.toolName}」。`)
          : `工具「${item.toolName}」的请求已处理。`}
      </p>
      {item.decisionReason ? (
        <p className="rly-permission-note">{item.decisionReason}</p>
      ) : null}
      {item.blockedPath ? (
        <p className="rly-permission-note">
          触发路径：<code>{item.blockedPath}</code>
        </p>
      ) : null}

      {item.status === 'pending' ? (
        <>
          <button
            type="button"
            className="rly-permission-params-toggle"
            onClick={toggleParams}
          >
            {showParams ? '收起参数' : '查看参数'}
          </button>
          {showParams ? <pre className="rly-permission-params">{prettyJson(item.input)}</pre> : null}

          {canAlways ? (
            <p className="rly-permission-scope">
              始终允许会写入本工作区的 <code>.relay/settings.local.json</code>
            </p>
          ) : null}

          <div className="rly-permission-actions">
            <button
              type="button"
              className="rly-btn rly-btn-ghost"
              onClick={() => void respond(item.requestId, 'deny')}
            >
              拒绝
            </button>
            <button
              type="button"
              className="rly-btn"
              onClick={() => void respond(item.requestId, 'allow')}
            >
              仅本次允许
            </button>
            <button
              type="button"
              className="rly-btn rly-btn-primary"
              disabled={!canAlways}
              title={canAlways ? undefined : 'CLI 没有提供可持久化的授权范围'}
              onClick={() => void respond(item.requestId, 'always')}
            >
              始终允许
            </button>
          </div>
        </>
      ) : null}
    </article>
  )
}
