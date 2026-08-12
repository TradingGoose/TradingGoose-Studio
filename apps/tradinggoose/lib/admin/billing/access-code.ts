const PRIVATE_TIER_ACCESS_CODE_UNIQUE_CONSTRAINT = 'system_billing_tier_access_code_unique'

export function isPrivateTierAccessCodeConflict(error: unknown): boolean {
  const seen = new Set<unknown>()
  while (error && typeof error === 'object' && !seen.has(error)) {
    seen.add(error)
    const record = error as { code?: unknown; constraint_name?: unknown; cause?: unknown }
    if (
      record.code === '23505' &&
      record.constraint_name === PRIVATE_TIER_ACCESS_CODE_UNIQUE_CONSTRAINT
    )
      return true
    error = record.cause
  }
  return false
}
