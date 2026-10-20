import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BUILTIN_MANIFEST,
  BUILTIN_MARKER,
  hashDirectory,
  installBuiltinSkills
} from '../src/main/services/builtin-skills'
import { parseSkillMarkdown } from '../src/main/services/skills-service'

const dirs: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'relay-builtin-'))
  dirs.push(dir)
  return dir
}

function writeSkill(root: string, name: string, content: string): void {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), content, 'utf8')
}

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

function setup(): {
  sourceDir: string
  targetDir: string
  manifestPath: string
} {
  const root = makeDir()
  const sourceDir = join(root, 'source')
  const targetDir = join(root, 'skills')
  mkdirSync(sourceDir, { recursive: true })
  return { sourceDir, targetDir, manifestPath: join(root, BUILTIN_MANIFEST) }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('installBuiltinSkills', () => {
  it('installs every bundled skill once and records hashes', () => {
    const { sourceDir, targetDir, manifestPath } = setup()
    writeSkill(sourceDir, 'code-review', '---\nname: code-review\ndescription: review\n---\nBody')
    writeSkill(sourceDir, 'repo-tour', '---\ndescription: tour\n---\nSteps')
    mkdirSync(join(sourceDir, 'repo-tour', 'templates'), { recursive: true })
    writeFileSync(join(sourceDir, 'repo-tour', 'templates', 'outline.md'), 'outline')

    const first = installBuiltinSkills({ sourceDir, targetDir, manifestPath })
    expect(first.installed.sort()).toEqual(['code-review', 'repo-tour'])
    expect(first.updated).toEqual([])
    expect(first.skipped).toEqual([])
    expect(read(join(targetDir, 'code-review', 'SKILL.md'))).toContain('description: review')
    expect(read(join(targetDir, 'repo-tour', 'templates', 'outline.md'))).toBe('outline')
    expect(existsSync(join(targetDir, 'code-review', BUILTIN_MARKER))).toBe(true)

    const manifest = JSON.parse(read(manifestPath)) as { skills: Record<string, string> }
    expect(Object.keys(manifest.skills).sort()).toEqual(['code-review', 'repo-tour'])
    expect(manifest.skills['code-review']).toBe(hashDirectory(join(sourceDir, 'code-review')))

    const second = installBuiltinSkills({ sourceDir, targetDir, manifestPath })
    expect(second.installed).toEqual([])
    expect(second.updated).toEqual([])
    expect(second.skipped).toEqual([])
  })

  it('upgrades an untouched copy when the bundled version changes', () => {
    const { sourceDir, targetDir, manifestPath } = setup()
    writeSkill(sourceDir, 'code-review', 'v1')
    installBuiltinSkills({ sourceDir, targetDir, manifestPath })

    writeSkill(sourceDir, 'code-review', 'v2')
    const result = installBuiltinSkills({ sourceDir, targetDir, manifestPath })
    expect(result.updated).toEqual(['code-review'])
    expect(read(join(targetDir, 'code-review', 'SKILL.md'))).toBe('v2')
    expect(existsSync(join(targetDir, 'code-review', BUILTIN_MARKER))).toBe(true)
  })

  it('never overwrites a skill the user edited', () => {
    const { sourceDir, targetDir, manifestPath } = setup()
    writeSkill(sourceDir, 'code-review', 'v1')
    installBuiltinSkills({ sourceDir, targetDir, manifestPath })

    writeFileSync(join(targetDir, 'code-review', 'SKILL.md'), 'user version', 'utf8')
    writeSkill(sourceDir, 'code-review', 'v2')
    const result = installBuiltinSkills({ sourceDir, targetDir, manifestPath })

    expect(result.skipped).toEqual(['code-review'])
    expect(result.updated).toEqual([])
    expect(read(join(targetDir, 'code-review', 'SKILL.md'))).toBe('user version')
  })

  it('leaves a same-name skill the user created on their own', () => {
    const { sourceDir, targetDir, manifestPath } = setup()
    writeSkill(targetDir, 'code-review', 'my own review skill')
    writeSkill(sourceDir, 'code-review', 'bundled review')

    const result = installBuiltinSkills({ sourceDir, targetDir, manifestPath })
    expect(result.installed).toEqual([])
    expect(result.skipped).toEqual(['code-review'])
    expect(read(join(targetDir, 'code-review', 'SKILL.md'))).toBe('my own review skill')
    // Nothing was installed, so no manifest entry may claim the folder.
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(read(manifestPath)) as { skills: Record<string, string> }
      expect(manifest.skills['code-review']).toBeUndefined()
    }
  })

  it('restores a deleted bundled skill on the next start', () => {
    const { sourceDir, targetDir, manifestPath } = setup()
    writeSkill(sourceDir, 'code-review', 'v1')
    installBuiltinSkills({ sourceDir, targetDir, manifestPath })

    rmSync(join(targetDir, 'code-review'), { recursive: true, force: true })
    const result = installBuiltinSkills({ sourceDir, targetDir, manifestPath })
    expect(result.installed).toEqual(['code-review'])
    expect(read(join(targetDir, 'code-review', 'SKILL.md'))).toBe('v1')
  })

  it('does nothing when the bundled folder is missing', () => {
    const { targetDir, manifestPath } = setup()
    const result = installBuiltinSkills({
      sourceDir: join(targetDir, '..', 'nope'),
      targetDir,
      manifestPath
    })
    expect(result).toEqual({ installed: [], updated: [], skipped: [] })
    expect(existsSync(manifestPath)).toBe(false)
  })
})

describe('hashDirectory', () => {
  it('ignores the install marker and changes with content', () => {
    const root = makeDir()
    writeSkill(root, 'demo', 'one')
    const before = hashDirectory(join(root, 'demo'))
    writeFileSync(join(root, 'demo', BUILTIN_MARKER), '{"builtin":true}', 'utf8')
    expect(hashDirectory(join(root, 'demo'))).toBe(before)

    writeFileSync(join(root, 'demo', 'extra.txt'), 'two', 'utf8')
    expect(hashDirectory(join(root, 'demo'))).not.toBe(before)
  })
})

describe('bundled skill files', () => {
  it('ships 3-5 skills with valid frontmatter and descriptions', () => {
    const root = join(process.cwd(), 'resources', 'builtin-skills')
    const names = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)

    expect(names.length).toBeGreaterThanOrEqual(3)
    expect(names.length).toBeLessThanOrEqual(5)
    for (const name of names) {
      const parsed = parseSkillMarkdown(readFileSync(join(root, name, 'SKILL.md'), 'utf8'))
      expect(parsed.name).toBe(name)
      expect((parsed.description ?? '').length).toBeGreaterThan(8)
      expect((parsed.description ?? '').length).toBeLessThanOrEqual(1024)
      expect(parsed.description).not.toMatch(/[<>]/)
    }
  })
})
