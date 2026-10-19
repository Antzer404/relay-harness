import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { HarnessEvent } from '@shared/events'
import { ClaudeAgentRuntime } from '../src/main/runtime/claude-agent-runtime'
import { startMockAnthropic, type MockAnthropicServer } from './helpers/mock-anthropic'

// Keep smoke fixtures inside the repo instead of the OS temp directory:
// on Windows, %TEMP% is subject to security software, ACLs and scan locks
// that have produced spurious EPERM failures on the CLI's atomic writes.
const SMOKE_BASE = process.env.RELAY_SMOKE_BASE ?? join(process.cwd(), '.smoke-tmp')

async function waitFor<T>(
  read: () => T | undefined,
  timeoutMs = 90_000,
  label = 'condition'
): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out waiting for ${label}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

describe('ClaudeAgentRuntime + mock Anthropic endpoint', () => {
  let mock: MockAnthropicServer | null = null
  let runtime: ClaudeAgentRuntime | null = null
  let root: string | null = null

  afterEach(async () => {
    await runtime?.disposeAll()
    await mock?.close()
    if (root) {
      // On Windows the CLI child process can briefly keep a handle on its cwd
      // after close(); retry until the directory is removable.
      for (let attempt = 0; ; attempt += 1) {
        try {
          rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 })
          break
        } catch (error) {
          if (attempt >= 20) throw error
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
      }
    }
    runtime = null
    mock = null
    root = null
  })

  it('streams thinking, runs a permission-gated tool and reports usage', async () => {
    mkdirSync(SMOKE_BASE, { recursive: true })
    root = mkdtempSync(join(SMOKE_BASE, 'run-'))
    const workspace = join(root, 'workspace')
    const configDir = join(root, 'claude-config')
    mkdirSync(workspace)
    mkdirSync(configDir)

    mock = await startMockAnthropic({ workspaceDir: workspace })
    runtime = new ClaudeAgentRuntime()

    const events: HarnessEvent[] = []
    runtime.onEvent((_sessionId, event) => events.push(event))

    const sessionId = randomUUID()
    await runtime.startSession({
      sessionId,
      cwd: workspace,
      model: 'deepseek-flash[1m]',
      effort: 'high',
      permissionMode: 'default',
      baseUrl: mock.url,
      apiKey: 'sk-local-smoke',
      claudeConfigDir: configDir
    })

    runtime.send(sessionId, { text: 'Write hello.txt in the workspace, then confirm.' })

    await waitFor(
      () => events.find((event) => event.type === 'session_started'),
      60_000,
      'session_started'
    )

    const permission = await waitFor(
      () => events.find((event) => event.type === 'permission_request'),
      60_000,
      'permission_request'
    )
    expect(permission.type).toBe('permission_request')
    if (permission.type === 'permission_request') {
      expect(permission.toolName).toBe('Write')
      runtime.respondPermission({ requestId: permission.requestId, decision: 'allow' })
    }

    const turnEnd = await waitFor(
      () => events.find((event) => event.type === 'turn_end'),
      90_000,
      'turn_end'
    )
    expect(turnEnd.type).toBe('turn_end')
    if (turnEnd.type === 'turn_end') {
      expect(turnEnd.isError).toBe(false)
    }

    const types = events.map((event) => event.type)
    expect(types).toContain('thinking_delta')
    expect(types).toContain('thinking_done')
    expect(types).toContain('text_delta')
    expect(types).toContain('tool_call')
    expect(types).toContain('permission_request')
    expect(types).toContain('tool_result')
    expect(types).toContain('usage')

    const thinkingDone = events.find((event) => event.type === 'thinking_done')
    expect(thinkingDone && thinkingDone.type === 'thinking_done' ? thinkingDone.text : '').toContain(
      'hello.txt'
    )

    const toolResult = events.find((event) => event.type === 'tool_result')
    if (toolResult?.type === 'tool_result') {
      if (toolResult.isError) {
        const permissionInput = events.find((event) => event.type === 'permission_request')
        console.error('[smoke] tool_result.error:', toolResult.output)
        console.error(
          '[smoke] permission input:',
          permissionInput?.type === 'permission_request'
            ? JSON.stringify(permissionInput.input)
            : '(none)'
        )
        console.error('[smoke] cli stderr:', runtime.stderrTail(sessionId).join('\n') || '(empty)')
      }
      expect(toolResult.isError, `tool output: ${toolResult.output}`).toBe(false)
      expect(toolResult.durationMs).not.toBeNull()
    }

    const usage = events.find((event) => event.type === 'usage')
    if (usage?.type === 'usage') {
      expect(usage.usage.contextWindow).toBe(1_000_000)
      expect(usage.usage.inputTokens).toBeGreaterThan(0)
      expect(usage.usage.percent).toBeGreaterThan(0)
      expect(usage.usage.percent).toBeLessThan(10)
      expect(usage.usage.costUsd).toBeGreaterThan(0)
    }

    const target = join(workspace, 'hello.txt')
    expect(existsSync(target)).toBe(true)
    expect(readFileSync(target, 'utf8')).toContain('relay mock')

    const messageRequests = mock.requests.filter(
      (request) => request.url.includes('/v1/messages') && !request.url.includes('count_tokens')
    )
    expect(messageRequests).toHaveLength(2)

    const secondMessages = messageRequests[1]?.body.messages as Array<{
      role: string
      content: Array<{ type: string }>
    }>
    const hasThinkingPassback = secondMessages.some(
      (message) =>
        message.role === 'assistant' &&
        Array.isArray(message.content) &&
        message.content.some((block) => block.type === 'thinking')
    )
    const hasToolResult = secondMessages.some(
      (message) =>
        message.role === 'user' &&
        Array.isArray(message.content) &&
        message.content.some((block) => block.type === 'tool_result')
    )
    expect(hasThinkingPassback).toBe(true)
    expect(hasToolResult).toBe(true)

    // Second turn on the same long-lived query(): history (including thinking
    // blocks) must be carried by the CLI transcript, not rebuilt by Relay.
    runtime.send(sessionId, { text: 'Summarize what you just did.' })
    await waitFor(
      () => (events.filter((event) => event.type === 'turn_end').length >= 2 ? true : undefined),
      90_000,
      'second turn_end'
    )

    const allMessageRequests = mock.requests.filter(
      (request) => request.url.includes('/v1/messages') && !request.url.includes('count_tokens')
    )
    expect(allMessageRequests).toHaveLength(3)
    const thirdMessages = allMessageRequests[2]?.body.messages as Array<{
      role: string
      content: Array<{ type: string }>
    }>
    const thirdHasThinking = thirdMessages.some(
      (message) =>
        message.role === 'assistant' &&
        Array.isArray(message.content) &&
        message.content.some((block) => block.type === 'thinking')
    )
    expect(thirdHasThinking).toBe(true)
    expect(events.filter((event) => event.type === 'usage')).toHaveLength(2)
  })
})
