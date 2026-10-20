import { describe, expect, it } from 'vitest'
import type { TextItem, ThinkingItem, ToolItem } from '../src/shared/timeline'
import { groupTimeline } from '../src/renderer/src/lib/timeline-groups'
import { estimateRowHeight } from '../src/renderer/src/lib/timeline-layout'
import { setGroupOpen } from '../src/renderer/src/lib/item-open-state'

function thinking(id: string, overrides: Partial<ThinkingItem> = {}): ThinkingItem {
  return {
    kind: 'thinking',
    id,
    text: '想一想',
    done: true,
    startedAt: 1000,
    durationMs: 1200,
    ...overrides
  }
}

function tool(id: string, overrides: Partial<ToolItem> = {}): ToolItem {
  return {
    kind: 'tool',
    id,
    toolUseId: `toolu-${id}`,
    name: 'Read',
    input: { file_path: '/a.ts' },
    startedAt: 2500,
    durationMs: 400,
    status: 'done',
    ...overrides
  }
}

function text(id: string): TextItem {
  return { kind: 'text', id, text: '回答', done: true }
}

describe('groupTimeline', () => {
  it('folds consecutive thinking and tool rows into one group', () => {
    const rows = groupTimeline([thinking('t1'), tool('x1'), thinking('t2'), tool('x2')])
    expect(rows).toHaveLength(1)
    const group = rows[0]
    expect(group?.kind).toBe('group')
    if (group?.kind !== 'group') return
    expect(group.id).toBe('group:t1')
    expect(group.items.map((item) => item.id)).toEqual(['t1', 'x1', 't2', 'x2'])
    expect(group.status).toBe('done')
    expect(group.startedAt).toBe(1000)
    expect(group.endedAt).toBe(2900)
  })

  it('keeps a single process row ungrouped', () => {
    const rows = groupTimeline([tool('x1')])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('tool')
  })

  it('breaks groups around user messages, assistant text and errors', () => {
    const rows = groupTimeline([
      thinking('t1'),
      tool('x1'),
      text('a1'),
      thinking('t2'),
      tool('x2')
    ])
    expect(rows.map((row) => row.kind)).toEqual(['group', 'text', 'group'])
  })

  it('reports running while any member is unfinished and drops endedAt', () => {
    const rows = groupTimeline([
      tool('x1'),
      tool('x2', { status: 'running', durationMs: null })
    ])
    const group = rows[0]
    expect(group?.kind).toBe('group')
    if (group?.kind !== 'group') return
    expect(group.status).toBe('running')
    expect(group.endedAt).toBeNull()
  })

  it('marks finished groups with failed tools as errors', () => {
    const rows = groupTimeline([tool('x1'), tool('x2', { status: 'error', isError: true })])
    const group = rows[0]
    expect(group?.kind === 'group' && group.status).toBe('error')
  })

  it('keeps the group id stable while the run grows', () => {
    const before = groupTimeline([thinking('t1'), tool('x1')])
    const after = groupTimeline([thinking('t1'), tool('x1'), thinking('t3')])
    expect(before[0]?.id).toBe('group:t1')
    expect(after[0]?.id).toBe('group:t1')
  })
})

describe('estimateRowHeight', () => {
  it('estimates collapsed groups cheaply and expands with details', () => {
    const group = groupTimeline([thinking('g1'), tool('gx1')])[0]
    if (!group || group.kind !== 'group') throw new Error('expected a group')
    // Finished groups default to collapsed.
    expect(estimateRowHeight(group)).toBe(46)
    setGroupOpen(group.id, true)
    expect(estimateRowHeight(group)).toBeGreaterThan(46)
    setGroupOpen(group.id, false)
  })
})
