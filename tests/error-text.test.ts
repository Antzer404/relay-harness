import { describe, expect, it } from 'vitest'
import { isCredentialError } from '@shared/error-codes'
import { describeRuntimeFailure } from '../src/main/runtime/error-text'

describe('runtime error text', () => {
  it('turns credential failures into actionable, non-retryable guidance', () => {
    const failure = describeRuntimeFailure('authentication_failed', '401 invalid api key')
    expect(failure.message).toContain('设置 → API Key')
    expect(failure.message).toContain('401 invalid api key')
    expect(failure.retryable).toBe(false)
    expect(isCredentialError('authentication_failed')).toBe(true)
    expect(isCredentialError('billing_error')).toBe(true)
    expect(isCredentialError('runtime_failure')).toBe(false)
  })

  it('marks transient provider errors as retryable', () => {
    expect(describeRuntimeFailure('rate_limit', '').retryable).toBe(true)
    expect(describeRuntimeFailure('overloaded', '').retryable).toBe(true)
    expect(describeRuntimeFailure('server_error', '').retryable).toBe(true)
    expect(describeRuntimeFailure('max_output_tokens', '').retryable).toBe(true)
  })

  it('recognises transport failures inside runtime errors', () => {
    const failure = describeRuntimeFailure(
      'runtime_failure',
      'Error: connect ECONNREFUSED 127.0.0.1:7890'
    )
    expect(failure.network).toBe(true)
    expect(failure.retryable).toBe(true)
    expect(failure.message).toContain('网络或代理')
  })

  it('keeps an unknown message but still detects network wording', () => {
    const failure = describeRuntimeFailure('weird_code', 'fetch failed')
    expect(failure.network).toBe(true)
    expect(failure.message).toContain('网络或代理')
    expect(failure.message).toContain('fetch failed')
  })

  it('keeps the raw detail for validation errors', () => {
    const failure = describeRuntimeFailure('invalid_request', 'max_tokens is too large')
    expect(failure.message).toContain('参数无效')
    expect(failure.message).toContain('max_tokens is too large')
    expect(failure.retryable).toBe(false)
  })
})
