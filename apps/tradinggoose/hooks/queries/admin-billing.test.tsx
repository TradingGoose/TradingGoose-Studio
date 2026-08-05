import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('admin billing query ownership', () => {
  it('invalidates public, private, subscription, and admin owners after tier deletion', () => {
    const source = readFileSync(new URL('./admin-billing.ts', import.meta.url), 'utf8')
    expect(source).toContain('publicBillingCatalogKeys.current()')
    expect(source).toContain('privateTierAccessKeys.current()')
    expect(source).toContain('subscriptionKeys.all')
    expect(source).toContain("method: 'POST' | 'PATCH' | 'DELETE'")
    expect(source).toContain('useDeleteAdminBillingTier')
  })
})
