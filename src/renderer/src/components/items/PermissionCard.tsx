import { useRelayStore, type PermissionItem } from '../../store/useRelayStore'
import { prettyJson } from '../../lib/format'
import { permissionParamsKey } from '../../lib/item-open-state'
import { useItemOpen } from '../../lib/use-item-open'

const MODE_APPROVAL_LABEL: Record<string, string> = {
  acceptEdits: '批准并自动接受编辑',
  plan: '批准并保持仅规划',
  default: '批准，之后逐次确认'
}

export function PermissionCard({ item }: { item: PermissionItem }): React.JSX.Element {
  const respond = useRelayStore((state) => state.respondPermission)
  const project = useRelayStore((state) => state.project)
  const [showParams, toggleParams] = useItemOpen(permissionParamsKey(item.id), false)

  const agentLabel = item.agentName
    ? (project?.agents.find((agent) => agent.id === item.agentName)?.label ?? item.agentName)
    : null

  // ExitPlanMode-style approvals offer "switch to mode X" suggestions; each
  // becomes its own button so the user picks the post-approval mode.
  const modeChoices: Array<{ mode: string; index: number }> = []
  for (const [index, suggestion] of item.suggestions.entries()) {
    if (!suggestion.mode) continue
    if (modeChoices.some((entry) => entry.mode === suggestion.mode)) continue
    modeChoices.push({ mode: suggestion.mode, index })
  }

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
        {agentLabel ? <span className="rly-permission-agent">{agentLabel} agent</span> : null}
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

          {modeChoices.length > 0 ? (
            <p className="rly-permission-scope">批准后会切换本次会话的权限模式</p>
          ) : (
            <p className="rly-permission-scope">
              始终允许「{item.toolName}」的全部请求，并写入本工作区的{' '}
              <code>.relay/settings.local.json</code>
            </p>
          )}

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
            {modeChoices.length > 0 ? (
              modeChoices.map((choice) => (
                <button
                  key={choice.mode}
                  type="button"
                  className="rly-btn rly-btn-primary"
                  onClick={() => void respond(item.requestId, 'always', undefined, choice.index)}
                >
                  {MODE_APPROVAL_LABEL[choice.mode] ?? `批准并切换到 ${choice.mode}`}
                </button>
              ))
            ) : (
              <button
                type="button"
                className="rly-btn rly-btn-primary"
                onClick={() => void respond(item.requestId, 'always')}
                title={`允许「${item.toolName}」这个工具后续不再询问`}
              >
                始终允许
              </button>
            )}
          </div>
        </>
      ) : null}
    </article>
  )
}
