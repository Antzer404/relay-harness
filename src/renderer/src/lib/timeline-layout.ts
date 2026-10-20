import type { TimelineItem } from '@shared/timeline'
import { getGroupOpen, getItemOpen, permissionParamsKey } from './item-open-state'
import { isProcessRow, type ProcessGroupItem, type TimelineRow } from './timeline-groups'

/**
 * Pure geometry helpers behind the virtual timeline. Everything here is
 * deterministic and DOM-free so it can be covered by unit tests; measuring
 * real heights is the job of `useVirtualTimeline`.
 */

export interface TimelineLayout {
  /** Item id per row, in order. */
  ids: string[]
  /** Top offset of each row, in content pixels. */
  offsets: number[]
  /** Row heights, excluding the gap to the next row. */
  heights: number[]
  /** Height of the whole list (sum of heights and gaps). */
  total: number
}

export function buildLayout(ids: string[], heights: number[], gap: number): TimelineLayout {
  const offsets = new Array<number>(heights.length)
  let y = 0
  for (let index = 0; index < heights.length; index += 1) {
    offsets[index] = y
    y += (heights[index] ?? 0) + (index < heights.length - 1 ? gap : 0)
  }
  return { ids, offsets, heights, total: y }
}

/** Index of the first row whose bottom edge is below `scrollTop`. */
export function findFirstVisible(
  offsets: number[],
  heights: number[],
  scrollTop: number
): number {
  let low = 0
  let high = heights.length
  while (low < high) {
    const mid = (low + high) >> 1
    const bottom = (offsets[mid] ?? 0) + (heights[mid] ?? 0)
    if (bottom <= scrollTop) low = mid + 1
    else high = mid
  }
  return low
}

export interface VisibleRange {
  start: number
  /** Exclusive. */
  end: number
}

/** Rows intersecting the viewport, padded by `overscan` pixels on both ends. */
export function findVisibleRange(
  layout: TimelineLayout,
  scrollTop: number,
  viewport: number,
  overscan: number
): VisibleRange {
  const count = layout.heights.length
  if (count === 0) return { start: 0, end: 0 }

  const top = Math.max(0, scrollTop - overscan)
  const bottom = scrollTop + Math.max(0, viewport) + overscan

  const start = findFirstVisible(layout.offsets, layout.heights, top)
  let end = start
  while (end < count && (layout.offsets[end] ?? 0) < bottom) end += 1
  return { start, end }
}

/** Whether the row is currently expanded (affects its height estimate). */
export function isItemOpen(item: TimelineItem): boolean {
  switch (item.kind) {
    case 'thinking':
      return getItemOpen(item.id) ?? !item.done
    case 'tool':
      return getItemOpen(item.id) ?? false
    case 'permission':
      return getItemOpen(permissionParamsKey(item.id)) ?? false
    default:
      return false
  }
}

const TEXT_LINE = 25

/** Whether the group row is expanded; running groups stay open by default. */
export function isGroupOpen(group: ProcessGroupItem): boolean {
  return getGroupOpen(group.id) ?? group.status === 'running'
}

/** Wrapped line count for a block of text at roughly `perLine` characters. */
function textLines(text: string, perLine: number): number {
  if (!text) return 1
  let lines = 0
  for (const part of text.split('\n')) {
    lines += Math.max(1, Math.ceil(part.length / perLine))
  }
  return lines
}

/**
 * Rough height used until a row has been mounted and measured. Estimates only
 * need to be close enough to keep the scrollbar sane in unmeasured regions;
 * ResizeObserver replaces them with real heights on first paint.
 */
export function estimateItemHeight(item: TimelineItem): number {
  switch (item.kind) {
    case 'user':
      return 22 + textLines(item.text, 44) * 23
    case 'text':
      return Math.max(24, textLines(item.text, 64) * TEXT_LINE + 4)
    case 'thinking': {
      if (!isItemOpen(item)) return 34
      const body = Math.min(textLines(item.text, 96) * 22, 320)
      return 34 + body + 18
    }
    case 'tool': {
      if (!isItemOpen(item)) return 41
      const output = item.output ? Math.min(textLines(item.output, 80) * 19, 300) : 24
      const input = item.diff ? 160 : Math.min(textLines(JSON.stringify(item.input ?? ''), 72) * 19, 300)
      return 41 + 22 + input + output + 34
    }
    case 'permission':
      return isItemOpen(item) ? 430 : 196
    case 'error':
      return 88
    case 'notice':
      return 30
    default:
      return 72
  }
}

const GROUP_HEADER = 46

/** Height estimate for a grouped process row (header plus expanded details). */
export function estimateRowHeight(row: TimelineRow): number {
  if (!isProcessRow(row)) return estimateItemHeight(row)
  if (!isGroupOpen(row)) return GROUP_HEADER
  let total = GROUP_HEADER + 10
  for (const item of row.items) total += estimateItemHeight(item) + 8
  return total
}
