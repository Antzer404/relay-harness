import { describe, expect, it } from 'vitest'
import type { PermissionItem, TextItem, ThinkingItem, ToolItem } from '../src/shared/timeline'
import {
  buildLayout,
  estimateItemHeight,
  findFirstVisible,
  findVisibleRange
} from '../src/renderer/src/lib/timeline-layout'
import { permissionParamsKey, setItemOpen } from '../src/renderer/src/lib/item-open-state'

const layoutOf = (heights: number[], gap = 16) =>
  buildLayout(
    heights.map((_, index) => `row-${index}`),
    heights,
    gap
  )

describe('buildLayout', () => {
  it('places rows after the previous height plus the gap', () => {
    const layout = layoutOf([100, 50, 30])
    expect(layout.offsets).toEqual([0, 116, 182])
    expect(layout.total).toBe(212)
  })

  it('does not append a trailing gap', () => {
    const layout = layoutOf([40], 16)
    expect(layout.total).toBe(40)
  })

  it('handles an empty list', () => {
    const layout = buildLayout([], [], 16)
    expect(layout.offsets).toEqual([])
    expect(layout.total).toBe(0)
  })

  it('keeps ids aligned with rows', () => {
    const layout = buildLayout(['a', 'b'], [10, 20], 5)
    expect(layout.ids).toEqual(['a', 'b'])
  })
})

describe('findFirstVisible', () => {
  const layout = layoutOf([100, 50, 30])

  it('returns 0 at the top', () => {
    expect(findFirstVisible(layout.offsets, layout.heights, 0)).toBe(0)
  })

  it('stays on a row while its bottom edge is below the viewport top', () => {
    expect(findFirstVisible(layout.offsets, layout.heights, 99.5)).toBe(0)
  })

  it('moves past a row whose bottom edge is exactly at the top', () => {
    expect(findFirstVisible(layout.offsets, layout.heights, 100)).toBe(1)
  })

  it('maps positions inside the inter-row gap to the next row', () => {
    // row 0 ends at 100, row 1 starts at 116
    expect(findFirstVisible(layout.offsets, layout.heights, 108)).toBe(1)
  })

  it('returns the row count when scrolled past the end', () => {
    expect(findFirstVisible(layout.offsets, layout.heights, 10_000)).toBe(3)
  })

  it('returns 0 for an empty list', () => {
    expect(findFirstVisible([], [], 50)).toBe(0)
  })
})

describe('findVisibleRange', () => {
  const layout = layoutOf([100, 50, 30])

  it('renders only rows intersecting the viewport', () => {
    expect(findVisibleRange(layout, 0, 100, 0)).toEqual({ start: 0, end: 1 })
  })

  it('includes rows pulled in by overscan', () => {
    expect(findVisibleRange(layout, 0, 100, 20)).toEqual({ start: 0, end: 2 })
  })

  it('covers the tail when scrolled to the bottom', () => {
    expect(findVisibleRange(layout, 96, 100, 0)).toEqual({ start: 0, end: 3 })
  })

  it('renders a window of tail rows, not a single row', () => {
    // Regression guard: computing the pinned window from the list bottom must
    // still return every row intersecting the viewport.
    const tall = layoutOf(Array.from({ length: 100 }, () => 50), 10)
    const viewport = 500
    const range = findVisibleRange(tall, tall.total - viewport, viewport, 0)
    expect(range.end).toBe(100)
    expect(range.end - range.start).toBeGreaterThanOrEqual(9)
  })

  it('returns an empty range for an empty layout', () => {
    expect(findVisibleRange(buildLayout([], [], 16), 0, 800, 600)).toEqual({ start: 0, end: 0 })
  })
})

const textItem = (text: string): TextItem => ({
  kind: 'text',
  id: `text-${text.length}`,
  text,
  done: true
})

const thinkingItem = (done: boolean, id = 'think-1'): ThinkingItem => ({
  kind: 'thinking',
  id,
  text: '推敲'.repeat(200),
  done,
  startedAt: 0,
  durationMs: done ? 1200 : null
})

const toolItem = (id = 'tool-1'): ToolItem => ({
  kind: 'tool',
  id,
  toolUseId: 'use-1',
  name: 'Bash',
  input: { command: 'ls' },
  output: 'file-a\nfile-b',
  status: 'done',
  startedAt: 0,
  durationMs: 40
})

const permissionItem = (id = 'permission-1'): PermissionItem => ({
  kind: 'permission',
  id,
  requestId: 'req-1',
  toolName: 'Write',
  input: { file_path: 'a.txt' },
  suggestions: [],
  status: 'pending',
  at: 0
})

describe('estimateItemHeight', () => {
  it('grows with text length for markdown and user rows', () => {
    expect(estimateItemHeight(textItem('一二三四五六七八九十'.repeat(30)))).toBeGreaterThan(
      estimateItemHeight(textItem('短'))
    )
  })

  it('treats a finished thinking block as collapsed by default', () => {
    expect(estimateItemHeight(thinkingItem(true))).toBeLessThan(
      estimateItemHeight(thinkingItem(false))
    )
  })

  it('honours an explicit expansion for a finished thinking block', () => {
    const item = thinkingItem(true, 'think-open')
    setItemOpen(item.id, true)
    expect(estimateItemHeight(item)).toBeGreaterThan(100)
  })

  it('expands tool cards once opened', () => {
    const item = toolItem('tool-open')
    const closed = estimateItemHeight(item)
    setItemOpen(item.id, true)
    expect(estimateItemHeight(item)).toBeGreaterThan(closed)
  })

  it('uses the permission params toggle for permission height', () => {
    const item = permissionItem('permission-open')
    const closed = estimateItemHeight(item)
    setItemOpen(permissionParamsKey(item.id), true)
    expect(estimateItemHeight(item)).toBeGreaterThan(closed)
  })
})
