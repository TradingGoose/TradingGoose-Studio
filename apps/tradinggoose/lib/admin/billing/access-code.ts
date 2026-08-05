export function isAccessCodeUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: unknown })?.cause as {
    code?: unknown
    constraint_name?: unknown
  }
  return (
    cause?.code === '23505' && cause?.constraint_name === 'system_billing_tier_access_code_unique'
  )
}
