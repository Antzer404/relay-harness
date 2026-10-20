import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { toVisiblePermissionMode } from '@shared/events'
import type { FileDiff, HarnessEvent, UsageSnapshot } from '@shared/events'
import { buildFileDiff, FILE_EDIT_TOOLS, snapshotTarget, type TargetSnapshot } from './tool-diff'

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
const AGENT_TEXT_LIMIT = 4_000
const AGENT_TOOL_LIMIT = 300
const AGENT_RESULT_LIMIT = 800
const AGENT_DESCRIPTION_LIMIT = 600
const AGENT_PROMPT_LIMIT = 6_000
const AGENT_SUMMARY_LIMIT = 600

interface NormalizerOptions {
  /** Project window: turn subagent frames into `agent_*` events. */
  teamMode?: boolean
}

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

/** Short, readable form of a tool input for the worker transcript. */
function summarizeToolInput(input: unknown): string {
  if (input === null || typeof input !== 'object') return ''
  const record = input as Record<string, unknown>
  const parts: string[] = []
  for (const key of ['file_path', 'path', 'command', 'pattern', 'url', 'query', 'description']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) parts.push(`${key}=${value.trim()}`)
    if (parts.length >= 2) break
  }
  if (parts.length === 0) {
    try {
      const serialized = JSON.stringify(input)
      if (serialized && serialized !== '{}') return serialized.slice(0, AGENT_TOOL_LIMIT)
    } catch {
      // Ignore unserialisable input.
    }
  }
  return parts.join(' ').slice(0, AGENT_TOOL_LIMIT)
}

/**
 * Frames produced inside a Task subagent carry the spawning tool_use id in
 * `parent_tool_use_id` (and assistant frames also carry `agent_id`). They must
 * never be rendered as the main thread's: the leader sees its Task card and
 * the final report, not the subagent's internals. The team view planned for
 * project mode will consume these frames separately instead.
 */
function isSubagentFrame(message: SDKMessage): boolean {
  if (
    message.type !== 'assistant' &&
    message.type !== 'user' &&
    message.type !== 'stream_event'
  ) {
    return false
  }
  const frame = message as { parent_tool_use_id?: string | null; agent_id?: unknown }
  if (frame.parent_tool_use_id != null) return true
  // Background/resumed agents may lose the parent link but keep their id.
  return typeof frame.agent_id === 'string'
}

/**
 * Converts SDK stream-json messages into Relay's own event model.
 * The renderer never sees an SDK message.
 */
export class EventNormalizer {
  private model = ''
  private cwd = ''
  private contextWindow = 200_000
  private lastRequestUsage: RequestUsage | null = null
  private thinkingSeen = false
  private thinkingStartedAt: number | null = null
  private textBlocksDone = new Set<number>()
  private thinkingBlocksDone = new Set<number>()
  private toolStartedAt = new Map<string, number>()
  private toolNames = new Map<string, string>()
  private toolInputs = new Map<string, unknown>()
  private editSnapshots = new Map<string, TargetSnapshot | null>()
  private currentBlockIndex = -1
  /** task_id → subagent type, for permission attribution and deltas. */
  private readonly agentNames = new Map<string, string>()

  constructor(
    private readonly emit: Emit,
    private readonly options: NormalizerOptions = {}
  ) {}

  /** Display name of a worker, when its task has been seen. */
  agentName(agentId: string): string | null {
    return this.agentNames.get(agentId) ?? null
  }

