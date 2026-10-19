import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeExecutableCandidates } from '../src/main/runtime/binary'

describe('claudeExecutableCandidates', () => {
  it('locates the Windows x64 CLI inside app.asar.unpacked', () => {
    const resources = join('C:', 'Program Files', 'Relay', 'resources')
    const candidates = claudeExecutableCandidates('win32', 'x64', resources)
    expect(
      candidates.some((candidate) =>
        candidate.endsWith(join('claude-agent-sdk-win32-x64', 'claude.exe'))
      )
    ).toBe(true)
    expect(candidates.every((candidate) => candidate.includes('app.asar.unpacked'))).toBe(true)
  })

  it('locates the macOS arm64 CLI inside app.asar.unpacked', () => {
    const resources = join('/', 'Applications', 'Relay.app', 'Contents', 'Resources')
    const candidates = claudeExecutableCandidates('darwin', 'arm64', resources)
    expect(
      candidates.some((candidate) =>
        candidate.endsWith(join('claude-agent-sdk-darwin-arm64', 'claude'))
      )
    ).toBe(true)
  })

  it('supports the hoisted and nested npm layouts', () => {
    const candidates = claudeExecutableCandidates('linux', 'x64', '/opt/relay/resources')
    expect(candidates).toHaveLength(2)
    expect(candidates[0]).toContain(join('claude-agent-sdk', 'node_modules'))
    expect(candidates[1]).not.toContain(join('claude-agent-sdk', 'node_modules'))
  })
})
