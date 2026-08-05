import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('organization seat route boundary', () => {
  it('owns quantity changes without private-tier access', () => {
    const source = readFileSync(new URL('./route.ts', import.meta.url), 'utf8')
    expect(source).toContain('stripe.subscriptions.update')
    expect(source).not.toContain('privateTierAccess')
    expect(source).not.toContain('userCanAccessPrivateBillingTier')
  })
})
