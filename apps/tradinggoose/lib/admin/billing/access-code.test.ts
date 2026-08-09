import { describe, expect, it } from 'vitest'
import { isAccessCodeUniqueViolation } from './access-code'

describe('isAccessCodeUniqueViolation', () => {
  it('recognizes the wrapped postgres-js constraint violation', () => {
    expect(
      isAccessCodeUniqueViolation({
        cause: {
          code: '23505',
          constraint_name: 'system_billing_tier_access_code_unique',
        },
      })
    ).toBe(true)
  })

  it.each([
    { cause: { code: '23503', constraint_name: 'system_billing_tier_access_code_unique' } },
    { cause: { code: '23505', constraint_name: 'another_constraint' } },
    { code: '23505', constraint_name: 'system_billing_tier_access_code_unique' },
    null,
  ])('rejects unrelated or unwrapped errors', (error) => {
    expect(isAccessCodeUniqueViolation(error)).toBe(false)
  })
})
