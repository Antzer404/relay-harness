import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { HarnessEvent } from '@shared/events'
import { EventNormalizer } from '../src/main/runtime/normalizer'

function assistant(content: unknown[], usage = { input_tokens: 1000, output_tokens: 10 }): SDKMessage {
  return {
    type: 'assistant',
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'deepseek-flash[1m]',
      content,
      stop_reason: null,
      stop_sequence: null,
      usage
    },
    parent_tool_use_id: null,
    uuid: '00000000-0000-4000-8000-000000000001',
    session_id: '00000000-0000-4000-8000-000000000099'
  } as unknown as SDKMessage
}

function result(overrides: Record<string, unknown> = {}): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 1200,
    duration_api_ms: 900,
    is_error: false,
    num_turns: 1,
    result: 'done',
    stop_reason: 'end_turn',
    total_cost_usd: 0.0012,
    usage: {
      input_tokens: 1000,
      output_tokens: 10,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 50
    },
    modelUsage: {
      'deepseek-flash[1m]': {
        inputTokens: 1000,
        outputTokens: 10,
        cacheReadInputTokens: 200,
        cacheCreationInputTokens: 50,
        contextWindow: 1_000_000,
        costUSD: 0.0012
      }
    },
    permission_denials: [],
    errors: [],
    uuid: '00000000-0000-4000-8000-000000000002',
    session_id: '00000000-0000-4000-8000-000000000099',
    ...overrides
  } as unknown as SDKMessage
}

