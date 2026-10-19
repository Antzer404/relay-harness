import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { HarnessEvent, UsageSnapshot } from '@shared/events'

type Emit = (event: HarnessEvent) => void

interface RequestUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

interface UsageLike {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

interface ContentBlockLike {
  type: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

const OUTPUT_LIMIT = 60_000

function readUsage(usage: UsageLike | undefined | null): RequestUsage | null {
  if (!usage) return null
  return {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0
  }
}

function stringifyOutput(value: unknown): string {
  if (value == null) return ''
  let text: string
  if (typeof value === 'string') {
    text = value
  } else if (Array.isArray(value)) {
    text = value
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text: unknown }).text)
        }
        return JSON.stringify(part)
      })
      .join('\n')
  } else {
    try {
      text = JSON.stringify(value, null, 2)
    } catch {
      text = String(value)
    }
  }
  if (text.length > OUTPUT_LIMIT) {
    return `${text.slice(0, OUTPUT_LIMIT)}\n… [输出已截断，共 ${text.length} 字符]`
  }
  return text
}

/**
 * Converts SDK stream-json messages into Relay's own event model.
 * The renderer never sees an SDK message.
 */
export class EventNormalizer {
  private model = ''
  private contextWindow = 200_000
  private lastRequestUsage: RequestUsage | null = null
  private thinkingSeen = false
  private thinkingStartedAt: number | null = null
  private textBlocksDone = new Set<number>()
  private thinkingBlocksDone = new Set<number>()
  private toolStartedAt = new Map<string, number>()
  private toolNames = new Map<string, string>()
  private currentBlockIndex = -1

  constructor(private readonly emit: Emit) {}

  beginTurn(): void {
    this.thinkingSeen = false
    this.thinkingStartedAt = null
    this.textBlocksDone.clear()
    this.thinkingBlocksDone.clear()
    this.toolStartedAt.clear()
    this.toolNames.clear()
    this.currentBlockIndex = -1
  }

  /** Restart a tool's timer once the user has approved it. */
  markToolApproved(toolUseId: string): void {
    if (this.toolStartedAt.has(toolUseId)) {
      this.toolStartedAt.set(toolUseId, Date.now())
    }
  }

  private finishThinking(text: string): void {
    const started = this.thinkingStartedAt
    this.thinkingStartedAt = null
    this.emit({
      type: 'thinking_done',
      text,
      durationMs: started ? Date.now() - started : null
    })
  }

  normalize(message: SDKMessage): void {
    switch (message.type) {
      case 'system':
        this.handleSystem(message)
        break
      case 'stream_event':
        this.handleStreamEvent(message.event)
        break
      case 'assistant':
        this.handleAssistant(message)
        break
      case 'user':
        this.handleUser(message)
        break
      case 'result':
        this.handleResult(message)
        break
      default:
        break
    }
  }

  private handleSystem(message: Extract<SDKMessage, { type: 'system' }>): void {
    if (message.subtype === 'init') {
      this.model = message.model
      this.emit({
        type: 'session_started',
        sessionId: message.session_id,
        model: message.model,
        cwd: message.cwd,
        cliVersion: message.claude_code_version
      })
      return
    }
    if (message.subtype === 'compact_boundary') {
      const meta = message.compact_metadata
      this.emit({
        type: 'compact_boundary',
        trigger: meta.trigger,
        preTokens: meta.pre_tokens,
        ...(meta.post_tokens !== undefined ? { postTokens: meta.post_tokens } : {})
      })
      return
    }
    if (message.subtype === 'api_retry') {
      this.emit({
        type: 'error',
        code: message.error,
        message: `API 请求失败（第 ${message.attempt} 次），${Math.round(
          message.retry_delay_ms / 1000
        )} 秒后重试`,
        retryable: true
      })
    }
  }

  private handleStreamEvent(event: unknown): void {
    const evt = event as {
      type?: string
      index?: number
      message?: { usage?: UsageLike; model?: string }
      delta?: {
        type?: string
        text?: string
        thinking?: string
      }
      content_block?: ContentBlockLike
    }

    switch (evt.type) {
      case 'message_start': {
        const usage = readUsage(evt.message?.usage)
        if (usage) this.lastRequestUsage = usage
        if (evt.message?.model) this.model = evt.message.model
        break
      }
      case 'content_block_start': {
        const index = evt.index ?? 0
        this.currentBlockIndex = index
        const block = evt.content_block
        if (block?.type === 'thinking' || block?.type === 'redacted_thinking') {
          this.thinkingStartedAt ??= Date.now()
        }
        if (block?.type === 'tool_use' && block.id) {
          this.toolStartedAt.set(block.id, Date.now())
          this.toolNames.set(block.id, block.name ?? 'tool')
        }
        break
      }
      case 'content_block_delta': {
        const delta = evt.delta
        if (delta?.type === 'text_delta' && delta.text) {
          this.emit({ type: 'text_delta', text: delta.text })
        } else if (delta?.type === 'thinking_delta' && delta.thinking) {
          this.thinkingSeen = true
          this.thinkingStartedAt ??= Date.now()
          this.emit({ type: 'thinking_delta', text: delta.thinking })
        }
        break
      }
      case 'content_block_stop': {
        // Terminal text/thinking is emitted from the complete assistant message
        // so a dropped partial never loses content.
        break
      }
      case 'message_delta': {
        // Final usage for this request is re-read from the assistant message.
        break
      }
      default:
        break
    }
  }

