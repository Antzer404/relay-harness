import { AGENT_STATUS_LABEL } from '@shared/agents'
import { useRelayStore } from '../store/useRelayStore'
import { clock, duration, formatTokens } from '../lib/format'
import { Markdown } from './Markdown'
import { IconClose } from './icons'

export function AgentDrawer(): React.JSX.Element | null {
  const drawer = useRelayStore((state) => state.drawer)
  const agentId = useRelayStore((state) => state.activeAgentId)
  const team = useRelayStore((state) => state.team)
  const project = useRelayStore((state) => state.project)
  const openDrawer = useRelayStore((state) => state.openDrawer)

  if (drawer !== 'agent') return null
  const agent = team.agents.find((entry) => entry.id === agentId)
  if (!agent) return null

  const label = project?.agents.find((entry) => entry.id === agent.name)?.label ?? agent.name

  return (
    <div className="rly-scrim rly-scrim-right" onMouseDown={() => openDrawer(null)}>
      <aside
        className="rly-trace-drawer rly-agent-drawer"
        role="dialog"
        aria-label={`成员 ${label}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="rly-trace-head">
          <div>
            <h2>
              {label}
              <span className={`rly-agent-status is-${agent.status}`}>
                {AGENT_STATUS_LABEL[agent.status]}
              </span>
            </h2>
            <span className="rly-hint">{agent.description}</span>
          </div>
          <button
            type="button"
            className="rly-icon-btn"
            aria-label="关闭成员详情"
            onClick={() => openDrawer(null)}
          >
            <IconClose />
          </button>
        </header>

        <div className="rly-agent-body">
          <div className="rly-agent-meta">
            <span>开始于 {clock(agent.startedAt)}</span>
            {agent.usage ? (
              <span>
                {formatTokens(agent.usage.totalTokens)} tokens · {agent.usage.toolUses} 次工具 ·{' '}
                {duration(agent.usage.durationMs)}
              </span>
            ) : null}
          </div>

          {agent.summary ? (
            <div className="rly-agent-summary">
              <Markdown text={agent.summary} />
            </div>
          ) : null}

          {agent.prompt ? (
            <details className="rly-agent-task">
              <summary>任务单</summary>
              <pre>{agent.prompt}</pre>
            </details>
          ) : null}

          <div className="rly-agent-transcript">
            {agent.messages.length === 0 ? (
              <p className="rly-hint">还没有输出。</p>
            ) : (
              agent.messages.map((message) => (
                <div
                  key={message.id}
                  className={`rly-agent-message is-${message.kind}${
                    message.isError ? ' is-error' : ''
                  }`}
                >
                  <span className="rly-agent-message-time">{clock(message.at)}</span>
                  {message.kind === 'text' ? (
                    <Markdown text={message.text} />
                  ) : (
                    <div className="rly-agent-message-tool">
                      <code>{message.toolName ?? (message.kind === 'result' ? '结果' : '工具')}</code>
                      <pre>{message.text}</pre>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}
