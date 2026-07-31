import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPublicBillingTiers: vi.fn(),
  getResolvedBillingSettings: vi.fn(),
  hasPrivateBillingTiers: vi.fn(),
}))

vi.mock('@/lib/billing/settings', () => ({
  getResolvedBillingSettings: mocks.getResolvedBillingSettings,
}))

vi.mock('@/lib/billing/tiers', () => ({
  getPublicBillingTiers: mocks.getPublicBillingTiers,
  hasPrivateBillingTiers: mocks.hasPrivateBillingTiers,
}))

import { getPublicBillingCatalog } from '@/lib/billing/catalog'

describe('public billing catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPublicBillingTiers.mockResolvedValue([])
  })

  it.each([
    ['https://example.com/contact', true],
    [null, false],
  ] as const)(
    'derives the Enterprise card only from public contact configuration',
    async (url, visible) => {
      mocks.getResolvedBillingSettings.mockResolvedValue({
        billingEnabled: true,
        enterpriseContactUrl: url,
      })

      const catalog = await getPublicBillingCatalog()

      expect(Boolean(catalog.enterprisePlaceholder)).toBe(visible)
      expect(catalog.enterprisePlaceholder?.contactUrl ?? null).toBe(url)
      expect(mocks.hasPrivateBillingTiers).not.toHaveBeenCalled()
    }
  )
})