  beginTurn(): void {
    this.thinkingSeen = false
    this.thinkingStartedAt = null
    this.textBlocksDone.clear()
    this.thinkingBlocksDone.clear()
    this.toolStartedAt.clear()
    this.toolNames.clear()
    this.toolInputs.clear()
    this.editSnapshots.clear()
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
    // Subagent frames never masquerade as the leader. In Project mode they
    // feed the team view instead.
    if (isSubagentFrame(message)) {
      if (this.options.teamMode) this.handleSubagentFrame(message)
      return
    }

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
      this.cwd = message.cwd
      this.emit({
        type: 'session_started',
        sessionId: message.session_id,
        model: message.model,
        cwd: message.cwd,
        cliVersion: message.claude_code_version,
        permissionMode: toVisiblePermissionMode(message.permissionMode)
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
    if (this.options.teamMode && message.subtype === 'task_started') {
      if (message.ambient === true) return
      // mcp_task / local_bash are not team workers.
      if (message.task_type !== 'local_agent' && !message.subagent_type) return
      const name = message.subagent_type ?? 'agent'
      this.agentNames.set(message.task_id, name)
      this.emit({
        type: 'agent_started',
        agentId: message.task_id,
        name,
        description: message.description.slice(0, AGENT_DESCRIPTION_LIMIT),
        prompt: message.prompt ? message.prompt.slice(0, AGENT_PROMPT_LIMIT) : null,
        backgrounded: message.is_backgrounded === true,
        startedAt: Date.now()
      })
      return
    }
    if (this.options.teamMode && message.subtype === 'task_progress') {
      if (!message.subagent_type && !this.agentNames.has(message.task_id)) return
      const name = message.subagent_type ?? this.agentNames.get(message.task_id) ?? 'agent'
      this.agentNames.set(message.task_id, name)
      this.emit({
        type: 'agent_progress',
        agentId: message.task_id,
        name,
        ...(message.summary
          ? { summary: message.summary.slice(0, AGENT_SUMMARY_LIMIT) }
          : {}),
        ...(message.last_tool_name ? { lastToolName: message.last_tool_name } : {}),
        usage: {
          totalTokens: message.usage.total_tokens,
          toolUses: message.usage.tool_uses,
          durationMs: message.usage.duration_ms
        }
      })
      return
    }
    if (this.options.teamMode && message.subtype === 'task_notification') {
      if (!this.agentNames.has(message.task_id) && !('subagent_type' in message)) return
      const name = this.agentNames.get(message.task_id) ?? 'agent'
      this.emit({
        type: 'agent_finished',
        agentId: message.task_id,
        name,
        status:
          message.status === 'completed'
            ? 'done'
            : message.status === 'failed'
              ? 'failed'
              : 'stopped',
        summary: message.summary
          ? message.summary.slice(0, AGENT_TEXT_LIMIT)
          : null,
        usage: message.usage
          ? {
              totalTokens: message.usage.total_tokens,
              toolUses: message.usage.tool_uses,
              durationMs: message.usage.duration_ms
            }
          : null,
        finishedAt: Date.now()
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
        const name = block.name ?? 'tool'
        const input = block.input ?? {}
        this.toolStartedAt.set(block.id, startedAt)
        this.toolNames.set(block.id, name)
        this.toolInputs.set(block.id, input)
        // Snapshot before the CLI executes the edit so the diff card can show
        // the previous file content.
        this.editSnapshots.set(block.id, FILE_EDIT_TOOLS.has(name) ? snapshotTarget(input) : null)
        this.emit({
          type: 'tool_call',
          toolUseId: block.id,
          name,
          input,
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
      const toolUseId = raw.tool_use_id
      const startedAt = this.toolStartedAt.get(toolUseId)
      const isError = raw.is_error === true

      let diff: FileDiff | undefined
      if (!isError) {
        const snapshot = this.editSnapshots.get(toolUseId)
        if (snapshot) {
          diff =
            buildFileDiff(
              this.toolNames.get(toolUseId) ?? '',
              this.toolInputs.get(toolUseId),
              snapshot,
              this.cwd
            ) ?? undefined
        }
      }

      this.toolInputs.delete(toolUseId)
      this.editSnapshots.delete(toolUseId)

      this.emit({
        type: 'tool_result',
        toolUseId,
        output: stringifyOutput(raw.content),
        isError,
        durationMs: startedAt ? Date.now() - startedAt : null,
        ...(diff ? { diff } : {})
      })
    }
  }

  /**
   * Worker transcript for the team panel. Stream events are ignored (the
   * complete assistant messages already carry each block), thinking is not
   * surfaced, and tool output is capped so a chatty worker cannot bloat the
   * session log.
   */
  private handleSubagentFrame(message: SDKMessage): void {
    const frame = message as {
      type?: string
      agent_id?: unknown
      parent_tool_use_id?: string | null
      subagent_type?: string
      message?: { content?: unknown }
    }
    if (frame.type !== 'assistant' && frame.type !== 'user') return
    const agentId =
      typeof frame.agent_id === 'string' ? frame.agent_id : frame.parent_tool_use_id ?? ''
    if (!agentId) return
    const name = frame.subagent_type ?? this.agentNames.get(agentId) ?? 'agent'
    this.agentNames.set(agentId, name)
    const content = Array.isArray(frame.message?.content)
      ? (frame.message.content as unknown as ContentBlockLike[])
      : []

    for (const block of content) {
      if (frame.type === 'assistant') {
        if (block.type === 'text' && typeof block.text === 'string') {
          const text = block.text.trim()
          if (!text) continue
          this.emit({
            type: 'agent_message',
            agentId,
            name,
            kind: 'text',
            text:
              text.length > AGENT_TEXT_LIMIT
                ? `${text.slice(0, AGENT_TEXT_LIMIT)}…`
                : text,
            at: Date.now()
          })
        } else if (block.type === 'tool_use' && block.name) {
          this.emit({
            type: 'agent_message',
            agentId,
            name,
            kind: 'tool',
            toolName: block.name,
            text: summarizeToolInput(block.input) || block.name,
            at: Date.now()
          })
        }
      } else if (block.type === 'tool_result' && block.tool_use_id) {
        const output = stringifyOutput(block.content).slice(0, AGENT_RESULT_LIMIT)
        this.emit({
          type: 'agent_message',
          agentId,
          name,
          kind: 'result',
          text: output || '（空）',
          isError: block.is_error === true,
          at: Date.now()
        })
      }
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
