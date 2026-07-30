import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('subscription modal private access contract', () => {
  it('uses canonical composition, authenticated contact signal, and disables current-only cards', () => {
    const source = readFileSync(new URL('./subscription.tsx', import.meta.url), 'utf8')
    expect(source).toContain('composeSubscriptionTierDisplays')
    expect(source).toContain('usePrivateTierAccess')
    expect(source).toContain('enterpriseContactCard')
    expect(source).toContain('tier.isCurrentOnly')
    expect(source).not.toContain('publicBillingCatalog?.enterprisePlaceholder')
  })
})
