import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildSkillOverrides,
  collectSkillList,
  fallbackDescription,
  normalizeDisabledSkills,
  parseSkillMarkdown,
  scanSkillRoot
} from '../src/main/services/skills-service'

const dirs: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'relay-skills-'))
  dirs.push(dir)
  return dir
}

function writeSkill(root: string, name: string, content: string): string {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), content, 'utf8')
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('parseSkillMarkdown', () => {
  it('reads name and description from frontmatter', () => {
    const parsed = parseSkillMarkdown(
      ['---', 'name: deploy-check', 'description: Run the deploy checklist', '---', '', '# Steps', '', 'Do it.'].join(
        '\n'
      )
    )
    expect(parsed.name).toBe('deploy-check')
    expect(parsed.description).toBe('Run the deploy checklist')
    expect(parsed.body).toContain('# Steps')
  })

  it('unquotes quoted values and tolerates CRLF line endings', () => {
    const parsed = parseSkillMarkdown(
      '---\r\nname: "pdf-fill"\r\ndescription: \'Fill PDF forms\'\r\n---\r\nBody'
    )
    expect(parsed.name).toBe('pdf-fill')
    expect(parsed.description).toBe('Fill PDF forms')
  })

  it('folds block scalars into a single line', () => {
    const parsed = parseSkillMarkdown(
      ['---', 'name: review', 'description: >', '  Review a diff and', '  summarize the risks.', '---'].join('\n')
    )
    expect(parsed.description).toBe('Review a diff and summarize the risks.')
  })

  it('falls back to the first prose line when the frontmatter has no description', () => {
    const parsed = parseSkillMarkdown(
      ['---', 'name: release', '---', '', '# Release', '', '- Tag the repository', 'then publish.'].join('\n')
    )
    expect(parsed.name).toBe('release')
    expect(parsed.description).toBe('Tag the repository')
  })

  it('uses the body when there is no frontmatter', () => {
    const parsed = parseSkillMarkdown('# Notes\n\nUse pnpm, not npm.')
    expect(parsed.name).toBeNull()
    expect(parsed.description).toBe('Use pnpm, not npm.')
  })

  it('never returns multi-line descriptions', () => {
    expect(fallbackDescription('a\n\nb')).toBe('a')
  })
})

describe('scanSkillRoot', () => {
  it('lists folders that contain SKILL.md and ignores everything else', () => {
    const root = makeDir()
    writeSkill(root, 'deploy', '---\nname: deploy\ndescription: Ship it\n---\nRun.')
    writeSkill(root, 'review', '---\ndescription: Check a diff\n---\nRead.')
    writeSkill(root, 'titled', '---\nname: 自定义标题\ndescription: Has a title\n---\nGo.')
    mkdirSync(join(root, 'empty-skill'), { recursive: true })
    mkdirSync(join(root, '.trash', 'old'), { recursive: true })
    writeFileSync(join(root, 'loose.md'), 'not a skill', 'utf8')
    writeFileSync(join(root, 'review', 'extra.txt'), 'asset', 'utf8')

    const skills = scanSkillRoot(root, 'workspace')
    expect(skills.map((skill) => skill.name)).toEqual(['deploy', 'review', 'titled'])
    expect(skills[0]?.description).toBe('Ship it')
    expect(skills[0]?.scope).toBe('workspace')
    expect(skills[0]?.path.endsWith(join('deploy', 'SKILL.md'))).toBe(true)
    expect(skills[2]?.title).toBe('自定义标题')
    expect(skills.every((skill) => skill.enabled)).toBe(true)
  })

  it('returns an empty list for a missing directory', () => {
    expect(scanSkillRoot(join(makeDir(), 'nope'), 'global')).toEqual([])
  })
})

describe('collectSkillList', () => {
  it('merges workspace and global skills and applies the disabled list', () => {
    const globalDir = makeDir()
    const workspaceDir = makeDir()
    writeSkill(globalDir, 'deploy', '---\ndescription: Global deploy\n---')
    writeSkill(globalDir, 'pdf', '---\ndescription: PDF tools\n---')
    writeSkill(workspaceDir, 'release', '---\ndescription: Workspace release\n---')

    const list = collectSkillList({ globalDir, workspaceDir, disabled: ['pdf', 'missing'] })
    expect(list.globalDir).toBe(globalDir)
    expect(list.workspaceDir).toBe(workspaceDir)
    expect(list.skills.map((skill) => `${skill.scope}:${skill.name}`)).toEqual([
      'workspace:release',
      'global:deploy',
      'global:pdf'
    ])
    expect(list.skills.find((skill) => skill.name === 'pdf')?.enabled).toBe(false)
    expect(list.skills.find((skill) => skill.name === 'deploy')?.enabled).toBe(true)
  })

  it('applies one toggle to duplicate names in both scopes', () => {
    const globalDir = makeDir()
    const workspaceDir = makeDir()
    writeSkill(globalDir, 'deploy', '---\ndescription: Global deploy\n---')
    writeSkill(workspaceDir, 'deploy', '---\ndescription: Workspace deploy\n---')
    const list = collectSkillList({ globalDir, workspaceDir, disabled: ['deploy'] })
    expect(list.skills).toHaveLength(2)
    expect(list.skills.every((skill) => !skill.enabled)).toBe(true)
  })
})

describe('skill settings helpers', () => {
  it('builds the CLI skillOverrides payload and skips reserved keys', () => {
    const overrides = buildSkillOverrides(['pdf', '__proto__', '', 'deploy'])
    expect(Object.keys(overrides).sort()).toEqual(['deploy', 'pdf'])
    expect(overrides.pdf).toBe('off')
    expect(Object.getPrototypeOf(overrides)).toBeNull()
  })

  it('normalizes persisted disabled names', () => {
    expect(
      normalizeDisabledSkills([' pdf ', 'pdf', '', 42, '__proto__', 'x'.repeat(201), 'deploy'])
    ).toEqual(['pdf', 'deploy'])
    expect(normalizeDisabledSkills('not-an-array')).toEqual([])
    expect(normalizeDisabledSkills(undefined)).toEqual([])
  })
})
