import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, describe, expect, it } from 'vitest'
import { EMPTY_TEAM, reduceTeam } from '@shared/agents'
import type { HarnessEvent, RelayEvent, SessionRecord } from '@shared/events'
import { EventNormalizer } from '../src/main/runtime/normalizer'
import {
  buildProjectAgentDefinitions,
  loadProjectRoster,
  projectAgentViews,
  projectLeaderPrompt
} from '../src/main/services/project-roster'
import { sessionMatchesScope } from '../src/main/services/session-manager'

const dirs: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'relay-project-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 's1',
    title: '会话',
    cwd: '/work/demo',
    model: 'deepseek-flash[1m]',
    createdAt: 1,
    updatedAt: 1,
    cliSessionId: null,
    eventCount: 0,
    handoffFrom: null,
    projectMode: false,
    ...overrides
  }
}

function taskStarted(overrides: Record<string, unknown> = {}): SDKMessage {
  return {
    type: 'system',
    subtype: 'task_started',
    task_id: 'task_1',
    tool_use_id: 'toolu_task',
    description: '实现登录接口',
    subagent_type: 'backend',
    prompt: '目标：实现登录接口。验收：单测通过。',
    is_backgrounded: false,
    task_type: 'local_agent',
    uuid: '00000000-0000-4000-8000-000000000010',
    session_id: '00000000-0000-4000-8000-000000000099',
    ...overrides
  } as unknown as SDKMessage
}

function taskProgress(overrides: Record<string, unknown> = {}): SDKMessage {
  return {
    type: 'system',
    subtype: 'task_progress',
    task_id: 'task_1',
    tool_use_id: 'toolu_task',
    description: '实现登录接口',
    subagent_type: 'backend',
    usage: { total_tokens: 3200, tool_uses: 4, duration_ms: 65_000 },
    last_tool_name: 'Edit',
    summary: '正在补登录接口的校验',
    uuid: '00000000-0000-4000-8000-000000000011',
    session_id: '00000000-0000-4000-8000-000000000099',
    ...overrides
  } as unknown as SDKMessage
}

function taskNotification(overrides: Record<string, unknown> = {}): SDKMessage {
  return {
    type: 'system',
    subtype: 'task_notification',
    task_id: 'task_1',
    tool_use_id: 'toolu_task',
    status: 'completed',
    output_file: '',
    summary: '登录接口已完成，单测通过',
    usage: { total_tokens: 8800, tool_uses: 9, duration_ms: 180_000 },
    uuid: '00000000-0000-4000-8000-000000000012',
    session_id: '00000000-0000-4000-8000-000000000099',
    ...overrides
  } as unknown as SDKMessage
}

function subagentAssistant(content: unknown[], overrides: Record<string, unknown> = {}): SDKMessage {
  return {
    type: 'assistant',
    message: {
      id: 'msg_sub',
      type: 'message',
      role: 'assistant',
      model: 'deepseek-flash',
      content,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 2 }
    },
    parent_tool_use_id: 'toolu_task',
    agent_id: 'task_1',
    subagent_type: 'backend',
    task_description: '实现登录接口',
    uuid: '00000000-0000-4000-8000-000000000013',
    session_id: '00000000-0000-4000-8000-000000000099',
    ...overrides
  } as unknown as SDKMessage
}

function subagentUser(content: unknown[]): SDKMessage {
  return {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: 'toolu_task',
    agent_id: 'task_1',
    subagent_type: 'backend',
    uuid: '00000000-0000-4000-8000-000000000014',
    session_id: '00000000-0000-4000-8000-000000000099'
  } as unknown as SDKMessage
}

