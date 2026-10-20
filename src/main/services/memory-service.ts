import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import {
  MEMORY_CATEGORY_LABELS,
  type MemoryCategory,
  type MemoryEntry,
  type MemoryTrack,
  type RelayEvent
} from '@shared/events'
import { eventToEntry, extractTextContent, stripCodeFence } from './handoff-service'

/** The injection budget promised by the v1 design (~2000 tokens). */
export const MEMORY_TOKEN_BUDGET = 2000
const PROJECT_TOKEN_BUDGET = 1400
const USER_TOKEN_BUDGET = 600
const ENTRY_CAP = 240
const PROMPT_ENTRY_CAP = 200

/** One distillation pass normally covers a single turn; this bounds the input. */
export const MAX_MEMORY_TRANSCRIPT_CHARS = 16_000

const MAX_ADDS = 5
const MAX_UPDATES = 5
const MAX_DELETES = 3

export const MEMORY_SYSTEM_PROMPT = `你是 Relay（桌面 Agent 工作台）的长期记忆整理器。你会收到两样东西：
1. 一段最近的会话记录（只包含上次整理之后的新内容）；
2. 现有长期记忆清单（JSON，含每条记忆的 id）。

请判断这段记录里哪些信息值得跨会话长期保留，并输出记忆增量。

记忆分两轨：
- project：当前工作区的架构决策、项目约定、踩过的坑、关键文件与目录地图、只对这个项目成立的用户偏好。
- user：跨工作区都成立的能力画像：技术栈与工具偏好、沟通与协作习惯、用户纠正过你的做法、你反复犯的错误。

规则：
- 只记录对将来工作有长期价值的稳定信息。一次性的任务进度、临时文件路径、本轮的具体结论不要记录。
- 不要编造；记录中没有依据的内容不要出现。不要记录密钥、令牌、密码等敏感信息。
- 每条 content 用一句简体中文，不超过 80 字，独立可读，避免“这个 / 它 / 上面”等依赖上下文的指代。
- 新信息与现有记忆重复或矛盾时：能合并就 update（content 写合并后的完整内容）；已过时或被推翻的用 delete。
- 最多新增 5 条、更新 5 条、删除 3 条。没有值得记录的内容就全部返回空数组。
- 只输出一个 JSON 对象，不要代码围栏、不要解释。格式：
{"add":[{"track":"project","category":"decision","content":"……","confidence":0.8}],"update":[{"id":"……","content":"……","confidence":0.9}],"delete":[{"id":"……","reason":"……"}]}
- category 只能是：decision、convention、pitfall、file-map、preference、correction。`

const trackSchema = z.enum(['project', 'user'])
const categorySchema = z.enum([
  'decision',
  'convention',
  'pitfall',
  'file-map',
  'preference',
  'correction'
])

/**
 * The model answers with a JSON delta. Arrays default to empty so a quiet
 * turn does not look like a protocol failure; the per-item caps are enforced
 * again when applying, so an over-eager model is trimmed instead of rejected.
 */
export const memoryDeltaSchema = z.object({
  add: z
    .array(
      z.object({
        track: trackSchema,
        category: categorySchema,
        content: z.string().trim().min(1).max(400),
        confidence: z.coerce.number().min(0).max(1).optional()
      })
    )
    .max(20)
    .default([]),
  update: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        content: z.string().trim().min(1).max(400).optional(),
        category: categorySchema.optional(),
        confidence: z.coerce.number().min(0).max(1).optional()
      })
    )
    .max(20)
    .default([]),
  delete: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        reason: z.string().max(200).optional()
      })
    )
    .max(20)
    .default([])
})

export type MemoryDelta = z.infer<typeof memoryDeltaSchema>

export const EMPTY_DELTA: MemoryDelta = { add: [], update: [], delete: [] }

