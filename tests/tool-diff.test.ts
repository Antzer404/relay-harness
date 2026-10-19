import { afterAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildFileDiff, snapshotTarget } from '../src/main/runtime/tool-diff'

const base = join(process.cwd(), '.smoke-tmp')
mkdirSync(base, { recursive: true })
const dir = mkdtempSync(join(base, 'tool-diff-'))

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  } catch {
    // The connected-folder mount in the Linux sandbox may refuse deletes.
  }
})

function writeFixture(name: string, content: string): string {
  const file = join(dir, name)
  writeFileSync(file, content, 'utf8')
  return file
}

describe('snapshotTarget', () => {
  it('reads the existing file before an edit', () => {
    const file = writeFixture('snap.ts', 'export const a = 1\n')
    expect(snapshotTarget({ file_path: file })).toEqual({
      before: 'export const a = 1\n',
      existed: true
    })
  })

  it('reports a missing file as a create', () => {
    const file = join(dir, 'missing.ts')
    expect(snapshotTarget({ file_path: file })).toEqual({ before: null, existed: false })
  })

  it('ignores inputs without a file path', () => {
    expect(snapshotTarget({ command: 'ls' })).toBeNull()
  })
})

describe('buildFileDiff', () => {
  it('diffs an Edit against the snapshot with context and line numbers', () => {
    const file = writeFixture('edit.ts', 'const a = 1\nconst b = 2\nconst c = 3\n')
    const snapshot = snapshotTarget({ file_path: file })
    const diff = buildFileDiff(
      'Edit',
      { file_path: file, old_string: 'const b = 2', new_string: 'const b = 42' },
      snapshot,
      dir
    )

    expect(diff).not.toBeNull()
    expect(diff).toMatchObject({ path: 'edit.ts', mode: 'edit', added: 1, removed: 1 })
    const kinds = diff!.hunks[0]!.lines.map((line) => line.kind)
    expect(kinds).toEqual(['context', 'del', 'add', 'context'])
    const added = diff!.hunks[0]!.lines.find((line) => line.kind === 'add')
    expect(added).toMatchObject({ text: 'const b = 42', newNo: 2 })
  })

  it('applies replace_all edits before diffing', () => {
    const file = writeFixture('all.ts', 'foo\nbar\nfoo\n')
    const snapshot = snapshotTarget({ file_path: file })
    const diff = buildFileDiff(
      'Edit',
      { file_path: file, old_string: 'foo', new_string: 'baz', replace_all: true },
      snapshot,
      dir
    )
    expect(diff).toMatchObject({ mode: 'edit', added: 2, removed: 2 })
  })

  it('marks a Write to a missing file as create with numbered additions', () => {
    const file = join(dir, 'new.ts')
    const snapshot = snapshotTarget({ file_path: file })
    const diff = buildFileDiff(
      'Write',
      { file_path: file, content: 'line one\nline two\n' },
      snapshot,
      dir
    )

    expect(diff).toMatchObject({ path: 'new.ts', mode: 'create', added: 2, removed: 0 })
    expect(diff!.hunks[0]!.lines.map((line) => line.newNo)).toEqual([1, 2])
  })

  it('diffs a Write over an existing file', () => {
    const file = writeFixture('over.ts', 'old\nkeep\n')
    const snapshot = snapshotTarget({ file_path: file })
    const diff = buildFileDiff(
      'Write',
      { file_path: file, content: 'new\nkeep\n' },
      snapshot,
      dir
    )
    expect(diff).toMatchObject({ mode: 'edit', added: 1, removed: 1 })
  })

  it('applies MultiEdit edits in order', () => {
    const file = writeFixture('multi.ts', 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n')
    const snapshot = snapshotTarget({ file_path: file })
    const diff = buildFileDiff(
      'MultiEdit',
      {
        file_path: file,
        edits: [
          { old_string: 'a', new_string: 'A' },
          { old_string: 'j', new_string: 'J' }
        ]
      },
      snapshot,
      dir
    )
    expect(diff).toMatchObject({ mode: 'edit', added: 2, removed: 2 })
    expect(diff!.hunks).toHaveLength(2)
  })

  it('falls back to the raw input preview when no snapshot is available', () => {
    const diff = buildFileDiff(
      'Edit',
      { file_path: join(dir, 'unknown.ts'), old_string: 'old()', new_string: 'next()' },
      null,
      dir
    )
    expect(diff).toMatchObject({ mode: 'edit', added: 1, removed: 1 })
    expect(diff!.hunks[0]!.lines.every((line) => line.oldNo === null && line.newNo === null)).toBe(true)
  })
})
