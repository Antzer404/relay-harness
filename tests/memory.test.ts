import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MemoryEntry, RelayEvent, SessionRecord } from '../src/shared/events'
import { MemoryManager } from '../src/main/services/memory-manager'
import {
  MEMORY_TOKEN_BUDGET,
  applyMemoryDelta,
  buildMemoryInjection,
  buildMemoryTranscript,
  estimateTokens,
  parseMemoryDelta,
  type MemoryDistiller
} from '../src/main/services/memory-service'
import {
  MemoryStore,
  PROJECT_MEMORY_CAP,
  workspaceKey
} from '../src/main/services/memory-store'

const dirs: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'relay-memory-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  vi.useRealTimers()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function entry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: overrides.id ?? `m-${Math.random().toString(36).slice(2, 8)}`,
    track: 'project',
    category: 'decision',
    content: '使用 pnpm 管理依赖',
    confidence: 0.8,
    enabled: true,
    sourceSessionId: 's1',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function event(inner: RelayEvent['event'], seq: number): RelayEvent {
  return { sessionId: 's1', seq, ts: 1_790_000_000_000 + seq, event: inner }
}

describe('MemoryStore', () => {
  it('persists project entries and per-session cursors', () => {
    const dir = makeDir()
    const cwd = join(dir, 'work')
    const store = new MemoryStore(dir)
    store.commitProject(cwd, {
      entries: [entry({ id: 'a' })],
      sessionId: 's1',
      cursorSeq: 7
    })

    const reloaded = new MemoryStore(dir)
    expect(reloaded.projectEntries(cwd).map((item) => item.id)).toEqual(['a'])
    expect(reloaded.cursor(cwd, 's1')).toBe(7)
    expect(reloaded.cursor(cwd, 's2')).toBe(0)

    // The cursor only moves forward.
    reloaded.setCursor(cwd, 's1', 4)
    expect(reloaded.cursor(cwd, 's1')).toBe(7)
    reloaded.setCursor(cwd, 's1', 9)
    expect(new MemoryStore(dir).cursor(cwd, 's1')).toBe(9)
  })

  it('prunes the lowest-confidence entries when a project overflows', () => {
    const dir = makeDir()
    const cwd = join(dir, 'work')
    const store = new MemoryStore(dir)
    const entries = Array.from({ length: PROJECT_MEMORY_CAP + 10 }, (_, index) =>
      entry({
        id: `m${index}`,
        content: `内容 ${index}`,
        confidence: index / (PROJECT_MEMORY_CAP + 10)
      })
    )
    store.commitProject(cwd, { entries, sessionId: 's1', cursorSeq: 1 })
    const kept = new MemoryStore(dir).projectEntries(cwd)
    expect(kept).toHaveLength(PROJECT_MEMORY_CAP)
    expect(kept.some((item) => item.id === 'm0')).toBe(false)
    expect(kept.some((item) => item.id === 'm129')).toBe(true)
  })

  it('survives a corrupt project file and user file', () => {
    const dir = makeDir()
    const cwd = join(dir, 'work')
    const store = new MemoryStore(dir)
    writeFileSync(
      join(dir, 'memory', 'projects', `${workspaceKey(cwd)}.json`),
      '{oops',
      'utf8'
    )
    writeFileSync(join(dir, 'memory', 'user.json'), 'not json', 'utf8')
    expect(store.projectEntries(cwd)).toEqual([])
    expect(store.userEntries()).toEqual([])
    expect(store.cursor(cwd, 's1')).toBe(0)
  })

  it('writes a readable mirror grouped by category, skipping disabled entries', () => {
    const dir = makeDir()
    const cwd = join(dir, 'work')
    const store = new MemoryStore(dir)
    store.writeMirror(
      cwd,
      [
        entry({ id: 'a', category: 'decision', content: '构建用 electron-vite' }),
        entry({ id: 'b', category: 'pitfall', content: 'Windows 上 TEMP 权限会导致 EPERM' }),
        entry({ id: 'c', category: 'decision', content: '已停用的条目', enabled: false })
      ],
      1_790_000_000_000
    )
    const markdown = readFileSync(join(cwd, '.relay', 'memory.md'), 'utf8')
    expect(markdown).toContain('# Relay 长期记忆 · 项目')
    expect(markdown).toContain('## 决策')
    expect(markdown).toContain('- 构建用 electron-vite')
    expect(markdown).toContain('## 坑')
    expect(markdown).toContain('Windows 上 TEMP 权限会导致 EPERM')
    expect(markdown).not.toContain('已停用的条目')
    expect(markdown).toContain(cwd)
  })

  it('reports enabled counts and the mirror path', () => {
    const dir = makeDir()
    const cwd = join(dir, 'work')
    const store = new MemoryStore(dir)
    store.commitProject(cwd, {
      entries: [entry({ id: 'a' }), entry({ id: 'b', enabled: false })],
      sessionId: 's1',
      cursorSeq: 1
    })
    store.saveUserEntries([entry({ id: 'u1', track: 'user', category: 'preference' })])
    const info = store.info(cwd)
    expect(info.dir).toBe(join(dir, 'memory'))
    expect(info.mirror).toBe(join(cwd, '.relay', 'memory.md'))
    expect(info.projectCount).toBe(1)
    expect(info.userCount).toBe(1)
  })
})