  private handleAssistant(message: Extract<SDKMessage, { type: 'assistant' }>): void {
    const usage = readUsage(message.message.usage)
    if (usage) this.lastRequestUsage = usage
    if (message.message.model) this.model = message.message.model

    if (message.error) {
      this.emit({
        type: 'error',
        code: message.error,
        message: `模型返回错误：${message.error}`,
        retryable: message.error === 'rate_limit' || message.error === 'overloaded' || message.error === 'server_error'
      })
    }

    const content = Array.isArray(message.message.content)
      ? (message.message.content as unknown as ContentBlockLike[])
      : []

    for (const block of content) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
        this.emit({ type: 'text_done', text: block.text })
      } else if (block.type === 'thinking') {
        this.thinkingSeen = true
        this.finishThinking(block.thinking ?? '')
      } else if (block.type === 'redacted_thinking') {
        this.thinkingSeen = true
        this.finishThinking('该段思维链已被模型加密，无法显示。')
      } else if (block.type === 'tool_use' && block.id) {
        const startedAt = this.toolStartedAt.get(block.id) ?? Date.now()
        this.toolStartedAt.set(block.id, startedAt)
        this.toolNames.set(block.id, block.name ?? 'tool')
        this.emit({
          type: 'tool_call',
          toolUseId: block.id,
          name: block.name ?? 'tool',
          input: block.input ?? {},
          startedAt
        })
      }
    }
  }

  private handleUser(message: Extract<SDKMessage, { type: 'user' }>): void {
    const content = message.message.content
    if (!Array.isArray(content)) return
    for (const raw of content as unknown as ContentBlockLike[]) {
      if (raw.type !== 'tool_result' || !raw.tool_use_id) continue
      const startedAt = this.toolStartedAt.get(raw.tool_use_id)
      this.emit({
        type: 'tool_result',
        toolUseId: raw.tool_use_id,
        output: stringifyOutput(raw.content),
        isError: raw.is_error === true,
        durationMs: startedAt ? Date.now() - startedAt : null
      })
    }
  }

  private handleResult(message: Extract<SDKMessage, { type: 'result' }>): void {
    const result = message as Extract<SDKMessage, { type: 'result' }> & {
      total_cost_usd?: number
      modelUsage?: Record<
        string,
        {
          inputTokens: number
          outputTokens: number
          cacheReadInputTokens: number
          cacheCreationInputTokens: number
          contextWindow?: number
          canonicalModel?: string
        }
      >
    }

    const entries = Object.entries(result.modelUsage ?? {})
    const preferred =
      entries.find(([key, value]) => key === this.model || value.canonicalModel === this.model) ??
      entries[0]
    if (preferred?.[1]?.contextWindow) {
      this.contextWindow = preferred[1].contextWindow
    } else if (/\[1m\]/i.test(this.model)) {
      this.contextWindow = 1_000_000
    }

    const usage =
      this.lastRequestUsage ??
      readUsage(result.usage as unknown as UsageLike) ?? {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0
      }
    const contextTokens = usage.input + usage.cacheRead + usage.cacheWrite + usage.output
    const percent =
      this.contextWindow > 0
        ? Math.min(100, Math.round((contextTokens / this.contextWindow) * 10000) / 100)
        : 0

    const snapshot: UsageSnapshot = {
      model: this.model,
      inputTokens: usage.input,
      outputTokens: usage.output,
      cacheRead: usage.cacheRead,
      cacheWrite: usage.cacheWrite,
      contextWindow: this.contextWindow,
      contextTokens,
      percent,
      costUsd: result.total_cost_usd ?? 0,
      estimated: true
    }
    this.emit({ type: 'usage', usage: snapshot })

    if (!this.thinkingSeen && message.subtype === 'success' && !message.is_error) {
      this.emit({ type: 'thinking_done', text: '' })
    }

    const isError = message.is_error === true
    if (isError) {
      const detail =
        message.subtype === 'success'
          ? String((message as { result?: string }).result ?? '本轮执行失败')
          : message.errors.join('\n') || message.subtype
      this.emit({ type: 'error', code: message.subtype, message: detail, retryable: false })
    }

    this.emit({
      type: 'turn_end',
      reason: message.stop_reason ?? message.terminal_reason ?? message.subtype,
      isError,
      durationMs: message.duration_ms ?? null,
      costUsd: result.total_cost_usd ?? null
    })
  }
}
