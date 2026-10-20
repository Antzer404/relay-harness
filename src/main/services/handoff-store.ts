import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HandoffDoc } from '@shared/events'

interface HandoffIndex {
  version: 1
  docs: HandoffDoc[]
}

/** Old documents are pruned so the file cannot grow without bound. */
const MAX_DOCS = 100

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseDoc(value: unknown): HandoffDoc | null {
  if (!isRecord(value)) return null
  const { id, fromSessionId, fromTitle, markdown, model, contextPercent, createdAt } = value
  if (typeof id !== 'string' || !id) return null
  if (typeof fromSessionId !== 'string' || !fromSessionId) return null
  if (typeof markdown !== 'string' || !markdown.trim()) return null
  return {
    id,
    fromSessionId,
    fromTitle: typeof fromTitle === 'string' && fromTitle ? fromTitle : '未命名会话',
    markdown,
    model: typeof model === 'string' ? model : '',
    contextPercent:
      typeof contextPercent === 'number' && Number.isFinite(contextPercent)
        ? contextPercent
        : null,
    createdAt: typeof createdAt === 'number' ? createdAt : Date.now(),
    toSessionId: typeof value.toSessionId === 'string' ? value.toSessionId : null,
    usedAt: typeof value.usedAt === 'number' ? value.usedAt : null
  }
}

/**
 * Handoff documents live in `userData/handoffs.json`. They are small enough
 * that a single index file beats one file per document, and the renderer only
 * needs them on demand.
 */
export class HandoffStore {
  private readonly filePath: string
  private docs = new Map<string, HandoffDoc>()

  constructor(userDataDir: string) {
    this.filePath = join(userDataDir, 'handoffs.json')
    mkdirSync(userDataDir, { recursive: true })
    this.load()
  }

  private load(): void {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      if (isRecord(parsed) && Array.isArray(parsed.docs)) {
        for (const entry of parsed.docs) {
          const doc = parseDoc(entry)
          if (doc) this.docs.set(doc.id, doc)
        }
      }
    } catch {
      // A missing or corrupt file starts from an empty set.
    }
  }

  private persist(): void {
    const docs = [...this.docs.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_DOCS)
    const index: HandoffIndex = { version: 1, docs }
    this.docs = new Map(docs.map((doc) => [doc.id, doc]))
    writeFileSync(this.filePath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
  }

  list(sessionId?: string): HandoffDoc[] {
    const docs = [...this.docs.values()].sort((a, b) => b.createdAt - a.createdAt)
    if (!sessionId) return docs
    return docs.filter(
      (doc) => doc.fromSessionId === sessionId || doc.toSessionId === sessionId
    )
  }

  get(id: string): HandoffDoc | null {
    return this.docs.get(id) ?? null
  }

  create(doc: HandoffDoc): HandoffDoc {
    this.docs.set(doc.id, doc)
    this.persist()
    return doc
  }

  update(id: string, patch: Partial<Pick<HandoffDoc, 'markdown' | 'toSessionId' | 'usedAt'>>): HandoffDoc | null {
    const existing = this.docs.get(id)
    if (!existing) return null
    const next = { ...existing, ...patch }
    this.docs.set(id, next)
    this.persist()
    return next
  }

  /** The document a given follow-up session was created from, if any. */
  findForTarget(sessionId: string): HandoffDoc | null {
    for (const doc of this.docs.values()) {
      if (doc.toSessionId === sessionId) return doc
    }
    return null
  }

  remove(id: string): void {
    if (!this.docs.delete(id)) return
    this.persist()
  }
}