describe('memory delta parsing', () => {
  it('accepts fenced JSON and fills missing arrays', () => {
    const delta = parseMemoryDelta(
      '```json\n{"add":[{"track":"project","category":"pitfall","content":"TEMP 目录权限会导致写文件 EPERM","confidence":"0.9"}]}\n```'
    )
    expect(delta.add).toHaveLength(1)
    expect(delta.add[0]?.confidence).toBe(0.9)
    expect(delta.update).toEqual([])
    expect(delta.delete).toEqual([])
  })

  it('finds the JSON object when the model adds prose around it', () => {
    const delta = parseMemoryDelta('好的，增量如下：{"add":[],"update":[],"delete":[{"id":"x"}]} 完毕')
    expect(delta.delete).toEqual([{ id: 'x' }])
  })

  it('rejects replies without a JSON object', () => {
    expect(() => parseMemoryDelta('这一轮没有值得记录的内容。')).toThrow('不是有效 JSON')
  })
})

describe('applyMemoryDelta', () => {
  const meta = { sessionId: 's9', now: 1_790_000_000_000 }

  it('adds, updates and deletes entries across both tracks', () => {
    const project = [entry({ id: 'p1', content: '旧的决策' })]
    const user = [entry({ id: 'u1', track: 'user', category: 'preference', content: '喜欢中文' })]
    const result = applyMemoryDelta(
      project,
      user,
      {
        add: [
          { track: 'project', category: 'convention', content: '提交前必须跑 typecheck', confidence: 0.9 }
        ],
        update: [{ id: 'u1', content: '用简体中文交流', confidence: 0.95 }],
        delete: [{ id: 'p1', reason: '已过时' }]
      },
      meta
    )
    expect(result.deleted).toBe(1)
    expect(result.updated).toBe(1)
    expect(result.added).toBe(1)
    expect(result.project.map((item) => item.content)).toEqual(['提交前必须跑 typecheck'])
    expect(result.user[0]?.content).toBe('用简体中文交流')
    expect(result.user[0]?.confidence).toBe(0.95)
    expect(result.user[0]?.updatedAt).toBe(meta.now)
    expect(result.project[0]?.sourceSessionId).toBe('s9')
  })

  it('drops duplicate adds and unknown ids without failing', () => {
    const project = [entry({ content: '使用  PNPM 管理依赖' })]
    const result = applyMemoryDelta(
      project,
      [],
      {
        add: [{ track: 'project', category: 'decision', content: '使用 pnpm 管理依赖' }],
        update: [{ id: 'missing', content: 'x' }],
        delete: [{ id: 'missing' }]
      },
      meta
    )
    expect(result.added).toBe(0)
    expect(result.updated).toBe(0)
    expect(result.deleted).toBe(0)
    expect(result.skipped).toBe(3)
    expect(result.project).toHaveLength(1)
  })

  it('caps adds and truncates long content', () => {
    const delta = {
      add: Array.from({ length: 9 }, (_, index) => ({
        track: 'project' as const,
        category: 'convention' as const,
        content: `${index}-${'长'.repeat(400)}`
      })),
      update: [],
      delete: []
    }
    const result = applyMemoryDelta([], [], delta, meta)
    expect(result.added).toBe(5)
    for (const item of result.project) expect(item.content.length).toBeLessThanOrEqual(241)
  })
})