describe('project roster', () => {
  it('has no fixed workers when the workspace declares none', () => {
    const dir = makeDir()
    const roster = loadProjectRoster(dir)
    expect(roster.source).toBe('default')
    expect(roster.error).toBeNull()
    expect(roster.specs).toEqual([])
  })

  it('reads a custom .relay/agents.json', () => {
    const dir = makeDir()
    mkdirSync(join(dir, '.relay'), { recursive: true })
    writeFileSync(
      join(dir, '.relay', 'agents.json'),
      JSON.stringify({
        version: 1,
        agents: [
          {
            id: 'reviewer',
            label: '评审',
            description: '代码评审',
            prompt: '你是评审 agent。',
            tools: ['Read', 'Grep']
          }
        ]
      }),
      'utf8'
    )
    const roster = loadProjectRoster(dir)
    expect(roster.source).toBe('file')
    expect(roster.specs).toHaveLength(1)
    expect(roster.specs[0]?.id).toBe('reviewer')

    const definitions = buildProjectAgentDefinitions(roster.specs)
    expect(definitions.reviewer?.description).toContain('评审')
    expect(definitions.reviewer?.tools).toEqual(['Read', 'Grep'])
  })

  it('falls back to an empty roster when the file is invalid', () => {
    const dir = makeDir()
    mkdirSync(join(dir, '.relay'), { recursive: true })
    writeFileSync(join(dir, '.relay', 'agents.json'), '{oops', 'utf8')
    const roster = loadProjectRoster(dir)
    expect(roster.source).toBe('default')
    expect(roster.specs).toEqual([])
    expect(roster.error).toContain('agents.json')
  })

  it('lets the leader compose the team, with declared specialists optional', () => {
    const prompt = projectLeaderPrompt()
    expect(prompt).toContain('团队协作模式（Project）')
    expect(prompt).toContain('团队成员不预设')
    expect(prompt).toContain('general-purpose')
    expect(prompt).toContain('团队组建')
    expect(prompt).toContain('任务单必须自包含')
    expect(prompt).toContain('不要为派发而派发')
    expect(prompt).not.toContain('架构（')
    expect(prompt).not.toContain('backend')

    const specialist = {
      id: 'reviewer',
      label: '评审',
      description: '代码评审',
      prompt: '你是评审 agent。'
    }
    const withSpecs = projectLeaderPrompt([specialist])
    expect(withSpecs).toContain('reviewer（评审）')
    expect(projectAgentViews([specialist])[0]?.label).toBe('评审')
  })
})

describe('session scope', () => {
  it('keeps project sessions out of the main window and vice versa', () => {
    const main = record({ projectMode: false })
    const project = record({ projectMode: true, cwd: '/work/proj' })
    expect(sessionMatchesScope(main, false, null)).toBe(true)
    expect(sessionMatchesScope(project, false, null)).toBe(false)
    expect(sessionMatchesScope(project, true, '/work/proj')).toBe(true)
    expect(sessionMatchesScope(project, true, '/work/other')).toBe(false)
    expect(sessionMatchesScope(main, true, '/work/proj')).toBe(false)
    expect(sessionMatchesScope(null, false, null)).toBe(false)
  })
})

describe('normalizer team mode', () => {
  function setup(teamMode = true): { events: HarnessEvent[]; normalizer: EventNormalizer } {
    const events: HarnessEvent[] = []
    return { events, normalizer: new EventNormalizer((event) => events.push(event), { teamMode }) }
  }

  it('maps task lifecycle into agent events', () => {
    const { events, normalizer } = setup()
    normalizer.normalize(taskStarted())
    normalizer.normalize(taskProgress())
    normalizer.normalize(taskNotification())

    expect(events[0]).toMatchObject({
      type: 'agent_started',
      agentId: 'task_1',
      name: 'backend',
      description: '实现登录接口',
      prompt: '目标：实现登录接口。验收：单测通过。',
      backgrounded: false
    })
    expect(events[1]).toMatchObject({
      type: 'agent_progress',
      agentId: 'task_1',
      summary: '正在补登录接口的校验',
      lastToolName: 'Edit',
      usage: { totalTokens: 3200, toolUses: 4, durationMs: 65_000 }
    })
    expect(events[2]).toMatchObject({
      type: 'agent_finished',
      agentId: 'task_1',
      status: 'done',
      summary: '登录接口已完成，单测通过'
    })
    expect(normalizer.agentName('task_1')).toBe('backend')
  })

  it('keeps worker transcript out of the leader timeline', () => {
    const { events, normalizer } = setup()
    normalizer.normalize(taskStarted())
    events.length = 0

    normalizer.normalize(
      subagentAssistant([
        { type: 'thinking', thinking: '内部推理' },
        { type: 'text', text: '登录接口已实现。' },
        { type: 'tool_use', id: 'toolu_edit', name: 'Edit', input: { file_path: 'src/auth.ts' } }
      ])
    )
    normalizer.normalize(
      subagentUser([
        { type: 'tool_result', tool_use_id: 'toolu_edit', content: 'updated', is_error: false }
      ])
    )

    expect(events.map((event) => (event.type === 'agent_message' ? event.kind : event.type))).toEqual(
      ['text', 'tool', 'result']
    )
    expect(events[0]).toMatchObject({
      type: 'agent_message',
      agentId: 'task_1',
      name: 'backend',
      text: '登录接口已实现。'
    })
    expect(events[1]).toMatchObject({ kind: 'tool', toolName: 'Edit', text: 'file_path=src/auth.ts' })
    expect(events[2]).toMatchObject({ kind: 'result', text: 'updated', isError: false })
    expect(events.some((event) => event.type === 'text_done' || event.type === 'tool_call')).toBe(
      false
    )
  })

  it('drops team events when the session is not in project mode', () => {
    const { events, normalizer } = setup(false)
    normalizer.normalize(taskStarted())
    normalizer.normalize(taskProgress())
    normalizer.normalize(taskNotification())
    normalizer.normalize(
      subagentAssistant([{ type: 'text', text: 'worker output should not leak' }])
    )
    expect(events).toEqual([])
  })
})

