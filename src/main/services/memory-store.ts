import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  MEMORY_CATEGORY_LABELS,
  type MemoryCategory,
  type MemoryEntry,
  type MemoryInfo,
  type MemoryTrack
} from '@shared/events'

/** Caps keep one workspace from drowning the 2000-token injection budget. */
export const PROJECT_MEMORY_CAP = 120
export const USER_MEMORY_CAP = 60

const CATEGORY_ORDER: MemoryCategory[] = [
  'decision',
  'convention',
  'pitfall',
  'file-map',
  'preference',
  'correction'
]

const CATEGORIES = new Set<string>(CATEGORY_ORDER)

interface ProjectMemoryFile {
  version: 1
  cwd: string
  entries: MemoryEntry[]
  /** Highest distilled event seq per session; failures leave the cursor behind. */
  cursors: Record<string, number>
  updatedAt: number
}

interface UserMemoryFile {
  version: 1
  entries: MemoryEntry[]
  updatedAt: number
}

export interface ProjectMemory {
  cwd: string
  entries: MemoryEntry[]
  cursors: Record<string, number>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseEntry(value: unknown): MemoryEntry | null {
  if (!isRecord(value)) return null
  const { id, content } = value
  if (typeof id !== 'string' || !id) return null
  if (typeof content !== 'string' || !content.trim()) return null
  const track: MemoryTrack = value.track === 'user' ? 'user' : 'project'
  const category: MemoryCategory =
    typeof value.category === 'string' && CATEGORIES.has(value.category)
      ? (value.category as MemoryCategory)
      : 'convention'
  const createdAt = typeof value.createdAt === 'number' ? value.createdAt : Date.now()
  return {
    id,
    track,
    category,
    content: content.trim(),
    confidence:
      typeof value.confidence === 'number' && Number.isFinite(value.confidence)
        ? Math.min(1, Math.max(0, value.confidence))
        : 0.6,
    enabled: value.enabled !== false,
    sourceSessionId: typeof value.sourceSessionId === 'string' ? value.sourceSessionId : null,
    createdAt,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : createdAt
  }
}

function parseEntries(value: unknown): MemoryEntry[] {
  if (!Array.isArray(value)) return []
  const entries: MemoryEntry[] = []
  for (const raw of value) {
    const entry = parseEntry(raw)
    if (entry) entries.push(entry)
  }
  return entries
}

/**
 * Keeps the most valuable entries when a track overflows. Enabled entries win
 * over disabled ones, then confidence, then recency.
 */
export function pruneEntries(entries: MemoryEntry[], cap: number): MemoryEntry[] {
  if (entries.length <= cap) return entries
  const ranked = [...entries].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
    if (a.confidence !== b.confidence) return b.confidence - a.confidence
    return b.updatedAt - a.updatedAt
  })
  return ranked.slice(0, cap)
}

/** Stable file name for a workspace path; Windows paths are case-insensitive. */
export function workspaceKey(cwd: string): string {
  const resolved = resolve(cwd)
  const normalised = process.platform === 'win32' ? resolved.toLowerCase() : resolved
  return createHash('sha1').update(normalised).digest('hex').slice(0, 12)
}

/**
 * Long-term memory lives under `userData/memory`: one global `user.json` for
 * the user portrait and one file per workspace for project memory. The
 * workspace mirror `<cwd>/.relay/memory.md` is generated, never read back.
 */
export class MemoryStore {
  private readonly dir: string
  private readonly projectsDir: string
  private readonly userPath: string
  private readonly projects = new Map<string, ProjectMemoryFile>()
  private user: UserMemoryFile | null = null

  constructor(userDataDir: string) {
    this.dir = join(userDataDir, 'memory')
    this.projectsDir = join(this.dir, 'projects')
    this.userPath = join(this.dir, 'user.json')
    mkdirSync(this.projectsDir, { recursive: true })
  }

  getDir(): string {
    return this.dir
  }

  mirrorPath(cwd: string): string {
    return join(cwd, '.relay', 'memory.md')
  }

  // --------------------------------------------------------------- project

  private projectPath(cwd: string): string {
    return join(this.projectsDir, `${workspaceKey(cwd)}.json`)
  }

  project(cwd: string): ProjectMemory {
    const key = workspaceKey(cwd)
    let file = this.projects.get(key)
    if (!file) {
      file = this.loadProjectFile(cwd)
      this.projects.set(key, file)
    }
    return {
      cwd: file.cwd,
      entries: file.entries.map((entry) => ({ ...entry })),
      cursors: { ...file.cursors }
    }
  }

  projectEntries(cwd: string): MemoryEntry[] {
    return this.project(cwd).entries
  }

  /** Drops the cache so manual edits to the JSON file become visible. */
  reloadProject(cwd: string): void {
    this.projects.delete(workspaceKey(cwd))
  }

  reloadUser(): void {
    this.user = null
  }

