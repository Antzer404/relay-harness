import { describe, expect, it } from 'vitest'
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import { setPermissionModeSchema } from '../src/shared/schemas'
import { toVisiblePermissionMode, toolRuleName } from '../src/shared/events'
import { buildPermissionUpdates } from '../src/main/runtime/claude-agent-runtime'

describe('permission mode contract', () => {
  it('accepts only the three modes Relay surfaces', () => {
    expect(setPermissionModeSchema.parse({ mode: 'plan' })).toEqual({ mode: 'plan' })
    expect(setPermissionModeSchema.parse({ mode: 'acceptEdits' })).toEqual({
      mode: 'acceptEdits'
    })
    expect(setPermissionModeSchema.safeParse({ mode: 'bypassPermissions' }).success).toBe(false)
    expect(setPermissionModeSchema.safeParse({ mode: 'plan', extra: true }).success).toBe(false)
  })

  it('clamps CLI-only modes to the manual default', () => {
    expect(toVisiblePermissionMode('plan')).toBe('plan')
    expect(toVisiblePermissionMode('acceptEdits')).toBe('acceptEdits')
    expect(toVisiblePermissionMode('auto')).toBe('default')
    expect(toVisiblePermissionMode('dontAsk')).toBe('default')
    expect(toVisiblePermissionMode(undefined)).toBe('default')
  })
})

describe('per-tool grants', () => {
  it('normalises legacy per-target rules to the tool name', () => {
    expect(toolRuleName('WebFetch(domain:github.com)')).toBe('WebFetch')
    expect(toolRuleName('Write(hello.txt)')).toBe('Write')
    expect(toolRuleName('Bash(npm run test:*)')).toBe('Bash')
    expect(toolRuleName('Bash')).toBe('Bash')
    expect(toolRuleName('  ')).toBeNull()
  })

  const siteSuggestion: PermissionUpdate[] = [
    {
      type: 'addRules',
      rules: [{ toolName: 'WebFetch', ruleContent: 'domain:github.com' }],
      behavior: 'allow',
      destination: 'session'
    }
  ]

  it('turns "always" into a whole-tool rule instead of the CLI target rule', () => {
    expect(
      buildPermissionUpdates('WebFetch', siteSuggestion, { decision: 'always' })
    ).toEqual([
      { type: 'addRules', rules: [{ toolName: 'WebFetch' }], behavior: 'allow', destination: 'session' }
    ])
  })

  it('never persists a standing ExitPlanMode grant', () => {
    expect(buildPermissionUpdates('ExitPlanMode', [], { decision: 'always' })).toEqual([])
    expect(
      buildPermissionUpdates('ExitPlanMode', siteSuggestion, { decision: 'always' })
    ).toEqual([])
  })

  it('works when the CLI offers no suggestions at all', () => {
    expect(buildPermissionUpdates('Write', [], { decision: 'always' })).toEqual([
      { type: 'addRules', rules: [{ toolName: 'Write' }], behavior: 'allow', destination: 'session' }
    ])
  })

  it('applies nothing for deny or single allow', () => {
    expect(buildPermissionUpdates('WebFetch', siteSuggestion, { decision: 'deny' })).toEqual([])
    expect(buildPermissionUpdates('WebFetch', siteSuggestion, { decision: 'allow' })).toEqual([])
  })
})

describe('plan approval suggestions', () => {
  const planSuggestions: PermissionUpdate[] = [
    { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
    { type: 'setMode', mode: 'default', destination: 'session' }
  ]

  it('keeps only setMode suggestions for a plan approval', () => {
    expect(
      buildPermissionUpdates('ExitPlanMode', planSuggestions, { decision: 'always' })
    ).toEqual(planSuggestions)
  })

  it('applies only the picked suggestion when an index is given', () => {
    expect(
      buildPermissionUpdates('ExitPlanMode', planSuggestions, {
        decision: 'always',
        suggestionIndex: 1
      })
    ).toEqual([planSuggestions[1]])
    expect(
      buildPermissionUpdates('ExitPlanMode', planSuggestions, {
        decision: 'always',
        suggestionIndex: 9
      })
    ).toEqual([])
  })
})
