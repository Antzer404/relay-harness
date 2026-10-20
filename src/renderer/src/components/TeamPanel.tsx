import { useEffect, useRef, useState } from 'react'
import { AGENT_STATUS_LABEL, type AgentView } from '@shared/agents'
import { useRelayStore } from '../store/useRelayStore'
import { clock, formatTokens } from '../lib/format'
import { IconUsers } from './icons'

function statusClass(agent: AgentView): string {
  return `is-${agent.status}`
}

export function TeamPanel(): React.JSX.Element | null {
  const windowKind = useRelayStore((state) => state.windowKind)
  const project = useRelayStore((state) => state.project)
  const team = useRelayStore((state) => state.team)
  const phase = useRelayStore((state) => state.phase)
  const openAgent = useRelayStore((state) => state.openAgent)
  const activeAgentId = useRelayStore((state) => state.activeAgentId)
  const [tab, setTab] = useState<'members' | 'feed'>('members')
  const feedRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const node = feedRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [team.feed.length, tab])

  if (windowKind !== 'project') return null

  const running = team.agents.filter((agent) => agent.status === 'running').length
  const leaderBusy = phase === 'busy' || phase === 'starting'
  const labelFor = (name: string): string =>
    project?.agents.find((agent) => agent.id === name)?.label ??
    (name === 'general-purpose' ? '子代理' : name)

  return (
    <section className="rly-team" aria-label="团队">
      <div className="rly-team-head">
        <span className="rly-team-title">
          <IconUsers size={13} />
          团队
        </span>
        <span className="rly-team-count">
          {running > 0
            ? `${running} 个进行中`
            : team.agents.length > 0
              ? `${team.agents.length} 个已派发`
              : '未派发'}
        </span>
      </div>

      <div className="rly-team-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'members'}
          className={`rly-team-tab${tab === 'members' ? ' is-active' : ''}`}
          onClick={() => setTab('members')}
        >
          成员
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'feed'}
          className={`rly-team-tab${tab === 'feed' ? ' is-active' : ''}`}
          onClick={() => setTab('feed')}
        >
          频道
          {team.feed.length > 0 ? <em>{team.feed.length}</em> : null}
        </button>
      </div>

      {tab === 'members' ? (
        <div className="rly-team-scroll">
          <div className={`rly-team-member is-leader${leaderBusy ? ' is-running' : ''}`}>
            <span className="rly-team-dot" aria-hidden="true" />
            <span className="rly-team-main">
              <span className="rly-team-name">
                Leader
                <em>{leaderBusy ? '工作中' : '待命'}</em>
              </span>
              <span className="rly-team-task">按任务组建团队、派发并验收</span>
            </span>
          </div>

          {team.agents.length === 0 ? (
            <p className="rly-team-hint">
              {project?.agents.length
                ? `Leader 尚未派发成员。可调用专员：${project.agents
                    .map((agent) => agent.label)
                    .join('、')}（按需使用，也可以自行组建角色）。`
                : '成员由 Leader 按任务自行判断。任务开始后，派发的子代理会出现在这里。'}
            </p>
          ) : (
            team.agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                className={`rly-team-member ${statusClass(agent)}${
                  activeAgentId === agent.id ? ' is-active' : ''
                }`}
                onClick={() => openAgent(agent.id)}
                title="查看该成员的完整过程"
              >
                <span className="rly-team-dot" aria-hidden="true" />
                <span className="rly-team-main">
                  <span className="rly-team-name">
                    {labelFor(agent.name)}
                    <em>{AGENT_STATUS_LABEL[agent.status]}</em>
                  </span>
                  <span className="rly-team-task">
                    {agent.summary ?? agent.description ?? '正在等待输出…'}
                  </span>
                </span>
                {agent.usage ? (
                  <span className="rly-team-usage">
                    {formatTokens(agent.usage.totalTokens)}
                  </span>
                ) : null}
              </button>
            ))
          )}
          {project?.rosterError ? (
            <p className="rly-team-error">{project.rosterError}（已忽略该文件）</p>
          ) : null}
        </div>
      ) : (
        <div className="rly-team-scroll rly-team-feed" ref={feedRef}>
          {team.feed.length === 0 ? (
            <p className="rly-team-empty">
              Leader 还没有派发任务。发出目标后，这里会显示任务单、进度与报告。
            </p>
          ) : (
            team.feed.map((item) => (
              <div key={item.id} className={`rly-team-feed-item is-${item.kind}`}>
                <span className="rly-team-feed-time">{clock(item.at)}</span>
                <span className="rly-team-feed-text">
                  <em>{item.kind === 'started' ? 'Leader → ' : ''}</em>
                  {labelFor(item.name)}：{item.text}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  )
}
