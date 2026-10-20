import type { ThinkingItem, TimelineItem, ToolItem } from '@shared/timeline'

/**
 * Consecutive thinking/tool rows are folded into one collapsible "process"
 * row. A long agent turn produces dozens of those rows; collapsing them keeps
 * every user message within a screen of the previous one when scrolling back.
 */
export interface ProcessGroupItem {
  kind: 'group'
  /** Stable across updates: the id of the first item in the run. */
  id: string
  items: Array<ThinkingItem | ToolItem>
  startedAt: number
  /** Null while anything in the group is still running. */
  endedAt: number | null
  status: 'running' | 'done' | 'error'
}

export type TimelineRow = TimelineItem | ProcessGroupItem

type ProcessItem = ThinkingItem | ToolItem

export function isProcessRow(row: TimelineRow): row is ProcessGroupItem {
  return row.kind === 'group'
}

function isProcessItem(item: TimelineItem): item is ProcessItem {
  return item.kind === 'thinking' || item.kind === 'tool'
}

function itemEnd(item: ProcessItem): number | null {
  if (item.kind === 'thinking') {
    if (!item.done) return null
    return item.startedAt + (item.durationMs ?? 0)
  }
  if (item.status === 'running') return null
  return item.startedAt + (item.durationMs ?? 0)
}

function makeGroup(items: ProcessItem[]): ProcessGroupItem {
  const first = items[0]
  const startedAt = Math.min(...items.map((item) => item.startedAt))
  let endedAt: number | null = 0
  let running = false
  let failed = false
  for (const item of items) {
    const end = itemEnd(item)
    if (end === null) {
      running = true
      continue
    }
    if (endedAt !== null && end > endedAt) endedAt = end
    if (item.kind === 'tool' && item.status === 'error') failed = true
  }
  const status: ProcessGroupItem['status'] = running ? 'running' : failed ? 'error' : 'done'
  if (running) endedAt = null
  return {
    kind: 'group',
    id: `group:${first?.id ?? 'empty'}`,
    items,
    startedAt: Number.isFinite(startedAt) ? startedAt : 0,
    endedAt,
    status
  }
}

/** Folds runs of two or more consecutive process items into group rows. */
export function groupTimeline(items: TimelineItem[]): TimelineRow[] {
  const rows: TimelineRow[] = []
  let run: ProcessItem[] = []

  const flush = (): void => {
    if (run.length === 0) return
    if (run.length === 1) rows.push(run[0] as TimelineItem)
    else rows.push(makeGroup(run))
    run = []
  }

  for (const item of items) {
    if (isProcessItem(item)) {
      run.push(item)
      continue
    }
    flush()
    rows.push(item)
  }
  flush()
  return rows
}
