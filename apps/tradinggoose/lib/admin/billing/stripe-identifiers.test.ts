/** @vitest-environment node */
import { expect, it, vi } from 'vitest'
import {
  validateBillingTierStripeCatalog,
  validateBillingTierStripeMutation,
} from './stripe-identifiers'

const { getActiveTiers, getTierById } = vi.hoisted(() => ({
  getActiveTiers: vi.fn(),
  getTierById: vi.fn(),
}))

vi.mock('@/lib/billing/stripe-client', () => ({ requireStripeClient: () => ({}) }))
vi.mock('@/lib/billing/stripe-portal', () => ({ buildPlanChangePortalCatalog: vi.fn() }))
vi.mock('@/lib/billing/tiers', () => ({
  getActiveStripeBillingTiers: getActiveTiers,
  getBillingTierById: getTierById,
}))

const tier = (id: string) => ({
  id,
  stripeMonthlyPriceId: `price_${id}`,
  stripeYearlyPriceId: null,
  stripeProductId: null,
})

it.each([
  ['creation', null],
  ['activation', { status: 'draft' }],
])('rejects concurrent catalog changes during %s', async (_operation, existingTier) => {
  vi.clearAllMocks()
  getTierById.mockResolvedValue(existingTier)
  getActiveTiers
    .mockResolvedValueOnce([tier('existing')])
    .mockResolvedValueOnce([tier('existing'), tier('concurrent')])
  const input = {
    id: 'candidate',
    status: 'active',
    stripeMonthlyPriceId: 'price_candidate',
    stripeYearlyPriceId: null,
    stripeProductId: null,
  } as any
  const revision = await validateBillingTierStripeCatalog(input)
  const tx = { execute: vi.fn(), select: vi.fn() }

  await expect(validateBillingTierStripeMutation(tx as any, input, revision)).rejects.toThrow(
    'Billing tier catalog changed; retry the request'
  )
  expect(tx.execute).toHaveBeenCalledOnce()
  expect(tx.select).not.toHaveBeenCalled()
})