describe('team reducer', () => {
  const at = 1_790_000_000_000

  it('folds start, progress, messages and finish into one member', () => {
    let team = EMPTY_TEAM
    team = reduceTeam(
      team,
      {
        type: 'agent_started',
        agentId: 'task_1',
        name: 'backend',
        description: '实现登录接口',
        prompt: '任务单',
        backgrounded: false,
        startedAt: at
      },
      at
    )
    team = reduceTeam(
      team,
      { type: 'agent_message', agentId: 'task_1', name: 'backend', kind: 'text', text: '开始实现', at: at + 1 },
      at + 1
    )
    team = reduceTeam(
      team,
      {
        type: 'agent_progress',
        agentId: 'task_1',
        name: 'backend',
        summary: '正在写测试',
        usage: { totalTokens: 1200, toolUses: 3, durationMs: 30_000 }
      },
      at + 2
    )
    team = reduceTeam(
      team,
      {
        type: 'agent_finished',
        agentId: 'task_1',
        name: 'backend',
        status: 'done',
        summary: '完成',
        usage: { totalTokens: 2400, toolUses: 6, durationMs: 60_000 },
        finishedAt: at + 3
      },
      at + 3
    )

    expect(team.agents).toHaveLength(1)
    const agent = team.agents[0]
    expect(agent?.status).toBe('done')
    expect(agent?.summary).toBe('完成')
    expect(agent?.messages.map((message) => message.text)).toEqual(['开始实现'])
    expect(team.feed.map((item) => item.kind)).toEqual(['started', 'progress', 'finished'])
    expect(team.feed[0]?.name).toBe('backend')
    expect(team.feed[0]?.text).toBe('实现登录接口')
    expect(team.feed[2]?.text).toContain('已完成')
  })

  it('creates a placeholder member when messages arrive before the task event', () => {
    const team = reduceTeam(
      EMPTY_TEAM,
      { type: 'agent_message', agentId: 'task_x', name: 'tester', kind: 'text', text: '复现了问题', at },
      at
    )
    expect(team.agents[0]?.name).toBe('tester')
    expect(team.agents[0]?.status).toBe('running')
  })

  it('marks still-running workers as stopped when a turn ends', () => {
    let team = reduceTeam(
      EMPTY_TEAM,
      {
        type: 'agent_started',
        agentId: 'task_1',
        name: 'frontend',
        description: '实现登录页',
        prompt: null,
        backgrounded: false,
        startedAt: at
      },
      at
    )
    team = reduceTeam(
      team,
      { type: 'turn_end', reason: 'interrupt', isError: false, durationMs: 1000, costUsd: null },
      at + 10
    )
    expect(team.agents[0]?.status).toBe('stopped')
    expect(team.agents[0]?.finishedAt).toBe(at + 10)
    expect(team.feed.at(-1)?.text).toContain('已停止')
  })

  it('replays team events from a session log', () => {
    const envelope = (event: RelayEvent['event'], seq: number): RelayEvent => ({
      sessionId: 's1',
      seq,
      ts: at + seq,
      event
    })
    // replayTeam is exercised through the store; the reducer alone must be
    // idempotent over non-team events.
    const state = reduceTeam(EMPTY_TEAM, envelope({ type: 'user_message', text: 'hi' }, 1).event, at)
    expect(state).toBe(EMPTY_TEAM)
  })
})