function capText(text: string, limit: number): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, limit)}…`
}

function normalizeContent(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Parses the model reply, tolerating fences and leading prose. */
export function parseMemoryDelta(raw: string): MemoryDelta {
  const text = stripCodeFence(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    const match = /\{[\s\S]*\}/.exec(text)
    if (!match) throw new Error('记忆增量不是有效 JSON')
    parsed = JSON.parse(match[0])
  }
  return memoryDeltaSchema.parse(parsed)
}

// ---------------------------------------------------------------- transcript

/**
 * Condenses the undistilled events for the memory prompt. Unlike a handoff
 * document, only the latest turn matters, so the head budget is small and
 * the tail (the newest state) keeps most of the space.
 */
export function buildMemoryTranscript(events: RelayEvent[]): string {
  const entries: string[] = []
  for (const envelope of events) {
    const entry = eventToEntry(envelope)
    if (entry) entries.push(entry.text)
  }
  const separator = '\n\n'
  const joined = entries.join(separator)
  if (joined.length <= MAX_MEMORY_TRANSCRIPT_CHARS) return joined

  const budget = MAX_MEMORY_TRANSCRIPT_CHARS - 120
  const headBudget = Math.floor(budget * 0.25)
  const tailBudget = budget - headBudget

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
  const marker = `…（中间省略 ${omitted} 条事件）…`
  return [...head, marker, ...tail].join(separator)
}

// -------------------------------------------------------------------- apply

export interface MemoryApplyMeta {
  sessionId: string
  now?: number
}

export interface MemoryApplyResult {
  project: MemoryEntry[]
  user: MemoryEntry[]
  added: number
  updated: number
  deleted: number
  skipped: number
}

const TRACKS: MemoryTrack[] = ['project', 'user']

/**
 * Applies a validated delta to both tracks. Deletes run first, then updates,
 * then adds, so an entry cannot be updated and deleted in the same pass.
 * Duplicate adds (same normalised content in the same track) are dropped.
 */
export function applyMemoryDelta(
  project: MemoryEntry[],
  user: MemoryEntry[],
  delta: MemoryDelta,
  meta: MemoryApplyMeta
): MemoryApplyResult {
  const now = meta.now ?? Date.now()
  const lists: Record<MemoryTrack, MemoryEntry[]> = {
    project: project.map((entry) => ({ ...entry })),
    user: user.map((entry) => ({ ...entry }))
  }
  let added = 0
  let updated = 0
  let deleted = 0
  let skipped = 0

  for (const item of delta.delete.slice(0, MAX_DELETES)) {
    let removed = false
    for (const track of TRACKS) {
      const index = lists[track].findIndex((entry) => entry.id === item.id)
      if (index >= 0) {
        lists[track].splice(index, 1)
        deleted += 1
        removed = true
        break
      }
    }
    if (!removed) skipped += 1
  }

  for (const patch of delta.update.slice(0, MAX_UPDATES)) {
    let target: MemoryEntry | undefined
    for (const track of TRACKS) {
      target = lists[track].find((entry) => entry.id === patch.id)
      if (target) break
    }
    if (!target) {
      skipped += 1
      continue
    }
    const nextContent =
      patch.content !== undefined ? capText(patch.content, ENTRY_CAP) : target.content
    const nextCategory: MemoryCategory = patch.category ?? target.category
    const nextConfidence = patch.confidence ?? target.confidence
    if (
      nextContent === target.content &&
      nextCategory === target.category &&
      nextConfidence === target.confidence
    ) {
      skipped += 1
      continue
    }
    target.content = nextContent
    target.category = nextCategory
    target.confidence = nextConfidence
    target.updatedAt = now
    updated += 1
  }

  for (const item of delta.add.slice(0, MAX_ADDS)) {
    const content = capText(item.content, ENTRY_CAP)
    if (!content) {
      skipped += 1
      continue
    }
    const list = lists[item.track]
    const normalized = normalizeContent(content)
    if (list.some((entry) => normalizeContent(entry.content) === normalized)) {
      skipped += 1
      continue
    }
    list.push({
      id: crypto.randomUUID(),
      track: item.track,
      category: item.category,
      content,
      confidence: item.confidence ?? 0.6,
      enabled: true,
      sourceSessionId: meta.sessionId,
      createdAt: now,
      updatedAt: now
    })
    added += 1
  }

  return { project: lists.project, user: lists.user, added, updated, deleted, skipped }
}

// ------------------------------------------------------------------ inject

/** Roughly 1.6 characters per token for mixed Chinese/English prose. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 1.6)
}

function memoryLine(entry: MemoryEntry): string {
  return `- [${MEMORY_CATEGORY_LABELS[entry.category]}] ${capText(entry.content, PROMPT_ENTRY_CAP)}`
}

function selectLines(entries: MemoryEntry[], tokenBudget: number): string[] {
  const enabled = entries
    .filter((entry) => entry.enabled)
    .sort((a, b) => {
      if (a.confidence !== b.confidence) return b.confidence - a.confidence
      return b.updatedAt - a.updatedAt
    })
  const lines: string[] = []
  let used = 0
  for (const entry of enabled) {
    const line = memoryLine(entry)
    const cost = estimateTokens(line) + 1
    if (used + cost > tokenBudget) continue
    lines.push(line)
    used += cost
  }
  return lines
}

/**
 * Builds the system-prompt block injected when a session starts. Returns
 * null when there is nothing enabled, so a fresh install adds no noise.
 */
export function buildMemoryInjection(
  project: MemoryEntry[],
  user: MemoryEntry[]
): string | null {
  const projectLines = selectLines(project, PROJECT_TOKEN_BUDGET)
  const userLines = selectLines(user, USER_TOKEN_BUDGET)
  if (projectLines.length === 0 && userLines.length === 0) return null

  const parts = [
    '## 长期记忆',
    '以下是从以往会话整理的长期记忆，仅供背景参考；与当前代码或用户最新说明冲突时，以后者为准。'
  ]
  if (projectLines.length > 0) parts.push('', '### 项目记忆', ...projectLines)
  if (userLines.length > 0) parts.push('', '### 用户画像', ...userLines)
  return parts.join('\n')
}

// --------------------------------------------------------------- distiller

export interface MemoryDistillInput {
  events: RelayEvent[]
  project: MemoryEntry[]
  user: MemoryEntry[]
  baseUrl: string
  apiKey: string
  /** The active session's model; `[1m]` is stripped by the caller. */
  model: string
}

export interface MemoryDistiller {
  distill(input: MemoryDistillInput): Promise<MemoryDelta>
}

function promptEntry(entry: MemoryEntry): Record<string, unknown> {
  return {
    id: entry.id,
    category: entry.category,
    content: capText(entry.content, PROMPT_ENTRY_CAP),
    confidence: Number(entry.confidence.toFixed(2))
  }
}

export const deepSeekMemoryDistiller: MemoryDistiller = {
  async distill(input) {
    const transcript = buildMemoryTranscript(input.events)
    if (!transcript.trim()) return EMPTY_DELTA

    const existing = {
      project: input.project.filter((entry) => entry.enabled).map(promptEntry),
      user: input.user.filter((entry) => entry.enabled).map(promptEntry)
    }
    const client = new Anthropic({
      baseURL: input.baseUrl,
      authToken: input.apiKey,
      maxRetries: 1,
      timeout: 120_000
    })
    const response = await client.messages.create({
      model: input.model,
      max_tokens: 2_000,
      system: MEMORY_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `## 新一轮记录\n\n${transcript}\n\n## 现有记忆（JSON）\n\n${JSON.stringify(existing)}`
        }
      ]
    })
    const text = extractTextContent(response.content)
    if (!text) throw new Error('模型没有返回记忆增量')
    return parseMemoryDelta(text)
  }
}
