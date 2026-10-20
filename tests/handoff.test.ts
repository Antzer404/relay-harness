import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { HandoffDoc, RelayEvent } from '../src/shared/events'
import {
  MAX_TRANSCRIPT_CHARS,
  buildHandoffTranscript,
  extractTextContent,
  stripCodeFence
} from '../src/main/services/handoff-service'
import { HandoffStore } from '../src/main/services/handoff-store'
import { handoffContextBlock } from '../src/main/services/session-manager'

function envelope(event: RelayEvent['event'], seq = 1): RelayEvent {
  return { sessionId: 's1', seq, ts: 1_790_000_000_000, event }
}

const meta = {
  title: '迁移构建脚本',
  cwd: '/work/demo',
  model: 'deepseek-flash[1m]',
  contextPercent: 72.4
}

describe('handoff transcript', () => {
  it('keeps user, assistant, tool and error information but drops thinking', () => {
    const events: RelayEvent[] = [
      envelope({ type: 'user_message', text: '把构建脚本迁移到 esbuild' }),
      envelope({ type: 'thinking_delta', text: '内部推理不应出现' }),
      envelope({ type: 'thinking_done', text: '内部推理不应出现' }),
      envelope({
        type: 'tool_call',
        toolUseId: 't1',
        name: 'Read',
        input: { file_path: '/work/demo/vite.config.ts' },
        startedAt: 1
      }),
      envelope({
        type: 'tool_result',
        toolUseId: 't1',
        output: 'export default {}',
        isError: false,
        durationMs: 12
      }),
      envelope({ type: 'text_done', text: '迁移完成，接下来跑一次构建。' }),
      envelope({ type: 'error', code: 'x', message: '构建失败：缺少依赖', retryable: false })
    ]
    const text = buildHandoffTranscript(events, meta)
    expect(text).toContain('会话：迁移构建脚本')
    expect(text).toContain('上下文填充：72.4%')
    expect(text).toContain('把构建脚本迁移到 esbuild')
    expect(text).toContain('迁移完成，接下来跑一次构建。')
    expect(text).toContain('`Read` file_path=/work/demo/vite.config.ts')
    expect(text).toContain('构建失败：缺少依赖')
    expect(text).not.toContain('内部推理不应出现')
  })

  it('trims the middle but keeps the goal and the latest state', () => {
    const events: RelayEvent[] = []
    for (let index = 0; index < 120; index += 1) {
      const head = index === 0 ? '开头-' : index === 119 ? '结尾-' : ''
      events.push(
        envelope(
          {
            type: 'user_message',
            text: `${head}${index} ${'内容'.repeat(900)}`
          },
          index + 1
        )
      )
    }
    const text = buildHandoffTranscript(events, meta)
    expect(text.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_CHARS + 200)
    expect(text).toContain('中间省略')
    expect(text).toContain('开头-0')
    expect(text).toContain('结尾-119')
    expect(text).not.toContain('120 条事件，共')
  })
})

describe('model response parsing', () => {
  it('collects text blocks and ignores thinking', () => {
    expect(
      extractTextContent([
        { type: 'thinking', text: '推理' },
        { type: 'text', text: '## 目标\n迁移构建' },
        { type: 'text', text: '补充一句。' }
      ])
    ).toBe('## 目标\n迁移构建\n补充一句。')
  })

  it('unwraps a code fence the model added anyway', () => {
    expect(stripCodeFence('```markdown\n## 目标\n迁移\n```')).toBe('## 目标\n迁移')
    expect(stripCodeFence('## 目标\n迁移')).toBe('## 目标\n迁移')
  })
})

describe('handoff injection block', () => {
  it('labels the document so the follow-up session adopts it', () => {
    const block = handoffContextBlock({
      id: 'h1',
      fromSessionId: 's1',
      fromTitle: '旧会话',
      markdown: '## 目标\n迁移构建',
      model: 'deepseek-flash',
      contextPercent: 71,
      createdAt: 1,
      toSessionId: null,
      usedAt: null
    })
    expect(block).toContain('## 交接上下文')
    expect(block).toContain('不要要求用户重复说明')
    expect(block).toContain('## 目标\n迁移构建')
  })
})

describe('HandoffStore', () => {
  const dirs: string[] = []

  const makeStore = (): { store: HandoffStore; dir: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-handoff-'))
    dirs.push(dir)
    return { store: new HandoffStore(dir), dir }
  }

  const doc = (id: string): HandoffDoc => ({
    id,
    fromSessionId: 's1',
    fromTitle: '旧会话',
    markdown: '## 目标\nx',
    model: 'deepseek-flash',
    contextPercent: 70,
    createdAt: Date.now(),
    toSessionId: null,
    usedAt: null
  })

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('persists documents and survives a reload', () => {
    const { store, dir } = makeStore()
    store.create(doc('h1'))
    const reloaded = new HandoffStore(dir)
    expect(reloaded.get('h1')?.markdown).toBe('## 目标\nx')
  })

  it('marks the target session, edits and removes documents', () => {
    const { store } = makeStore()
    store.create(doc('h1'))
    const updated = store.update('h1', { toSessionId: 's2', usedAt: 42 })
    expect(updated?.toSessionId).toBe('s2')
    expect(store.findForTarget('s2')?.id).toBe('h1')
    expect(store.list('s1').map((entry) => entry.id)).toEqual(['h1'])
    expect(store.list('s2').map((entry) => entry.id)).toEqual(['h1'])
    expect(store.list('s3')).toEqual([])
    store.update('h1', { markdown: '改过' })
    expect(store.get('h1')?.markdown).toBe('改过')
    store.remove('h1')
    expect(store.get('h1')).toBeNull()
  })

  it('survives a corrupt file and skips malformed entries', () => {
    const corrupt = mkdtempSync(join(tmpdir(), 'relay-handoff-'))
    dirs.push(corrupt)
    writeFileSync(join(corrupt, 'handoffs.json'), '{not json', 'utf8')
    expect(new HandoffStore(corrupt).list()).toEqual([])

    const mixed = mkdtempSync(join(tmpdir(), 'relay-handoff-'))
    dirs.push(mixed)
    writeFileSync(
      join(mixed, 'handoffs.json'),
      JSON.stringify({
        version: 1,
        docs: [{ id: 'broken' }, { ...doc('h2'), markdown: '## 目标\n有效' }]
      }),
      'utf8'
    )
    const reloaded = new HandoffStore(mixed)
    expect(reloaded.list().map((entry) => entry.id)).toEqual(['h2'])
  })
})
