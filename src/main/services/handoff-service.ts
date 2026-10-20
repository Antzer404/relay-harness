import Anthropic from '@anthropic-ai/sdk'
import type { RelayEvent } from '@shared/events'

/** The transcript is condensed, but a very long session still gets trimmed. */
export const MAX_TRANSCRIPT_CHARS = 80_000
const ENTRY_CAP = 6_000
const TOOL_CALL_CAP = 400
const TOOL_RESULT_CAP = 700
const ERROR_CAP = 600

export const HANDOFF_SYSTEM_PROMPT = `你是 Relay（桌面 Agent 工作台）的交接文档生成器。你会收到一段工作会话的记录。请把它压缩成一份给下一个会话接手用的 Markdown 交接文档。

要求：
- 只使用记录中出现的信息，不要编造文件、命令、数值或结论；不确定的内容写进「未解决 / 风险」。
- 用简体中文，直接输出 Markdown 文档本身：不要加代码围栏，不要寒暄或解释。
- 固定结构，标题从二级开始：## 目标、## 已完成、## 关键决策、## 涉及文件、## 待办、## 未解决 / 风险。
- 「涉及文件」列具体路径及各自的作用或当前状态；「待办」按优先级排列，用短句。
- 全文控制在 1200 字以内。`

export interface HandoffTranscriptMeta {
  title: string
  cwd: string
  model: string
  contextPercent: number | null
  now?: number
}

function cap(text: string, limit: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, limit)}…（已截断 ${trimmed.length - limit} 字）`
}

/** Picks the few input fields that matter for a reader of the transcript. */
function summarizeToolInput(name: string, input: unknown): string {
  if (input === null || typeof input !== 'object') return ''
  const record = input as Record<string, unknown>
  const interesting = [
    'file_path',
    'path',
    'notebook_path',
    'command',
    'pattern',
    'url',
    'query',
    'description',
    'prompt'
  ]
  const parts: string[] = []
  for (const key of interesting) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) parts.push(`${key}=${value.trim()}`)
    if (parts.length >= 2) break
  }
  if (parts.length === 0) {
    try {
      const serialized = JSON.stringify(input)
      if (serialized && serialized !== '{}') return cap(serialized, TOOL_CALL_CAP / 2)
    } catch {
      // Ignore unserialisable input.
    }
  }
  return cap(parts.join(' '), TOOL_CALL_CAP)
}

interface TranscriptEntry {
  text: string
}

function eventToEntry(envelope: RelayEvent): TranscriptEntry | null {
  const event = envelope.event
  switch (event.type) {
    case 'user_message':
      return { text: `### 用户\n${cap(event.text, ENTRY_CAP)}` }
    case 'text_done':
      return event.text.trim() ? { text: `### 助手\n${cap(event.text, ENTRY_CAP)}` } : null
    case 'tool_call': {
      const summary = summarizeToolInput(event.name, event.input)
      return { text: `- 调用 \`${event.name}\`${summary ? ` ${summary}` : ''}` }
    }
    case 'tool_result': {
      const head = event.output.trim()
      if (!head) return { text: `- 结果：空` }
      return {
        text: `- 结果${event.isError ? '（错误）' : ''}：${cap(head, TOOL_RESULT_CAP)}`
      }
    }
    case 'error':
      return { text: `### 错误\n${cap(event.message, ERROR_CAP)}` }
    case 'compact_boundary':
      return { text: `（上下文已${event.trigger === 'auto' ? '自动' : '手动'}压缩）` }
    case 'thinking_done':
    case 'permission_mode':
    case 'memory_note':
      return null
    default:
      return null
  }
}

function metaLine(meta: HandoffTranscriptMeta): string {
  const stamp = new Date(meta.now ?? Date.now()).toLocaleString('zh-CN', { hour12: false })
  const percent =
    meta.contextPercent === null ? '未知' : `${meta.contextPercent.toFixed(1)}%`
  return [
    `会话：${meta.title}`,
    `工作区：${meta.cwd}`,
    `模型：${meta.model || '未知'}`,
    `上下文填充：${percent}`,
    `事件数：{count}`,
    `生成时间：${stamp}`
  ].join('\n')
}

/**
 * Condenses the durable event log into a transcript for the handoff prompt.
 * When the result would exceed the budget, the head (the original goal) and
 * the tail (the latest state) are kept and the middle is replaced by a marker.
 */
export function buildHandoffTranscript(events: RelayEvent[], meta: HandoffTranscriptMeta): string {
  const entries: string[] = []
  for (const envelope of events) {
    const entry = eventToEntry(envelope)
    if (entry) entries.push(entry.text)
  }

  const header = metaLine(meta).replace('{count}', String(entries.length))
  const separator = '\n\n'
  const total = entries.reduce((sum, text) => sum + text.length + separator.length, 0)
  const joined = entries.join(separator)
  if (`${header}\n\n${joined}`.length <= MAX_TRANSCRIPT_CHARS) {
    return `${header}\n\n${joined}`.trim()
  }

  const budget = MAX_TRANSCRIPT_CHARS - header.length - 200
  // Keep the first quarter of the budget for the goal, the rest for the tail.
  const headBudget = Math.floor(budget * 0.25)
  const tailBudget = budget - headBudget - 80

  const head: string[] = []
  let used = 0
  for (const text of entries) {
    if (used + text.length > headBudget) break
    head.push(text)
    used += text.length + separator.length
  }

  const tail: string[] = []
  used = 0
  for (let index = entries.length - 1; index >= head.length; index -= 1) {
    const text = entries[index] as string
    if (used + text.length > tailBudget) break
    tail.unshift(text)
    used += text.length + separator.length
  }

  const omitted = entries.length - head.length - tail.length
  const marker = `…（中间省略 ${omitted} 条事件，共 ${total} 字）…`
  return `${header}\n\n${[...head, marker, ...tail].join(separator)}`
}

/** Extracts visible text from an Anthropic response, ignoring thinking blocks. */
export function extractTextContent(
  content: Array<{ type: string; text?: string }>
): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n').trim()
}

/** Removes a wrapping ```markdown fence the model may have added anyway. */
export function stripCodeFence(markdown: string): string {
  const trimmed = markdown.trim()
  const match = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(trimmed)
  return match?.[1]?.trim() ? match[1].trim() : trimmed
}

export interface GenerateHandoffInput {
  events: RelayEvent[]
  meta: HandoffTranscriptMeta
  baseUrl: string
  apiKey: string
  /** Model used for the summary; kept on the document for provenance. */
  model: string
}

export interface HandoffGenerator {
  generate(input: GenerateHandoffInput): Promise<string>
}

export const deepSeekHandoffGenerator: HandoffGenerator = {
  async generate(input) {
    const transcript = buildHandoffTranscript(input.events, input.meta)
    const client = new Anthropic({
      baseURL: input.baseUrl,
      authToken: input.apiKey,
      maxRetries: 1,
      timeout: 180_000
    })
    const response = await client.messages.create({
      model: input.model,
      max_tokens: 8_000,
      system: HANDOFF_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `下面是会话记录。请生成交接文档。\n\n${transcript}`
        }
      ]
    })
    if (response.stop_reason === 'max_tokens' && response.content.length === 0) {
      throw new Error('交接文档生成被截断，请重试或缩短会话')
    }
    const markdown = stripCodeFence(extractTextContent(response.content))
    if (!markdown) throw new Error('模型没有返回交接文档内容')
    return markdown
  }
}
