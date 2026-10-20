/**
 * Error codes that mean the saved credential or account needs attention.
 * The renderer offers "open settings" instead of a pointless retry.
 */
export const CREDENTIAL_ERROR_CODES: ReadonlySet<string> = new Set([
  'authentication_failed',
  'oauth_org_not_allowed',
  'account_on_hold',
  'verification_required',
  'billing_error',
  'cloud_credential_error',
  'no_api_key'
])

export function isCredentialError(code: string | null | undefined): boolean {
  return typeof code === 'string' && CREDENTIAL_ERROR_CODES.has(code)
}
