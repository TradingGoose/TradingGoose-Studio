import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPublicBillingTiers: vi.fn(),
  getHiddenEnterprisePlaceholderTier: vi.fn(),
  getResolvedBillingSettings: vi.fn(),
  hasPrivateBillingTiers: vi.fn(),
}))

vi.mock('@/lib/billing/settings', () => ({
  getResolvedBillingSettings: mocks.getResolvedBillingSettings,
}))

vi.mock('@/lib/billing/tiers', () => ({
  getPublicBillingTiers: mocks.getPublicBillingTiers,
  getHiddenEnterprisePlaceholderTier: mocks.getHiddenEnterprisePlaceholderTier,
  hasPrivateBillingTiers: mocks.hasPrivateBillingTiers,
}))

import { getPublicBillingCatalog } from '@/lib/billing/catalog'

describe('public billing catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPublicBillingTiers.mockResolvedValue([])
    mocks.getHiddenEnterprisePlaceholderTier.mockResolvedValue(null)
  })

  it('shows the public Enterprise card for its hidden-tier signal without a contact URL', async () => {
    mocks.getResolvedBillingSettings.mockResolvedValue({
      billingEnabled: true,
      enterpriseContactUrl: null,
    })
    mocks.getHiddenEnterprisePlaceholderTier.mockResolvedValue({ id: 'enterprise' })

    const catalog = await getPublicBillingCatalog()

    expect(catalog.enterprisePlaceholder).toMatchObject({
      displayName: 'Enterprise',
      contactUrl: null,
    })
    expect(mocks.hasPrivateBillingTiers).not.toHaveBeenCalled()
  })

  it('does not show the public Enterprise card from contact configuration alone', async () => {
    mocks.getResolvedBillingSettings.mockResolvedValue({
      billingEnabled: true,
      enterpriseContactUrl: 'https://example.com/contact',
    })

    const catalog = await getPublicBillingCatalog()

    expect(catalog.enterprisePlaceholder).toBeNull()
    expect(mocks.hasPrivateBillingTiers).not.toHaveBeenCalled()
  })
})
