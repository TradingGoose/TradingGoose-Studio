import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('private tier access API contract', () => {
  const source = readFileSync(new URL('./route.ts', import.meta.url), 'utf8')

  it('returns one canonical server-shaped response', () => {
    expect(source).toContain('privateTiers: tiers.map')
    expect(source).toContain('enterpriseContactCard')
    expect(source).not.toContain('showEnterpriseContact')
    expect(source).toContain('toSubscriptionTierDisplay')
    expect(source).not.toContain('privateTier:')
  })

  it('uses exact blank and invalid errors without billing side effects', () => {
    expect(source).toContain("error: 'Access code is required'")
    expect(source).toContain("error: 'Invalid access code'")
    expect(source).not.toContain('subscription.upgrade')
    expect(source).not.toContain('stripe.')
  })
})
