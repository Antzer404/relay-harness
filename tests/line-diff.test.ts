import { describe, expect, it } from 'vitest'
import { diffText, previewEdit } from '../src/main/runtime/line-diff'

describe('diffText', () => {
  it('returns no hunks for identical text', () => {
    const result = diffText('a\nb\nc\n', 'a\nb\nc\n')
    expect(result.hunks).toEqual([])
    expect(result.added).toBe(0)
    expect(result.removed).toBe(0)
  })

  it('builds a hunk with line numbers and counts for a single replacement', () => {
    const before = 'l1\nl2\nl3\nl4\nl5\nl6\nl7\n'
    const after = 'l1\nl2\nl3\nl4b\nl5\nl6\nl7\n'
    const result = diffText(before, after)

    expect(result.added).toBe(1)
    expect(result.removed).toBe(1)
    expect(result.truncated).toBe(false)
    expect(result.hunks).toHaveLength(1)

    const lines = result.hunks[0]!.lines
    expect(lines.map((line) => `${line.kind}:${line.text}`)).toEqual([
      'context:l1',
      'context:l2',
      'context:l3',
      'del:l4',
      'add:l4b',
      'context:l5',
      'context:l6',
      'context:l7'
    ])

    const deleted = lines.find((line) => line.kind === 'del')
    expect(deleted).toMatchObject({ oldNo: 4, newNo: null })
    const added = lines.find((line) => line.kind === 'add')
    expect(added).toMatchObject({ oldNo: null, newNo: 4 })
  })

  it('keeps distant changes in separate hunks', () => {
    const before = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n')
    const after = before
      .replace('line 2', 'line 2 changed')
      .replace('line 19', 'line 19 changed')
    const result = diffText(before, after)

    expect(result.hunks).toHaveLength(2)
    expect(result.added).toBe(2)
    expect(result.removed).toBe(2)
  })

  it('handles CRLF input without emitting carriage returns in the UI', () => {
    const result = diffText('a\r\nb\r\nc\r\n', 'a\r\nz\r\nc\r\n')
    const texts = result.hunks[0]!.lines.map((line) => line.text)
    expect(texts).toEqual(['a', 'b', 'z', 'c'])
  })

  it('marks oversized files as truncated instead of diffing them', () => {
    const large = Array.from({ length: 6001 }, (_, index) => `line ${index}`).join('\n')
    const changed = `${large}\nextra`
    const result = diffText(large, changed)
    expect(result.truncated).toBe(true)
    expect(result.hunks).toEqual([])
  })
})

describe('previewEdit', () => {
  it('shows the raw old/new strings without line numbers', () => {
    const result = previewEdit('x\ny\n', 'x\nz\n')
    expect(result.added).toBe(2)
    expect(result.removed).toBe(2)
    expect(result.hunks).toHaveLength(1)
    expect(result.hunks[0]!.lines.map((line) => [line.kind, line.text, line.oldNo, line.newNo])).toEqual([
      ['del', 'x', null, null],
      ['del', 'y', null, null],
      ['add', 'x', null, null],
      ['add', 'z', null, null]
    ])
  })
})

function naiveCounts(a: string[], b: string[]): { added: number; removed: number } {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  )
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      table[i]![j]! = a[i - 1] === b[j - 1]
        ? table[i - 1]![j - 1]! + 1
        : Math.max(table[i - 1]![j]!, table[i]![j - 1]!)
    }
  }
  const lcs = table[a.length]![b.length]!
  return { added: b.length - lcs, removed: a.length - lcs }
}

describe('diffText counts', () => {
  it('matches an LCS reference on randomized line edits', () => {
    let seed = 42
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    for (let round = 0; round < 200; round += 1) {
      const length = 1 + Math.floor(random() * 24)
      const before = Array.from({ length }, () => String(Math.floor(random() * 8)))
      const after = before
        .filter(() => random() > 0.2)
        .map((line) => (random() > 0.8 ? String(Math.floor(random() * 8)) : line))
      for (let insert = 0; insert < Math.floor(random() * 5); insert += 1) {
        after.splice(Math.floor(random() * (after.length + 1)), 0, String(Math.floor(random() * 8)))
      }

      const result = diffText(before.join('\n'), after.join('\n'))
      const expected = naiveCounts(before, after)
      expect({ added: result.added, removed: result.removed }).toEqual(expected)
    }
  })
})
