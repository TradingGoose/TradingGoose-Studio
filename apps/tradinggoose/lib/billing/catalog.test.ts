import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPublicBillingTiers: vi.fn(),
  getResolvedBillingSettings: vi.fn(),
}))

vi.mock('@/lib/billing/settings', () => ({
  getResolvedBillingSettings: mocks.getResolvedBillingSettings,
}))

vi.mock('@/lib/billing/tiers', () => ({
  getPublicBillingTiers: mocks.getPublicBillingTiers,
}))

import { getPublicBillingCatalog } from '@/lib/billing/catalog'

describe('public billing catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPublicBillingTiers.mockResolvedValue([])
  })

  it('does not show the public Enterprise card without a contact URL', async () => {
    mocks.getResolvedBillingSettings.mockResolvedValue({
      billingEnabled: true,
      enterpriseContactUrl: null,
    })
    const catalog = await getPublicBillingCatalog()

    expect(catalog.enterprisePlaceholder).toBeNull()
  })

  it('shows the public Enterprise card when the contact URL is configured', async () => {
    mocks.getResolvedBillingSettings.mockResolvedValue({
      billingEnabled: true,
      enterpriseContactUrl: 'https://example.com/contact',
    })

    const catalog = await getPublicBillingCatalog()

    expect(catalog.enterprisePlaceholder).toMatchObject({
      displayName: 'Enterprise',
      contactUrl: 'https://example.com/contact',
    })
  })
})