  private loadProjectFile(cwd: string): ProjectMemoryFile {
    const empty: ProjectMemoryFile = {
      version: 1,
      cwd,
      entries: [],
      cursors: {},
      updatedAt: Date.now()
    }
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.projectPath(cwd), 'utf8'))
      if (!isRecord(parsed)) return empty
      const cursors: Record<string, number> = {}
      if (isRecord(parsed.cursors)) {
        for (const [sessionId, seq] of Object.entries(parsed.cursors)) {
          if (typeof seq === 'number' && Number.isFinite(seq)) cursors[sessionId] = seq
        }
      }
      return {
        version: 1,
        cwd: typeof parsed.cwd === 'string' && parsed.cwd ? parsed.cwd : cwd,
        entries: parseEntries(parsed.entries),
        cursors,
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now()
      }
    } catch {
      // Missing or corrupt file starts from an empty set.
      return empty
    }
  }

  cursor(cwd: string, sessionId: string): number {
    return this.project(cwd).cursors[sessionId] ?? 0
  }

  /** Replaces a workspace's entries and advances one session's cursor. */
  commitProject(
    cwd: string,
    update: { entries: MemoryEntry[]; sessionId: string; cursorSeq: number }
  ): void {
    const key = workspaceKey(cwd)
    const existing = this.projects.get(key) ?? this.loadProjectFile(cwd)
    const next: ProjectMemoryFile = {
      version: 1,
      cwd: existing.cwd || cwd,
      entries: pruneEntries(update.entries, PROJECT_MEMORY_CAP),
      cursors: {
        ...existing.cursors,
        [update.sessionId]: Math.max(existing.cursors[update.sessionId] ?? 0, update.cursorSeq)
      },
      updatedAt: Date.now()
    }
    this.projects.set(key, next)
    this.persistProject(next)
  }

  /** Moves the cursor without touching entries (e.g. an empty delta). */
  setCursor(cwd: string, sessionId: string, cursorSeq: number): void {
    const key = workspaceKey(cwd)
    const existing = this.projects.get(key) ?? this.loadProjectFile(cwd)
    const next: ProjectMemoryFile = {
      ...existing,
      cursors: {
        ...existing.cursors,
        [sessionId]: Math.max(existing.cursors[sessionId] ?? 0, cursorSeq)
      },
      updatedAt: Date.now()
    }
    this.projects.set(key, next)
    this.persistProject(next)
  }

  private persistProject(file: ProjectMemoryFile): void {
    try {
      writeFileSync(this.projectPath(file.cwd), `${JSON.stringify(file, null, 2)}\n`, 'utf8')
    } catch {
      // A read-only profile directory must not break the turn loop.
    }
  }

  // ------------------------------------------------------------------ user

  private loadUserFile(): UserMemoryFile {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.userPath, 'utf8'))
      if (isRecord(parsed)) {
        return {
          version: 1,
          entries: parseEntries(parsed.entries),
          updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now()
        }
      }
    } catch {
      // Fall through to empty.
    }
    return { version: 1, entries: [], updatedAt: Date.now() }
  }

  userEntries(): MemoryEntry[] {
    if (!this.user) this.user = this.loadUserFile()
    return this.user.entries.map((entry) => ({ ...entry }))
  }

  saveUserEntries(entries: MemoryEntry[]): void {
    this.user = {
      version: 1,
      entries: pruneEntries(entries, USER_MEMORY_CAP),
      updatedAt: Date.now()
    }
    try {
      writeFileSync(this.userPath, `${JSON.stringify(this.user, null, 2)}\n`, 'utf8')
    } catch {
      // Ignore unwritable profile directories.
    }
  }

  // ---------------------------------------------------------------- mirror

  /**
   * Rewrites `<cwd>/.relay/memory.md` from the project track. The file is a
   * human-readable mirror only: edits are overwritten by the next commit.
   */
  writeMirror(cwd: string, entries: MemoryEntry[], now = Date.now()): void {
    const path = this.mirrorPath(cwd)
    try {
      mkdirSync(join(cwd, '.relay'), { recursive: true })
      const stamp = new Date(now).toLocaleString('zh-CN', { hour12: false })
      const lines: string[] = [
        '# Relay 长期记忆 · 项目',
        '',
        '> 由 Relay 自动整理生成，手工修改会在下次整理时被覆盖。',
        `> 工作区：${cwd}`,
        `> 更新：${stamp}`,
        ''
      ]
      const enabled = entries.filter((entry) => entry.enabled)
      if (enabled.length === 0) {
        lines.push('（暂无项目记忆）', '')
      } else {
        for (const category of CATEGORY_ORDER) {
          const group = enabled.filter((entry) => entry.category === category)
          if (group.length === 0) continue
          lines.push(`## ${MEMORY_CATEGORY_LABELS[category]}`, '')
          for (const entry of group) lines.push(`- ${entry.content}`)
          lines.push('')
        }
      }
      writeFileSync(path, `${lines.join('\n').trimEnd()}\n`, 'utf8')
    } catch {
      // The working directory may be read-only; the JSON store still has it.
    }
  }

  // ------------------------------------------------------------------ info

  info(cwd: string): MemoryInfo {
    return {
      dir: this.dir,
      mirror: this.mirrorPath(cwd),
      projectCount: this.projectEntries(cwd).filter((entry) => entry.enabled).length,
      userCount: this.userEntries().filter((entry) => entry.enabled).length
    }
  }

  /** Test/help hook: whether the per-workspace file already exists. */
  hasProjectFile(cwd: string): boolean {
    return existsSync(this.projectPath(cwd))
  }
}
