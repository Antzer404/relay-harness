import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Skills shipped with the app. They are copied into the CLI's user skills
 * folder on startup so discovery, the settings list and `skillOverrides`
 * all work exactly like a hand-installed skill.
 *
 * Updates only touch copies the user has not edited: the manifest records the
 * hash of the last installed version, and a hash mismatch means the folder was
 * changed locally and must be preserved.
 */

/** Marks a skill folder as installed by Relay (and therefore upgradable). */
export const BUILTIN_MARKER = '.relay-builtin'
export const BUILTIN_MANIFEST = 'builtin-skills.json'

const MANIFEST_VERSION = 1

interface BuiltinManifest {
  version: number
  skills: Record<string, string>
}

export interface InstallBuiltinSkillsOptions {
  /** Bundled `resources/builtin-skills` (or `resources/builtin-skills` on disk). */
  sourceDir: string
  /** The CLI's user skills folder (`CLAUDE_CONFIG_DIR/skills`). */
  targetDir: string
  /** `userData/builtin-skills.json`. */
  manifestPath: string
  log?: (message: string) => void
}

export interface InstallBuiltinSkillsResult {
  installed: string[]
  updated: string[]
  /** User-owned or user-edited copies that were left untouched. */
  skipped: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readManifest(path: string): BuiltinManifest {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!isRecord(raw) || !isRecord(raw.skills)) {
      return { version: MANIFEST_VERSION, skills: {} }
    }
    const skills: Record<string, string> = {}
    for (const [name, hash] of Object.entries(raw.skills)) {
      if (typeof hash === 'string' && hash) skills[name] = hash
    }
    return { version: MANIFEST_VERSION, skills }
  } catch {
    return { version: MANIFEST_VERSION, skills: {} }
  }
}

function writeManifest(path: string, manifest: BuiltinManifest): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

function collectFiles(dir: string, base: string, files: string[]): void {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name === BUILTIN_MARKER) continue
    if (entry.isSymbolicLink()) continue
    const full = join(dir, entry.name)
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) collectFiles(full, rel, files)
    else if (entry.isFile()) files.push(rel)
  }
}

/**
 * Content hash of a skill folder (relative paths + bytes), ignoring the
 * install marker. Used to tell "still the version we installed" from
 * "the user edited it".
 */
export function hashDirectory(dir: string): string {
  const files: string[] = []
  collectFiles(dir, '', files)
  files.sort()
  const hash = createHash('sha1')
  for (const rel of files) {
    hash.update(rel)
    hash.update('\0')
    try {
      hash.update(readFileSync(join(dir, rel)))
    } catch {
      hash.update('\0unreadable')
    }
    hash.update('\0')
  }
  return hash.digest('hex')
}

function copySkill(source: string, target: string, name: string): void {
  rmSync(target, { recursive: true, force: true })
  cpSync(source, target, { recursive: true })
  writeFileSync(
    join(target, BUILTIN_MARKER),
    `${JSON.stringify({ builtin: true, name })}\n`,
    'utf8'
  )
}

/**
 * Installs or upgrades the bundled skills. Missing folders are recreated;
 * folders whose content no longer matches the recorded hash are treated as
 * user-owned and left alone.
 */
export function installBuiltinSkills(
  options: InstallBuiltinSkillsOptions
): InstallBuiltinSkillsResult {
  const result: InstallBuiltinSkillsResult = { installed: [], updated: [], skipped: [] }
  if (!existsSync(options.sourceDir)) return result

  let entries
  try {
    entries = readdirSync(options.sourceDir, { withFileTypes: true })
  } catch {
    return result
  }

  mkdirSync(options.targetDir, { recursive: true })
  const manifest = readManifest(options.manifestPath)
  let changed = false

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const name = entry.name
    const source = join(options.sourceDir, name)
    const target = join(options.targetDir, name)
    const sourceHash = hashDirectory(source)

    if (!existsSync(target)) {
      copySkill(source, target, name)
      manifest.skills[name] = sourceHash
      result.installed.push(name)
      changed = true
      continue
    }

    const recorded = manifest.skills[name]
    // A folder without a manifest entry belongs to the user (created before
    // the built-in ever existed, or by a previous install that never recorded
    // it); never overwrite it.
    if (recorded === undefined) {
      result.skipped.push(name)
      continue
    }
    if (hashDirectory(target) !== recorded) {
      // The user edited this skill; future updates leave it alone.
      result.skipped.push(name)
      continue
    }
    if (recorded === sourceHash) continue

    copySkill(source, target, name)
    manifest.skills[name] = sourceHash
    result.updated.push(name)
    changed = true
  }

  if (changed) {
    try {
      writeManifest(options.manifestPath, manifest)
    } catch (error) {
      options.log?.(`写入内置技能清单失败：${String(error)}`)
    }
  }
  return result
}

/** Where the bundled skills live in dev and in a packaged app. */
export function builtinSkillsSourceDir(options: {
  isPackaged: boolean
  appPath: string
  resourcesPath: string
}): string {
  return options.isPackaged
    ? join(options.resourcesPath, 'builtin-skills')
    : join(options.appPath, 'resources', 'builtin-skills')
}