describe('EventNormalizer', () => {
  it('maps assistant content, tool results and usage into harness events', () => {
    const events: HarnessEvent[] = []
    const normalizer = new EventNormalizer((event) => events.push(event))
    normalizer.beginTurn()

    normalizer.normalize(
      assistant([
        { type: 'thinking', thinking: 'inspect first' },
        { type: 'text', text: 'I will read the file.' },
        { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/tmp/a.ts' } }
      ])
    )

    normalizer.normalize({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: [{ type: 'text', text: 'export const a = 1' }],
            is_error: false
          }
        ]
      },
      parent_tool_use_id: null,
      uuid: '00000000-0000-4000-8000-000000000003',
      session_id: '00000000-0000-4000-8000-000000000099'
    } as unknown as SDKMessage)

    normalizer.normalize(result())

    const types = events.map((event) => event.type)
    expect(types).toEqual([
      'thinking_done',
      'text_done',
      'tool_call',
      'tool_result',
      'usage',
      'turn_end'
    ])

    const usage = events.find((event) => event.type === 'usage')
    if (usage?.type === 'usage') {
      expect(usage.usage.contextWindow).toBe(1_000_000)
      expect(usage.usage.contextTokens).toBe(1010)
      expect(usage.usage.percent).toBeCloseTo(0.1, 2)
      expect(usage.usage.costUsd).toBeCloseTo(0.0012)
    }

    const toolResult = events.find((event) => event.type === 'tool_result')
    if (toolResult?.type === 'tool_result') {
      expect(toolResult.output).toContain('export const a = 1')
      expect(toolResult.isError).toBe(false)
    }
  })

  it('keeps subagent frames out of the main timeline', () => {
    const events: HarnessEvent[] = []
    const normalizer = new EventNormalizer((event) => events.push(event))
    normalizer.beginTurn()

    // The leader delegates through the Agent/Task tool.
    normalizer.normalize(
      assistant([
        {
          type: 'tool_use',
          id: 'task_1',
          name: 'Agent',
          input: { description: '扫描构建配置', prompt: '列出所有构建配置文件' }
        }
      ])
    )

    // Inside the subagent: partial text, assistant text/tool, tool result.
    normalizer.normalize({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '子代理内部输出' }
      },
      parent_tool_use_id: 'task_1',
      uuid: '00000000-0000-4000-8000-000000000011',
      session_id: '00000000-0000-4000-8000-000000000099'
    } as unknown as SDKMessage)
    normalizer.normalize({
      ...(assistant([
        { type: 'text', text: '子代理的中间说明' },
        { type: 'tool_use', id: 'sub_tool_1', name: 'Read', input: { file_path: 'a.ts' } }
      ]) as object),
      parent_tool_use_id: 'task_1',
      agent_id: 'agent_1',
      subagent_type: 'Explore',
      task_description: '扫描构建配置'
    } as unknown as SDKMessage)
    normalizer.normalize({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'sub_tool_1',
            content: [{ type: 'text', text: '文件内容' }],
            is_error: false
          }
        ]
      },
      parent_tool_use_id: 'task_1',
      uuid: '00000000-0000-4000-8000-000000000012',
      session_id: '00000000-0000-4000-8000-000000000099'
    } as unknown as SDKMessage)

    // A background agent can lose the parent link but keep its agent id.
    normalizer.normalize({
      ...(assistant([{ type: 'text', text: '后台代理输出' }]) as object),
      agent_id: 'agent_2',
      subagent_type: 'Explore'
    } as unknown as SDKMessage)

    // The Task tool's own result arrives on the main thread.
    normalizer.normalize({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'task_1',
            content: [{ type: 'text', text: '扫描完成：3 个配置文件' }],
            is_error: false
          }
        ]
      },
      parent_tool_use_id: null,
      uuid: '00000000-0000-4000-8000-000000000013',
      session_id: '00000000-0000-4000-8000-000000000099'
    } as unknown as SDKMessage)

    expect(events.map((event) => event.type)).toEqual(['tool_call', 'tool_result'])
    const call = events[0]
    expect(call?.type === 'tool_call' ? call.name : null).toBe('Agent')
    const report = events[1]
    expect(report?.type === 'tool_result' ? report.toolUseId : null).toBe('task_1')
    expect(report?.type === 'tool_result' ? report.output : '').toContain('扫描完成')
  })

  it('reports the CLI permission mode at init and clamps unknown modes', () => {
    const events: HarnessEvent[] = []
    const normalizer = new EventNormalizer((event) => events.push(event))

    normalizer.normalize({
      type: 'system',
      subtype: 'init',
      model: 'deepseek-flash[1m]',
      cwd: '/tmp',
      session_id: '00000000-0000-4000-8000-000000000099',
      claude_code_version: '2.1.303',
      permissionMode: 'plan'
    } as unknown as SDKMessage)
    normalizer.normalize({
      type: 'system',
      subtype: 'init',
      model: 'deepseek-flash[1m]',
      cwd: '/tmp',
      session_id: '00000000-0000-4000-8000-000000000099',
      claude_code_version: '2.1.303',
      permissionMode: 'bypassPermissions'
    } as unknown as SDKMessage)

    const started = events.filter((event) => event.type === 'session_started')
    expect(started).toHaveLength(2)
    expect(started[0]?.type === 'session_started' ? started[0].permissionMode : null).toBe('plan')
    expect(started[1]?.type === 'session_started' ? started[1].permissionMode : null).toBe(
      'default'
    )
  })

  it('emits an explicit empty thinking block when the model returns none', () => {
    const events: HarnessEvent[] = []
    const normalizer = new EventNormalizer((event) => events.push(event))
    normalizer.beginTurn()

    normalizer.normalize(assistant([{ type: 'text', text: 'answer' }]))
    normalizer.normalize(result())

    const thinking = events.find((event) => event.type === 'thinking_done')
    expect(thinking).toBeDefined()
    if (thinking?.type === 'thinking_done') expect(thinking.text).toBe('')
  })

  it('keeps the last request usage rather than the cumulative result usage', () => {
    const events: HarnessEvent[] = []
    const normalizer = new EventNormalizer((event) => events.push(event))
    normalizer.beginTurn()

    normalizer.normalize(assistant([{ type: 'text', text: 'first call' }], { input_tokens: 1000, output_tokens: 5 }))
    normalizer.normalize(assistant([{ type: 'text', text: 'second call' }], { input_tokens: 1400, output_tokens: 7 }))
    normalizer.normalize(
      result({
        usage: {
          input_tokens: 2400,
          output_tokens: 12,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0
        }
      })
    )

    const usage = events.find((event) => event.type === 'usage')
    if (usage?.type === 'usage') {
      expect(usage.usage.inputTokens).toBe(1400)
      expect(usage.usage.outputTokens).toBe(7)
      expect(usage.usage.contextTokens).toBe(1407)
    }
  })

  it('attaches a file diff to a successful Edit result', () => {
    const base = join(process.cwd(), '.smoke-tmp')
    mkdirSync(base, { recursive: true })
    const dir = mkdtempSync(join(base, 'normalizer-diff-'))
    const file = join(dir, 'a.ts')
    writeFileSync(file, 'const a = 1\nconst b = 2\n', 'utf8')

    try {
      const events: HarnessEvent[] = []
      const normalizer = new EventNormalizer((event) => events.push(event))
      normalizer.beginTurn()
      normalizer.normalize({
        type: 'system',
        subtype: 'init',
        model: 'deepseek-flash[1m]',
        cwd: dir,
        session_id: '00000000-0000-4000-8000-000000000099',
        claude_code_version: '2.1.303'
      } as unknown as SDKMessage)
      normalizer.normalize(
        assistant([
          {
            type: 'tool_use',
            id: 'toolu_edit',
            name: 'Edit',
            input: { file_path: file, old_string: 'const a = 1', new_string: 'const a = 42' }
          }
        ])
      )
      normalizer.normalize({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_edit',
              content: [{ type: 'text', text: 'updated' }],
              is_error: false
            }
          ]
        },
        parent_tool_use_id: null,
        uuid: '00000000-0000-4000-8000-000000000004',
        session_id: '00000000-0000-4000-8000-000000000099'
      } as unknown as SDKMessage)

      const toolResult = events.find((event) => event.type === 'tool_result')
      expect(toolResult?.type).toBe('tool_result')
      if (toolResult?.type === 'tool_result') {
        expect(toolResult.diff).toMatchObject({ path: 'a.ts', mode: 'edit', added: 1, removed: 1 })
      }

      normalizer.beginTurn()
      normalizer.normalize(
        assistant([
          {
            type: 'tool_use',
            id: 'toolu_edit_2',
            name: 'Edit',
            input: { file_path: file, old_string: 'const a = 1', new_string: 'const a = 42' }
          }
        ])
      )
      normalizer.normalize({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_edit_2',
              content: [{ type: 'text', text: 'failed' }],
              is_error: true
            }
          ]
        },
        parent_tool_use_id: null,
        uuid: '00000000-0000-4000-8000-000000000005',
        session_id: '00000000-0000-4000-8000-000000000099'
      } as unknown as SDKMessage)

      const failed = events.filter((event) => event.type === 'tool_result')[1]
      expect(failed?.type === 'tool_result' ? failed.diff : 'missing').toBeUndefined()
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
      } catch {
        // The connected-folder mount in the Linux sandbox may refuse deletes.
      }
    }
  })

  it('treats a user abort as a clean turn end rather than an error', () => {
    const events: HarnessEvent[] = []
    const normalizer = new EventNormalizer((event) => events.push(event))
    normalizer.normalize(
      result({
        subtype: 'error_during_execution',
        is_error: true,
        terminal_reason: 'aborted_streaming',
        errors: ['interrupted by user']
      })
    )
    expect(events.some((event) => event.type === 'error')).toBe(false)
    const end = events.find((event) => event.type === 'turn_end')
    expect(end?.type === 'turn_end' ? end.isError : true).toBe(false)
  })
})