describe('memory injection', () => {
  it('returns null when nothing is enabled', () => {
    expect(buildMemoryInjection([], [])).toBeNull()
    expect(buildMemoryInjection([entry({ enabled: false })], [])).toBeNull()
  })

  it('labels both tracks and includes categories', () => {
    const block = buildMemoryInjection(
      [entry({ category: 'pitfall', content: 'Windows 的 TEMP 目录会 EPERM' })],
      [entry({ track: 'user', category: 'preference', content: '用简体中文交流' })]
    )
    expect(block).toContain('## 长期记忆')
    expect(block).toContain('### 项目记忆')
    expect(block).toContain('- [坑] Windows 的 TEMP 目录会 EPERM')
    expect(block).toContain('### 用户画像')
    expect(block).toContain('- [偏好] 用简体中文交流')
  })

  it('fits the 2000-token budget and prefers confident entries', () => {
    const project = Array.from({ length: 80 }, (_, index) =>
      entry({
        id: `p${index}`,
        content: `${index} ${'细节'.repeat(90)}`,
        confidence: index / 100
      })
    )
    const user = Array.from({ length: 40 }, (_, index) =>
      entry({
        id: `u${index}`,
        track: 'user',
        category: 'preference',
        content: `${index} ${'画像'.repeat(90)}`,
        confidence: index / 100
      })
    )
    const block = buildMemoryInjection(project, user)
    expect(block).not.toBeNull()
    expect(estimateTokens(block as string)).toBeLessThanOrEqual(MEMORY_TOKEN_BUDGET + 100)
    expect(block).toContain('- [决策] 79 ')
    expect(block).not.toContain('- [决策] 0 ')
  })
})

describe('memory transcript', () => {
  it('keeps the turn but drops thinking', () => {
    const text = buildMemoryTranscript([
      event({ type: 'user_message', text: '把构建脚本迁移到 esbuild' }, 1),
      event({ type: 'thinking_done', text: '内部推理' }, 2),
      event({ type: 'text_done', text: '迁移完成' }, 3),
      event({ type: 'turn_end', reason: 'success', isError: false, durationMs: 1, costUsd: null }, 4)
    ])
    expect(text).toContain('把构建脚本迁移到 esbuild')
    expect(text).toContain('迁移完成')
    expect(text).not.toContain('内部推理')
  })
})

