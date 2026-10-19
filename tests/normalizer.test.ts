import { describe, expect, it } from 'vitest'
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
})
