import { readFileSync, statSync } from 'node:fs'
import { isAbsolute, relative } from 'node:path'
import type { DiffMode, FileDiff } from '@shared/events'
import { type DiffBody, diffText, previewEdit, previewEdits } from './line-diff'

/** Tools whose result should render as a file diff. */
export const FILE_EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'MultiEdit', 'Write'])

const MAX_SNAPSHOT_BYTES = 512 * 1024

export interface TargetSnapshot {
  /** File content at tool-call time; null when unreadable, binary or too large. */
  before: string | null
  /** False when the path did not exist (i.e. the call creates the file). */
  existed: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' ? value : null
}

function looksBinary(text: string): boolean {
  return text.slice(0, 4096).includes('\u0000')
}

/**
 * Reads the target file before the tool runs. Called from the assistant
 * message handler, i.e. before the CLI executes the tool.
 */
export function snapshotTarget(input: unknown): TargetSnapshot | null {
  const record = asRecord(input)
  const filePath = record ? stringField(record, 'file_path') : null
  if (!filePath) return null

  try {
    const stats = statSync(filePath)
    if (!stats.isFile() || stats.size > MAX_SNAPSHOT_BYTES) {
      return { before: null, existed: true }
    }
    const text = readFileSync(filePath, 'utf8')
    if (looksBinary(text)) return { before: null, existed: true }
    return { before: text, existed: true }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return { before: null, existed: code !== 'ENOENT' }
  }
}

function displayPath(cwd: string, filePath: string): string {
  const absolute = filePath.replace(/\\/g, '/')
  if (!cwd) return absolute
  const rel = relative(cwd, filePath).replace(/\\/g, '/')
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel
  return absolute
}

function replaceEvery(text: string, search: string, replacement: string): string {
  if (!search) return text
  return text.split(search).join(replacement)
}

function applyEdit(
  text: string,
  edit: { oldText: string; newText: string; replaceAll: boolean }
): string {
  return edit.replaceAll
    ? replaceEvery(text, edit.oldText, edit.newText)
    : text.replace(edit.oldText, edit.newText)
}

function makeDiff(path: string, mode: DiffMode, body: DiffBody): FileDiff {
  return {
    path,
    mode,
    added: body.added,
    removed: body.removed,
    hunks: body.hunks,
    truncated: body.truncated
  }
}

interface ParsedEdit {
  oldText: string
  newText: string
  replaceAll: boolean
}

function parseEdit(value: unknown): ParsedEdit | null {
  const record = asRecord(value)
  if (!record) return null
  const oldText = stringField(record, 'old_string')
  const newText = stringField(record, 'new_string')
  if (oldText === null || newText === null) return null
  return { oldText, newText, replaceAll: record.replace_all === true }
}

function writeDiff(
  path: string,
  input: Record<string, unknown>,
  snapshot: TargetSnapshot | null
): FileDiff | null {
  const content = stringField(input, 'content')
  if (content === null) return null

  if (snapshot?.before != null) {
    return makeDiff(path, 'edit', diffText(snapshot.before, content))
  }
  if (snapshot && !snapshot.existed) {
    return makeDiff(path, 'create', diffText('', content))
  }
  // Previous content unknown: show the written text as an addition preview.
  return makeDiff(path, 'write', diffText('', content))
}

function editDiff(
  path: string,
  input: Record<string, unknown>,
  snapshot: TargetSnapshot | null
): FileDiff | null {
  const edit = parseEdit(input)
  if (!edit) return null

  if (snapshot?.before != null) {
    const after = applyEdit(snapshot.before, edit)
    if (after !== snapshot.before) {
      return makeDiff(path, 'edit', diffText(snapshot.before, after))
    }
  }
  return makeDiff(path, 'edit', previewEdit(edit.oldText, edit.newText))
}

function multiEditDiff(
  path: string,
  input: Record<string, unknown>,
  snapshot: TargetSnapshot | null
): FileDiff | null {
  const rawEdits = Array.isArray(input.edits) ? input.edits : []
  const edits: ParsedEdit[] = []
  for (const value of rawEdits) {
    const parsed = parseEdit(value)
    if (parsed) edits.push(parsed)
  }
  if (edits.length === 0) return null

  if (snapshot?.before != null) {
    let current = snapshot.before
    for (const edit of edits) current = applyEdit(current, edit)
    if (current !== snapshot.before) {
      return makeDiff(path, 'edit', diffText(snapshot.before, current))
    }
  }
  return makeDiff(path, 'edit', previewEdits(edits))
}

/**
 * Builds the diff for a successful edit tool call. `snapshot` is what was read
 * at tool-call time; null when the tool does not edit files.
 */
export function buildFileDiff(
  name: string,
  input: unknown,
  snapshot: TargetSnapshot | null,
  cwd: string
): FileDiff | null {
  const record = asRecord(input)
  const filePath = record ? stringField(record, 'file_path') : null
  if (!record || !filePath) return null
  const path = displayPath(cwd, filePath)

  switch (name) {
    case 'Write':
      return writeDiff(path, record, snapshot)
    case 'Edit':
      return editDiff(path, record, snapshot)
    case 'MultiEdit':
      return multiEditDiff(path, record, snapshot)
    default:
      return null
  }
}
