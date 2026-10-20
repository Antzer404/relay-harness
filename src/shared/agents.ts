import type {
  AgentStatus,
  AgentUsageSummary,
  HarnessEvent,
  RelayEvent
} from './events'

/**
 * View-model for a Project worker, rebuilt from `agent_*` events both while
 * running and when a session is replayed from disk.
 */

export interface AgentMessageView {
  id: string
  kind: 'text' | 'tool' | 'result'
  text: string
  toolName?: string
  isError?: boolean
  at: number
}

export interface AgentView {
  id: string
  name: string
  description: string
  prompt: string | null
  status: AgentStatus
  backgrounded: boolean
  startedAt: number
  finishedAt: number | null
  summary: string | null
  lastToolName: string | null
  usage: AgentUsageSummary | null
  messages: AgentMessageView[]
}

export interface TeamFeedItem {
  id: string
  agentId: string
  name: string
  kind: 'started' | 'progress' | 'finished'
  /** Description, summary or status line; the UI adds the speaker prefix. */
  text: string
  at: number
}

export interface TeamState {
  agents: AgentView[]
  /** Leader↔worker channel, newest last. Worker transcripts stay on the agent. */
  feed: TeamFeedItem[]
}

export const EMPTY_TEAM: TeamState = { agents: [], feed: [] }

const MAX_MESSAGES = 200
const MAX_FEED = 100
const MAX_MESSAGE_TEXT = 6000
const MAX_FEED_TEXT = 240

let messageCounter = 0
function nextMessageId(): string {
  messageCounter += 1
  return `agent-msg-${messageCounter}`
}

let feedCounter = 0
function nextFeedId(): string {
  feedCounter += 1
  return `agent-feed-${feedCounter}`
}

function cap(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}…`
}

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  running: '进行中',
  done: '已完成',
  failed: '失败',
  stopped: '已停止'
}

const DEFAULT_AGENT: Omit<AgentView, 'id' | 'name' | 'startedAt'> = {
  description: '',
  prompt: null,
  status: 'running',
  backgrounded: false,
  finishedAt: null,
  summary: null,
  lastToolName: null,
  usage: null,
  messages: []
}

function upsert(
  agents: AgentView[],
  agentId: string,
  name: string,
  at: number,
  patch: (agent: AgentView) => AgentView
): AgentView[] {
  const index = agents.findIndex((agent) => agent.id === agentId)
  if (index === -1) {
    const created: AgentView = {
      ...DEFAULT_AGENT,
      id: agentId,
      name,
      startedAt: at
    }
    return [...agents, patch(created)]
  }
  const next = [...agents]
  next[index] = patch(next[index] as AgentView)
  return next
}

function addFeed(
  feed: TeamFeedItem[],
  item: Omit<TeamFeedItem, 'id'>
): TeamFeedItem[] {
  const next = [
    ...feed,
    { ...item, text: cap(item.text, MAX_FEED_TEXT), id: nextFeedId() }
  ]
  return next.length > MAX_FEED ? next.slice(next.length - MAX_FEED) : next
}

function isTeamEvent(event: HarnessEvent): boolean {
  return (
    event.type === 'agent_started' ||
    event.type === 'agent_progress' ||
    event.type === 'agent_finished' ||
    event.type === 'agent_message'
  )
}

/** Applies one `agent_*` event; every other event passes through unchanged. */
export function reduceTeam(state: TeamState, event: HarnessEvent, ts: number): TeamState {
  // Foreground workers cannot outlive their turn in the MVP. Without this,
  // a session interrupted mid-turn would replay a member as forever running.
  if (event.type === 'turn_end') {
    const unfinished = state.agents.filter((agent) => agent.status === 'running')
    if (unfinished.length === 0) return state
    const agents = state.agents.map((agent) =>
      agent.status === 'running'
        ? { ...agent, status: 'stopped' as const, finishedAt: ts }
        : agent
    )
    let feed = state.feed
    for (const agent of unfinished) {
      feed = addFeed(feed, {
        agentId: agent.id,
        name: agent.name,
        kind: 'finished',
        text: '已停止 — 回合结束时仍未完成',
        at: ts
      })
    }
    return { agents, feed }
  }

  if (!isTeamEvent(event)) return state

  switch (event.type) {
    case 'agent_started': {
      const agents = upsert(state.agents, event.agentId, event.name, event.startedAt, (agent) => ({
        ...agent,
        name: event.name,
        description: event.description,
        prompt: event.prompt,
        backgrounded: event.backgrounded,
        status: 'running',
        startedAt: event.startedAt,
        finishedAt: null,
        summary: null
      }))
      return {
        agents,
        feed: addFeed(state.feed, {
          agentId: event.agentId,
          name: event.name,
          kind: 'started',
          text: event.description,
          at: event.startedAt
        })
      }
    }

    case 'agent_progress': {
      const agents = upsert(state.agents, event.agentId, event.name, ts, (agent) => ({
        ...agent,
        name: event.name || agent.name,
        status: agent.status === 'running' ? 'running' : agent.status,
        ...(event.summary ? { summary: event.summary } : {}),
        ...(event.lastToolName ? { lastToolName: event.lastToolName } : {}),
        ...(event.usage ? { usage: event.usage } : {})
      }))
      const text = event.summary?.trim()
      if (!text) return { ...state, agents }
      return {
        agents,
        feed: addFeed(state.feed, {
          agentId: event.agentId,
          name: event.name,
          kind: 'progress',
          text,
          at: ts
        })
      }
    }

    case 'agent_finished': {
      const agents = upsert(state.agents, event.agentId, event.name, ts, (agent) => ({
        ...agent,
        name: event.name || agent.name,
        status: event.status,
        finishedAt: event.finishedAt,
        summary: event.summary ?? agent.summary,
        ...(event.usage ? { usage: event.usage } : {})
      }))
      const summary = event.summary?.trim()
      return {
        agents,
        feed: addFeed(state.feed, {
          agentId: event.agentId,
          name: event.name,
          kind: 'finished',
          text: `${AGENT_STATUS_LABEL[event.status]}${summary ? ` — ${summary}` : ''}`,
          at: event.finishedAt
        })
      }
    }

    case 'agent_message': {
      const agents = upsert(state.agents, event.agentId, event.name, event.at, (agent) => {
        const message: AgentMessageView = {
          id: nextMessageId(),
          kind: event.kind,
          text: cap(event.text, MAX_MESSAGE_TEXT),
          at: event.at,
          ...(event.toolName ? { toolName: event.toolName } : {}),
          ...(event.isError ? { isError: true } : {})
        }
        const messages = [...agent.messages, message]
        return {
          ...agent,
          name: event.name || agent.name,
          messages:
            messages.length > MAX_MESSAGES ? messages.slice(messages.length - MAX_MESSAGES) : messages
        }
      })
      return { ...state, agents }
    }

    default:
      return state
  }
}

export function replayTeam(events: RelayEvent[]): TeamState {
  let state: TeamState = EMPTY_TEAM
  for (const envelope of events) {
    state = reduceTeam(state, envelope.event, envelope.ts)
  }
  return state
}
