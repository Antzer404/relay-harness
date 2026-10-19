import type { DiffHunk, DiffLine } from '@shared/events'

/**
 * Line diff used for tool result cards. Pure string -> hunk computation so it
 * can be tested without Electron and runs identically on replay.
 */

const MAX_MIDDLE_LINES = 1600
const MAX_FILE_LINES = 6000
export const MAX_RENDER_LINES = 800
const MAX_LINE_CHARS = 400
const CONTEXT_LINES = 3

export interface DiffBody {
  hunks: DiffHunk[]
  added: number
  removed: number
  truncated: boolean
}

type EditOp =
  | { type: 'equal'; aIndex: number; bIndex: number }
  | { type: 'del'; aIndex: number }
  | { type: 'add'; bIndex: number }

export function splitLines(text: string): string[] {
  if (!text) return []
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
}

function clipLine(text: string): string {
  if (text.length <= MAX_LINE_CHARS) return text
  return `${text.slice(0, MAX_LINE_CHARS)}…`
}

function line(kind: DiffLine['kind'], text: string, oldNo: number | null, newNo: number | null): DiffLine {
  return { kind, text: clipLine(text), oldNo, newNo }
}

/**
 * Myers O(ND) diff over line arrays. Returns null when the changed region is
 * too large to be worth diffing; callers then report a truncated diff.
 */
function myers(a: string[], b: string[]): EditOp[] | null {
  const n = a.length
  const m = b.length
  if (n === 0) return b.map((_, index) => ({ type: 'add', bIndex: index }))
  if (m === 0) return a.map((_, index) => ({ type: 'del', aIndex: index }))
  if (n + m > MAX_MIDDLE_LINES) return null

  const max = n + m
  const offset = max
  const v = new Int32Array(2 * max + 1)
  const trace: Int32Array[] = []
  let solved = false

  for (let d = 0; d <= max && !solved; d += 1) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x: number
      if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) {
        x = v[offset + k + 1]!
      } else {
        x = v[offset + k - 1]! + 1
      }
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x += 1
        y += 1
      }
      v[offset + k] = x
      if (x >= n && y >= m) {
        solved = true
        break
      }
    }
  }
  if (!solved) return null

  let x = n
  let y = m
  const ops: EditOp[] = []
  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const step = trace[d]!
    const k = x - y
    let prevK: number
    if (k === -d || (k !== d && step[offset + k - 1]! < step[offset + k + 1]!)) {
      prevK = k + 1
    } else {
      prevK = k - 1
    }
    const prevX = step[offset + prevK]!
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      x -= 1
      y -= 1
      ops.push({ type: 'equal', aIndex: x, bIndex: y })
    }
    if (d > 0) {
      if (x === prevX) {
        y -= 1
        ops.push({ type: 'add', bIndex: y })
      } else {
        x -= 1
        ops.push({ type: 'del', aIndex: x })
      }
    }
  }
  ops.reverse()
  return ops
}

function groupHunks(raw: DiffLine[], added: number, removed: number): DiffBody {
  const changeIndexes: number[] = []
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index]!.kind !== 'context') changeIndexes.push(index)
  }
  if (changeIndexes.length === 0) {
    return { hunks: [], added, removed, truncated: false }
  }

  const ranges: Array<[number, number]> = []
  let first = changeIndexes[0]!
  let last = first
  for (const index of changeIndexes.slice(1)) {
    // Merge changes separated by at most 2 * context lines of equal text.
    if (index - last <= CONTEXT_LINES * 2 + 1) {
      last = index
    } else {
      ranges.push([first, last])
      first = index
      last = index
    }
  }
  ranges.push([first, last])

  const hunks: DiffHunk[] = []
  let rendered = 0
  let truncated = false
  for (const [rangeFirst, rangeLast] of ranges) {
    const start = Math.max(0, rangeFirst - CONTEXT_LINES)
    const end = Math.min(raw.length, rangeLast + CONTEXT_LINES + 1)
    const lines = raw.slice(start, end)
    if (rendered + lines.length > MAX_RENDER_LINES) {
      truncated = true
      break
    }
    rendered += lines.length
    hunks.push({ lines })
  }
  return { hunks, added, removed, truncated }
}

/** Full line diff between two known texts. */
export function diffText(before: string, after: string): DiffBody {
  if (before === after) return { hunks: [], added: 0, removed: 0, truncated: false }

  const a = splitLines(before)
  const b = splitLines(after)
  if (a.length > MAX_FILE_LINES || b.length > MAX_FILE_LINES) {
    return { hunks: [], added: 0, removed: 0, truncated: true }
  }

  // Trim the unchanged prefix and suffix so Myers only sees the changed region.
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1
  let endA = a.length
  let endB = b.length
  while (endA > prefix && endB > prefix && a[endA - 1] === b[endB - 1]) {
    endA -= 1
    endB -= 1
  }

  const ops = myers(a.slice(prefix, endA), b.slice(prefix, endB))
  if (!ops) return { hunks: [], added: 0, removed: 0, truncated: true }

  const raw: DiffLine[] = []
  for (let index = 0; index < prefix; index += 1) {
    raw.push(line('context', a[index]!, index + 1, index + 1))
  }

  let oldNo = prefix + 1
  let newNo = prefix + 1
  let added = 0
  let removed = 0
  for (const op of ops) {
    if (op.type === 'equal') {
      raw.push(line('context', a[prefix + op.aIndex]!, oldNo, newNo))
      oldNo += 1
      newNo += 1
    } else if (op.type === 'del') {
      raw.push(line('del', a[prefix + op.aIndex]!, oldNo, null))
      oldNo += 1
      removed += 1
    } else {
      raw.push(line('add', b[prefix + op.bIndex]!, null, newNo))
      newNo += 1
      added += 1
    }
  }

  for (let index = endA; index < a.length; index += 1) {
    const newIndex = endB + (index - endA)
    raw.push(line('context', a[index]!, index + 1, newIndex + 1))
  }

  return groupHunks(raw, added, removed)
}

/**
 * Fallback used when the previous file content is unavailable: show the exact
 * old/new strings from the tool input without line numbers or context.
 */
export function previewEdit(oldText: string, newText: string): DiffBody {
  const before = splitLines(oldText)
  const after = splitLines(newText)
  const lines: DiffLine[] = []
  let truncated = false

  const chars = oldText.length + newText.length
  if (before.length + after.length > MAX_RENDER_LINES || chars > MAX_LINE_CHARS * MAX_RENDER_LINES) {
    truncated = true
  }
  const delta = Math.max(0, MAX_RENDER_LINES - after.length)
  for (const text of before.slice(0, delta)) lines.push(line('del', text, null, null))
  for (const text of after.slice(0, MAX_RENDER_LINES)) lines.push(line('add', text, null, null))

  return {
    hunks: lines.length > 0 ? [{ lines }] : [],
    added: after.length,
    removed: before.length,
    truncated
  }
}

/** Aggregate hunks for several edits (MultiEdit fallback). */
export function previewEdits(edits: Array<{ oldText: string; newText: string }>): DiffBody {
  const hunks: DiffHunk[] = []
  let added = 0
  let removed = 0
  let truncated = false
  let rendered = 0

  for (const edit of edits) {
    const body = previewEdit(edit.oldText, edit.newText)
    added += body.added
    removed += body.removed
    truncated ||= body.truncated
    for (const hunk of body.hunks) {
      if (rendered + hunk.lines.length > MAX_RENDER_LINES) {
        truncated = true
        break
      }
      rendered += hunk.lines.length
      hunks.push(hunk)
    }
  }
  return { hunks, added, removed, truncated }
}
