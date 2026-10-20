import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { SkillInfo, SkillListInfo, SkillScope } from '@shared/events'
import { BUILTIN_MARKER } from './builtin-skills'

/**
 * Skills are plain folders with a SKILL.md at their root. Relay reads them
 * only to show a list and to translate the user's on/off choices into the
 * CLI's `skillOverrides` setting; the CLI itself does the discovery.
 */

/** The CLI refuses to load skill files above 1 MB. */
const MAX_SKILL_BYTES = 1024 * 1024
const MAX_SKILLS = 300
const MAX_DESCRIPTION = 400

/** Keys that must never become object properties of `skillOverrides`. */
const RESERVED_SKILL_NAMES = new Set(['__proto__', 'constructor', 'prototype'])

export interface SkillFrontmatter {
  name: string | null
  description: string | null
  /** Markdown after the closing `---`, trimmed. */
  body: string
}

function clip(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > MAX_DESCRIPTION ? `${line.slice(0, MAX_DESCRIPTION)}…` : line
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length < 2) return trimmed
  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  if (first !== last || (first !== '"' && first !== "'")) return trimmed
  const inner = trimmed.slice(1, -1)
  if (first === '"') {
    return inner
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\\\/g, '\\')
      .trim()
  }
  return inner.replace(/''/g, "'").trim()
}

/** First useful line of the body, used when the frontmatter has no description. */
export function fallbackDescription(body: string): string {
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (
      line.startsWith('#') ||
      line.startsWith('```') ||
      line.startsWith('---') ||
      line.startsWith('|') ||
      line.startsWith('![')
    ) {
      continue
    }
    const cleaned = line.replace(/^[-*+>]\s*/, '').replace(/[*_`]/g, '').trim()
    if (cleaned) return clip(cleaned)
  }
  return ''
}

/**
 * Minimal YAML frontmatter reader: only `name` and `description` matter, and
 * skill files in the wild use plain scalars, quotes, or block scalars.
 */
export function parseSkillMarkdown(markdown: string): SkillFrontmatter {
  const text = markdown.replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  if (lines[0]?.trim() !== '---') {
    const body = text.trim()
    return { name: null, description: fallbackDescription(body) || null, body }
  }

  const values: Record<string, string> = {}
  let closing = -1
  let index = 1
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim() === '---') {
      closing = index
      break
    }
    const match = /^([A-Za-z0-9_.-]+):(.*)$/.exec(line)
    if (match) {
      const key = match[1] ?? ''
      const value = (match[2] ?? '').trim()
      if (/^[>|][+-]?$/.test(value)) {
        const folded = value.startsWith('>')
        const collected: string[] = []
        index += 1
        while (index < lines.length) {
          const next = lines[index] ?? ''
          if (next.trim() !== '' && !next.startsWith(' ')) break
          if (next.trim() === '---') break
          collected.push(next.trim())
          index += 1
        }
        values[key] = folded ? collected.filter(Boolean).join(' ') : collected.join('\n').trim()
        continue
      }
      values[key] = unquote(value)
    }
    index += 1
  }

  if (closing === -1) {
    // A broken frontmatter block: treat the whole file as the body.
    return { name: null, description: null, body: text.trim() }
  }

  const body = lines.slice(closing + 1).join('\n').trim()
  const name = values.name?.trim() || null
  const description = values.description?.trim() || fallbackDescription(body) || null
  return { name, description, body }
}

/** Skills directly under `root` (`<root>/<name>/SKILL.md`); missing roots are empty. */
export function scanSkillRoot(root: string, scope: SkillScope): SkillInfo[] {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }

  const skills: SkillInfo[] = []
  for (const entry of entries) {
    if (skills.length >= MAX_SKILLS) break
    // Symlinks are skipped on purpose: the CLI does not follow them either.
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const file = join(root, entry.name, 'SKILL.md')
    try {
      const stat = statSync(file)
      if (!stat.isFile() || stat.size > MAX_SKILL_BYTES) continue
    } catch {
      continue
    }
    let markdown: string
    try {
      markdown = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const parsed = parseSkillMarkdown(markdown)
    skills.push({
      name: entry.name,
      title: parsed.name && parsed.name !== entry.name ? parsed.name : null,
      description: parsed.description ?? '',
      scope,
      builtin: scope === 'global' && existsSync(join(root, entry.name, BUILTIN_MARKER)),
      path: file,
      enabled: true
    })
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

export interface CollectSkillsInput {
  globalDir: string
  workspaceDir: string
  /** App-wide disabled names; matched against the folder name. */
  disabled: readonly string[]
}

/** Workspace skills come first so project context reads before global ones. */
export function collectSkillList(input: CollectSkillsInput): SkillListInfo {
  const disabled = new Set(input.disabled)
  const skills = [
    ...scanSkillRoot(input.workspaceDir, 'workspace'),
    ...scanSkillRoot(input.globalDir, 'global')
  ].map((skill) => ({ ...skill, enabled: !disabled.has(skill.name) }))
  return {
    globalDir: input.globalDir,
    workspaceDir: input.workspaceDir,
    skills
  }
}

/**
 * Cleans a persisted disabled-name list: trims, drops reserved names and
 * duplicates, caps the size, and ignores non-strings.
 */
export function normalizeDisabledSkills(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const seen = new Set<string>()
  const names: string[] = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const name = value.trim()
    if (!name || name.length > 200) continue
    if (RESERVED_SKILL_NAMES.has(name)) continue
    if (seen.has(name)) continue
    seen.add(name)
    names.push(name)
    if (names.length >= MAX_SKILLS) break
  }
  return names
}

/** The CLI's `skillOverrides` value for a disabled-name list. */
export function buildSkillOverrides(disabled: readonly string[]): Record<string, 'off'> {
  const overrides: Record<string, 'off'> = Object.create(null) as Record<string, 'off'>
  for (const name of disabled) {
    if (!name || RESERVED_SKILL_NAMES.has(name)) continue
    overrides[name] = 'off'
  }
  return overrides
}