describe('MemoryManager', () => {
  function setup(overrides: {
    distiller?: MemoryDistiller
    events?: RelayEvent[]
    debounceMs?: number
  } = {}): {
    manager: MemoryManager
    dir: string
    cwd: string
    notes: string[]
    calls: number[][]
    events: RelayEvent[]
  } {
    const dir = makeDir()
    const cwd = join(dir, 'work')
    const notes: string[] = []
    const calls: number[][] = []
    const events = overrides.events ?? []
    const distiller: MemoryDistiller = overrides.distiller ?? {
      distill: async (input) => {
        calls.push(input.events.map((item) => item.seq))
        return {
          add: [
            {
              track: 'project',
              category: 'decision',
              content: `第 ${input.events[0]?.seq ?? 0} 轮得出的决策`,
              confidence: 0.8
            }
          ],
          update: [],
          delete: []
        }
      }
    }
    const record: SessionRecord = {
      id: 's1',
      title: '测试会话',
      cwd,
      model: 'deepseek-flash[1m]',
      createdAt: 1,
      updatedAt: 1,
      cliSessionId: null,
      eventCount: events.length,
      handoffFrom: null
    }
    const manager = new MemoryManager({
      userDataDir: dir,
      loadEvents: () => events,
      getRecord: (sessionId) => (sessionId === 's1' ? record : null),
      getCredential: () => ({
        apiKey: 'sk-test',
        baseUrl: 'http://127.0.0.1:1',
        fallbackModel: 'deepseek-flash[1m]'
      }),
      note: (_sessionId, message) => notes.push(message),
      distiller,
      debounceMs: overrides.debounceMs ?? 120_000
    })
    return { manager, dir, cwd, notes, calls, events }
  }

  it('waits for the two-minute debounce, then distils and advances the cursor', async () => {
    vi.useFakeTimers()
    const context = setup()
    context.events.push(
      event({ type: 'user_message', text: '写一个脚本' }, 1),
      event({ type: 'text_done', text: '完成' }, 2),
      event({ type: 'turn_end', reason: 'success', isError: false, durationMs: 1, costUsd: null }, 3)
    )
    context.manager.onTurnEnd('s1')
    await vi.advanceTimersByTimeAsync(119_999)
    expect(context.calls).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1)
    expect(context.calls).toEqual([[1, 2, 3]])
    expect(context.notes).toEqual(['长期记忆已更新：新增 1 条。'])
    expect(new MemoryStore(context.dir).cursor(context.cwd, 's1')).toBe(3)

    // Nothing new: no second model call, no note.
    context.manager.onTurnEnd('s1')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(context.calls).toHaveLength(1)
    expect(context.notes).toHaveLength(1)
    context.manager.dispose()
  })

  it('resets the debounce on every turn and only sends undistilled events', async () => {
    vi.useFakeTimers()
    const context = setup()
    context.events.push(
      event({ type: 'user_message', text: '第一轮' }, 1),
      event({ type: 'turn_end', reason: 'success', isError: false, durationMs: 1, costUsd: null }, 2)
    )
    context.manager.onTurnEnd('s1')
    await vi.advanceTimersByTimeAsync(60_000)
    context.events.push(
      event({ type: 'user_message', text: '第二轮' }, 3),
      event({ type: 'turn_end', reason: 'success', isError: false, durationMs: 1, costUsd: null }, 4)
    )
    context.manager.onTurnEnd('s1')
    await vi.advanceTimersByTimeAsync(119_999)
    expect(context.calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(context.calls).toEqual([[1, 2, 3, 4]])

    context.events.push(
      event({ type: 'user_message', text: '第三轮' }, 5),
      event({ type: 'turn_end', reason: 'success', isError: false, durationMs: 1, costUsd: null }, 6)
    )
    context.manager.onTurnEnd('s1')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(context.calls).toEqual([[1, 2, 3, 4], [5, 6]])
    context.manager.dispose()
  })

  it('retries after a failed call without advancing the cursor', async () => {
    vi.useFakeTimers()
    let attempts = 0
    const context = setup({
      distiller: {
        distill: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('rate limited')
          return { add: [], update: [], delete: [] }
        }
      }
    })
    context.events.push(
      event({ type: 'user_message', text: '会失败的一轮' }, 1),
      event({ type: 'turn_end', reason: 'success', isError: false, durationMs: 1, costUsd: null }, 2)
    )
    context.manager.onTurnEnd('s1')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(attempts).toBe(1)
    expect(new MemoryStore(context.dir).cursor(context.cwd, 's1')).toBe(0)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(attempts).toBe(2)
    expect(new MemoryStore(context.dir).cursor(context.cwd, 's1')).toBe(2)
    context.manager.dispose()
  })

  it('forces a pass after ten minutes of turns that keep resetting the debounce', async () => {
    vi.useFakeTimers()
    const context = setup()
    let seq = 0
    const addTurn = (): void => {
      seq += 2
      context.events.push(
        event({ type: 'user_message', text: `第 ${seq / 2} 轮` }, seq - 1),
        event({ type: 'turn_end', reason: 'success', isError: false, durationMs: 1, costUsd: null }, seq)
      )
      context.manager.onTurnEnd('s1')
    }

    addTurn()
    for (let index = 0; index < 5; index += 1) {
      await vi.advanceTimersByTimeAsync(119_000)
      addTurn()
    }
    // 595 s elapsed: the plain debounce would still wait, the max-wait fires.
    expect(context.calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(context.calls).toHaveLength(1)
    expect(context.calls[0]?.length).toBe(12)
    context.manager.dispose()
  })

  it('picks up manual JSON edits when building the injection block', () => {
    const context = setup()
    const file = join(
      context.dir,
      'memory',
      'projects',
      `${workspaceKey(context.cwd)}.json`
    )
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        cwd: context.cwd,
        entries: [entry({ id: 'manual', content: '手工写入的记忆' })],
        cursors: {},
        updatedAt: 1
      }),
      'utf8'
    )
    expect(context.manager.injectionBlock(context.cwd)).toContain('手工写入的记忆')
    expect(context.manager.info(context.cwd).projectCount).toBe(1)
    context.manager.dispose()
  })

  it('injects the stored project and user memory into the next session block', async () => {
    vi.useFakeTimers()
    const context = setup()
    context.events.push(
      event({ type: 'user_message', text: '改用 pnpm' }, 1),
      event({ type: 'turn_end', reason: 'success', isError: false, durationMs: 1, costUsd: null }, 2)
    )
    context.manager.onTurnEnd('s1')
    await vi.advanceTimersByTimeAsync(120_000)
    const block = context.manager.injectionBlock(context.cwd)
    expect(block).toContain('### 项目记忆')
    expect(block).toContain('第 1 轮得出的决策')
    expect(context.manager.info(context.cwd).projectCount).toBe(1)
    context.manager.dispose()
  })
})
