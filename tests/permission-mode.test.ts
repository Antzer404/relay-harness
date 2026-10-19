import { describe, expect, it } from 'vitest'
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import { setPermissionModeSchema } from '../src/shared/schemas'
import { toVisiblePermissionMode } from '../src/shared/events'
import { selectApprovalUpdates } from '../src/main/runtime/claude-agent-runtime'

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

describe('permission approval suggestions', () => {
  const suggestions: PermissionUpdate[] = [
    { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
    { type: 'setMode', mode: 'default', destination: 'session' },
    {
      type: 'addRules',
      rules: [{ toolName: 'Write', ruleContent: 'hello.txt' }],
      behavior: 'allow',
      destination: 'session'
    }
  ]

  it('applies nothing for deny or single allow', () => {
    expect(selectApprovalUpdates(suggestions, { decision: 'deny' })).toEqual([])
    expect(selectApprovalUpdates(suggestions, { decision: 'allow' })).toEqual([])
  })

  it('applies every suggestion for "always" without a selection', () => {
    expect(selectApprovalUpdates(suggestions, { decision: 'always' })).toHaveLength(3)
  })

  it('applies only the picked suggestion when an index is given', () => {
    expect(selectApprovalUpdates(suggestions, { decision: 'always', suggestionIndex: 0 })).toEqual([
      suggestions[0]
    ])
    expect(selectApprovalUpdates(suggestions, { decision: 'always', suggestionIndex: 2 })).toEqual([
      suggestions[2]
    ])
  })

  it('ignores out-of-range selections', () => {
    expect(selectApprovalUpdates(suggestions, { decision: 'always', suggestionIndex: 9 })).toEqual([])
  })
})
