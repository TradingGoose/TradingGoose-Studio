import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('admin tier archive contract', () => {
  it('archives through PATCH input ownership and has no delete mutation', () => {
    const source = readFileSync(new URL('./tier-detail.tsx', import.meta.url), 'utf8')
    expect(source).toContain('buildTierMutationInputFromDefaults')
    expect(source).toContain("status: 'archived'")
    expect(source).toContain('entitledSubscriptionCount')
    expect(source).not.toContain('useDeleteAdminBillingTier')
  })
})
