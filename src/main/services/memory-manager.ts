import type { MemoryInfo, RelayEvent, SessionRecord } from '@shared/events'
import {
  applyMemoryDelta,
  buildMemoryInjection,
  deepSeekMemoryDistiller,
  type MemoryApplyResult,
  type MemoryDistiller
} from './memory-service'
import { MemoryStore } from './memory-store'

/** User decision: each turn is distilled asynchronously, two minutes after it ends. */
export const MEMORY_DEBOUNCE_MS = 120_000
const RETRY_BUSY_MS = 15_000
const RETRY_FAILED_MS = 60_000
const RETRY_FAILED_MAX_MS = 600_000
const RETRY_NO_KEY_MS = 300_000
/** New events landed while the model was answering; take another pass. */
const RETRY_AGAIN_MS = 5_000
/**
 * Debounce must not starve a long session whose turns are always less than
 * two minutes apart; force a pass ten minutes after the first undigested turn.
 */
const MAX_WAIT_MS = 600_000

export interface MemoryCredential {
  apiKey: string | null
  baseUrl: string
  fallbackModel: string
}

interface MemoryManagerOptions {
  userDataDir: string
  loadEvents: (sessionId: string) => RelayEvent[]
  getRecord: (sessionId: string) => SessionRecord | null
  getCredential: () => MemoryCredential
  /** Emits a `memory_note` event into the session timeline. */
  note: (sessionId: string, message: string) => void
  log?: (message: string) => void
  distiller?: MemoryDistiller
  debounceMs?: number
}

type Outcome = 'done' | 'empty' | 'missing' | 'failed' | 'no_key' | 'again'

function memoryNoteText(result: MemoryApplyResult): string {
  const parts: string[] = []
  const added = result.added
  const updated = result.updated
  const deleted = result.deleted
  if (added > 0) parts.push(`新增 ${added} 条`)
  if (updated > 0) parts.push(`更新 ${updated} 条`)
  if (deleted > 0) parts.push(`删除 ${deleted} 条`)
  return `长期记忆已更新：${parts.join('，')}。`
}

/**
 * Runs the distillation loop independently of the live runtime:
 *  - `turn_end` only marks the session dirty; a two-minute debounce is shared
 *    by all sessions, so a burst of turns costs one model call.
 *  - The cursor is persisted per session, so events that never reached the
 *    model (app quit, failed call) are picked up on the next turn.
 *  - Nothing here blocks sending messages; failures are logged and retried.
 */
export class MemoryManager {
  private readonly store: MemoryStore
  private readonly distiller: MemoryDistiller
  private readonly debounceMs: number
  private readonly pending = new Set<string>()
  /** Consecutive failures per session drive an exponential retry backoff. */
  private readonly failures = new Map<string, number>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private pendingSince: number | null = null
  private inFlight = false
  private disposed = false

  constructor(private readonly options: MemoryManagerOptions) {
    this.store = new MemoryStore(options.userDataDir)
    this.distiller = options.distiller ?? deepSeekMemoryDistiller
    this.debounceMs = options.debounceMs ?? MEMORY_DEBOUNCE_MS
  }

  onTurnEnd(sessionId: string): void {
    if (this.disposed) return
    if (this.pending.size === 0) this.pendingSince = Date.now()
    this.pending.add(sessionId)
    this.arm(this.debounceMs)
  }

  info(cwd: string): MemoryInfo {
    this.store.reloadProject(cwd)
    this.store.reloadUser()
    return this.store.info(cwd)
  }

  /** The block appended to a new session's system prompt. */
  injectionBlock(cwd: string): string | null {
    // Pick up edits made to the JSON files while the app was running.
    this.store.reloadProject(cwd)
    this.store.reloadUser()
    return buildMemoryInjection(this.store.projectEntries(cwd), this.store.userEntries())
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private arm(delay: number): void {
    if (this.disposed) return
    if (this.timer) clearTimeout(this.timer)
    let wait = delay
    if (delay === this.debounceMs && this.pendingSince !== null) {
      wait = Math.min(wait, Math.max(0, MAX_WAIT_MS - (Date.now() - this.pendingSince)))
    }
    this.timer = setTimeout(() => {
      this.timer = null
      void this.drain()
    }, wait)
    // Distillation alone should never keep the app process alive.
    this.timer.unref?.()
  }

  private async drain(): Promise<void> {
    if (this.disposed) return
    if (this.inFlight) {
      this.arm(RETRY_BUSY_MS)
      return
    }
    const ids = [...this.pending]
    if (ids.length === 0) return

    this.inFlight = true
    let retry: number | null = null
    try {
      for (const sessionId of ids) {
        const outcome = await this.distillSession(sessionId)
        if (outcome === 'done' || outcome === 'empty' || outcome === 'missing') {
          this.pending.delete(sessionId)
          this.failures.delete(sessionId)
        } else if (outcome === 'again') {
          retry = Math.max(retry ?? 0, RETRY_AGAIN_MS)
        } else if (outcome === 'failed') {
          const attempts = (this.failures.get(sessionId) ?? 0) + 1
          this.failures.set(sessionId, attempts)
          const delay = Math.min(
            RETRY_FAILED_MS * 2 ** Math.min(attempts - 1, 4),
            RETRY_FAILED_MAX_MS
          )
          retry = Math.max(retry ?? 0, delay)
        } else {
          retry = Math.max(retry ?? 0, RETRY_NO_KEY_MS)
        }
      }
    } finally {
      this.inFlight = false
    }
    if (this.pending.size === 0) this.pendingSince = null
    else if (!this.disposed) this.arm(retry ?? RETRY_BUSY_MS)
  }

  private async distillSession(sessionId: string): Promise<Outcome> {
    const record = this.options.getRecord(sessionId)
    if (!record || !record.cwd) return 'missing'

    const events = this.options.loadEvents(sessionId)
    const cursor = this.store.cursor(record.cwd, sessionId)
    const fresh = events.filter((envelope) => envelope.seq > cursor)
    if (fresh.length === 0) return 'empty'

    const credential = this.options.getCredential()
    if (!credential.apiKey) return 'no_key'

    this.store.reloadProject(record.cwd)
    this.store.reloadUser()
    const project = this.store.projectEntries(record.cwd)
    const user = this.store.userEntries()

    let delta
    try {
      delta = await this.distiller.distill({
        events: fresh,
        project,
        user,
        baseUrl: credential.baseUrl,
        apiKey: credential.apiKey,
        // Follow the session's model; the provider wants the bare name.
        model: (record.model || credential.fallbackModel).replace(/\[1m\]$/, '')
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      this.options.log?.(`记忆蒸馏失败（${sessionId}）：${detail}`)
      return 'failed'
    }

    const result = applyMemoryDelta(project, user, delta, { sessionId })
    const maxSeq = Math.max(...fresh.map((envelope) => envelope.seq))
    this.store.commitProject(record.cwd, {
      entries: result.project,
      sessionId,
      cursorSeq: maxSeq
    })
    this.store.saveUserEntries(result.user)
    this.store.writeMirror(record.cwd, result.project)

    if (result.added + result.updated + result.deleted > 0) {
      this.options.note(sessionId, memoryNoteText(result))
    }

    // A turn that ended while the model was answering still needs a pass.
    const latest = this.options.loadEvents(sessionId)
    if (latest.some((envelope) => envelope.seq > maxSeq)) return 'again'
    return 'done'
  }
}
