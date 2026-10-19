import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import type { HarnessEvent, RelayEvent, SessionDetail, SessionRecord } from '@shared/events'

interface SessionIndex {
  version: 1
  records: SessionRecord[]
}

/**
 * Persists the durable part of the event stream. Token deltas are deliberately
 * excluded: history is rebuilt from `text_done` / `thinking_done` blocks, so a
 * turn costs a handful of lines instead of thousands.
 */
function isDurable(event: HarnessEvent): boolean {
  switch (event.type) {
    case 'user_message':
      return true
    case 'text_done':
      return event.text.trim().length > 0
    case 'thinking_done':
      return event.text.trim().length > 0
    case 'tool_call':
    case 'tool_result':
    case 'compact_boundary':
    case 'error':
    case 'memory_note':
    case 'turn_end':
      return true
    default:
      return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseRecord(value: unknown): SessionRecord | null {
  if (!isRecord(value)) return null
  const { id, title, cwd, model, createdAt, updatedAt, cliSessionId, eventCount } = value
  if (typeof id !== 'string' || !id) return null
  return {
    id,
    title: typeof title === 'string' && title ? title : '未命名会话',
    cwd: typeof cwd === 'string' ? cwd : '',
    model: typeof model === 'string' ? model : '',
    createdAt: typeof createdAt === 'number' ? createdAt : Date.now(),
    updatedAt: typeof updatedAt === 'number' ? updatedAt : Date.now(),
    cliSessionId: typeof cliSessionId === 'string' ? cliSessionId : null,
    eventCount: typeof eventCount === 'number' ? eventCount : 0
  }
}

export class SessionStore {
  private readonly dir: string
  private readonly indexPath: string
  private records = new Map<string, SessionRecord>()

  constructor(userDataDir: string) {
    this.dir = join(userDataDir, 'sessions')
    this.indexPath = join(this.dir, 'index.json')
    mkdirSync(this.dir, { recursive: true })
    this.loadIndex()
  }

  private loadIndex(): void {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.indexPath, 'utf8'))
      if (isRecord(parsed) && Array.isArray(parsed.records)) {
        for (const entry of parsed.records) {
          const record = parseRecord(entry)
          if (record) this.records.set(record.id, record)
        }
        return
      }
    } catch {
      // Fall through to a directory scan.
    }
    this.rebuildFromDirectory()
  }

  private rebuildFromDirectory(): void {
    let files: string[] = []
    try {
      files = readdirSync(this.dir).filter((name) => name.endsWith('.jsonl'))
    } catch {
      return
    }
    for (const file of files) {
      const id = file.slice(0, -'.jsonl'.length)
      try {
        const stats = statSync(join(this.dir, file))
        this.records.set(id, {
          id,
          title: '未命名会话',
          cwd: '',
          model: '',
          createdAt: stats.birthtimeMs,
          updatedAt: stats.mtimeMs,
          cliSessionId: null,
          eventCount: 0
        })
      } catch {
        // Ignore unreadable files.
      }
    }
    this.persistIndex()
  }

  private persistIndex(): void {
    const index: SessionIndex = {
      version: 1,
      records: [...this.records.values()].sort((a, b) => b.updatedAt - a.updatedAt)
    }
    writeFileSync(this.indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
  }

  list(): SessionRecord[] {
    return [...this.records.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get(id: string): SessionRecord | null {
    return this.records.get(id) ?? null
  }

  create(record: SessionRecord): SessionRecord {
    this.records.set(record.id, record)
    this.persistIndex()
    return record
  }

  update(id: string, patch: Partial<Omit<SessionRecord, 'id'>>): SessionRecord | null {
    const existing = this.records.get(id)
    if (!existing) return null
    const next = { ...existing, ...patch }
    this.records.set(id, next)
    this.persistIndex()
    return next
  }

  appendEvent(id: string, envelope: RelayEvent): boolean {
    const record = this.records.get(id)
    if (!record) return false
    if (!isDurable(envelope.event)) return false
    try {
      appendFileSync(join(this.dir, `${id}.jsonl`), `${JSON.stringify(envelope)}\n`, 'utf8')
    } catch {
      return false
    }
    record.eventCount += 1
    record.updatedAt = envelope.ts
    this.persistIndex()
    return true
  }

  loadEvents(id: string): RelayEvent[] {
    const path = join(this.dir, `${id}.jsonl`)
    if (!existsSync(path)) return []
    let raw = ''
    try {
      raw = readFileSync(path, 'utf8')
    } catch {
      return []
    }
    const events: RelayEvent[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const parsed: unknown = JSON.parse(line)
        if (
          isRecord(parsed) &&
          typeof parsed.sessionId === 'string' &&
          typeof parsed.seq === 'number' &&
          typeof parsed.ts === 'number' &&
          isRecord(parsed.event) &&
          typeof parsed.event.type === 'string'
        ) {
          events.push(parsed as unknown as RelayEvent)
        }
      } catch {
        // Skip a torn line instead of losing the whole history.
      }
    }
    return events
  }

  load(id: string): SessionDetail | null {
    const record = this.records.get(id)
    if (!record) return null
    return { record, events: this.loadEvents(id) }
  }

  remove(id: string): void {
    this.records.delete(id)
    const path = join(this.dir, `${id}.jsonl`)
    if (existsSync(path)) {
      try {
        rmSync(path, { force: true })
      } catch {
        // Leave the file; the index entry is gone either way.
      }
    }
    this.persistIndex()
  }
}
