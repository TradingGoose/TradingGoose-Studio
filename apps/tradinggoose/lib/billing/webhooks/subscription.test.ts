/** @vitest-environment node */
import Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleStripeSubscriptionDeleted } from './subscription'

const state = vi.hoisted(() => ({
  original: vi.fn(),
  restore: vi.fn(),
  synchronize: vi.fn(),
  ledger: vi.fn(),
  lock: vi.fn(),
  transaction: vi.fn(),
  active: false,
  transactions: [] as object[],
  order: [] as string[],
}))
vi.mock('@tradinggoose/db', () => ({ db: { transaction: state.transaction } }))
vi.mock('@tradinggoose/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tradinggoose/billing')>()),
  lockFinancialRoots: state.lock,
}))
vi.mock('@/lib/billing/core/subscription', () => ({
  getSubscriptionByStripeSubscriptionId: state.original,
  ensureDefaultUserSubscription: state.restore,
}))
vi.mock('@/lib/billing/tiers/persistence', () => ({
  syncSubscriptionBillingTierFromStripeSubscription: state.synchronize,
}))
vi.mock('@/lib/billing/core/usage', () => ({ getEffectiveCurrentPeriodCost: state.ledger }))

const stripe = new Stripe('sk_test_local_fixture')
function signed(object: unknown) {
  const payload = JSON.stringify({
    id: 'evt_deleted',
    object: 'event',
    type: 'customer.subscription.deleted',
    data: { object },
  })
  const secret = 'whsec_local_test_fixture'
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret })
  return stripe.webhooks.constructEvent(payload, signature, secret)
}
function deleted(overrides: Record<string, unknown> = {}) {
  return {
    id: 'stripe-original',
    object: 'subscription',
    cancel_at_period_end: true,
    metadata: {
      userId: 'forged-owner',
      referenceId: 'forged-reference',
      subscriptionId: 'forged-local',
    },
    items: {
      data: [
        {
          current_period_start: 1775001600,
          current_period_end: 1777593600,
          price: { id: 'signed-price', recurring: {} },
        },
      ],
    },
    ...overrides,
  }
}
const original = {
  id: 'local-original',
  referenceType: 'user',
  referenceId: 'original-owner',
  stripeSubscriptionId: 'stripe-original',
  stripeCustomerId: 'original-customer',
  status: 'canceled',
  metadata: { grantedOnboardingAllowanceUsd: '0.30000000000000001', customUsageLimit: '40' },
}
const restored = {
  id: 'distinct-default',
  referenceType: 'user',
  referenceId: 'original-owner',
  stripeSubscriptionId: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  state.active = false
  state.transactions.length = state.order.length = 0
  state.original.mockResolvedValue(structuredClone(original))
  state.transaction.mockImplementation(async (callback: (tx: object) => Promise<unknown>) => {
    const tx = { ordinal: state.transactions.length }
    state.transactions.push(tx)
    state.active = true
    state.order.push('begin')
    try {
      const result = await callback(tx)
      state.order.push('commit')
      return result
    } catch (error) {
      state.order.push('rollback')
      throw error
    } finally {
      state.active = false
    }
  })
  state.lock.mockImplementation(async () => {
    expect(state.active).toBe(true)
    state.order.push('lock')
  })
  state.synchronize.mockImplementation(async () => {
    expect(state.active).toBe(true)
    state.order.push('cancel')
  })
  state.restore.mockImplementation(async () => {
    expect(state.active).toBe(true)
    state.order.push('restore')
    return restored
  })
  state.ledger.mockImplementation(async () => {
    expect(state.active).toBe(false)
    state.order.push('ledger')
  })
})

describe('signed Stripe subscription cancellation orchestration', () => {
  it('pins the original subscription/root despite metadata and preserves canceled identity/grants', async () => {
    const body = deleted()
    await handleStripeSubscriptionDeleted(signed(body))
    const tx = state.transactions[0]
    expect(state.original).toHaveBeenCalledExactlyOnceWith('stripe-original')
    expect(state.lock).toHaveBeenCalledExactlyOnceWith(tx, [{ type: 'user', id: 'original-owner' }])
    expect(state.synchronize).toHaveBeenCalledExactlyOnceWith({
      subscriptionId: 'local-original',
      stripeSubscription: body,
      transaction: tx,
      patch: {
        status: 'canceled',
        periodStart: new Date(1775001600 * 1000),
        periodEnd: new Date(1777593600 * 1000),
        cancelAtPeriodEnd: true,
      },
    })
    expect(state.restore).toHaveBeenCalledExactlyOnceWith('original-owner', tx)
    expect(state.ledger).toHaveBeenCalledExactlyOnceWith('original-owner')
    await expect(state.original.mock.results[0].value).resolves.toEqual(original)
    expect(restored.id).not.toBe(original.id)
    expect(state.order).toEqual(['begin', 'lock', 'cancel', 'restore', 'commit', 'ledger'])
  })
  it('keeps an existing entitled row returned by the canonical provisioner', async () => {
    const entitled = {
      ...restored,
      id: 'existing-other-subscription',
      stripeSubscriptionId: 'other-stripe-subscription',
    }
    state.restore.mockResolvedValue(entitled)
    await handleStripeSubscriptionDeleted(signed(deleted()))
    expect(state.restore).toHaveBeenCalledExactlyOnceWith('original-owner', state.transactions[0])
    expect(state.ledger).toHaveBeenCalledExactlyOnceWith('original-owner')
  })
  it('does not create a personal fallback for an organization cancellation', async () => {
    state.original.mockResolvedValue({
      ...original,
      referenceType: 'organization',
      referenceId: 'original-org',
    })
    await handleStripeSubscriptionDeleted(signed(deleted()))
    expect(state.lock).toHaveBeenCalledExactlyOnceWith(state.transactions[0], [
      { type: 'organization', id: 'original-org' },
    ])
    expect(state.restore).not.toHaveBeenCalled()
    expect(state.ledger).not.toHaveBeenCalled()
  })
  it('refuses missing original identity rather than silently skipping or repairing it', async () => {
    state.original.mockResolvedValue(null)
    await expect(handleStripeSubscriptionDeleted(signed(deleted()))).rejects.toThrow(
      'no retained original binding'
    )
    expect(state.transaction).not.toHaveBeenCalled()
    expect(state.restore).not.toHaveBeenCalled()
  })
  it('requires signed original period evidence before any mutation', async () => {
    await expect(
      handleStripeSubscriptionDeleted(signed(deleted({ items: { data: [] } })))
    ).rejects.toThrow('no verified original period')
    expect(state.transaction).not.toHaveBeenCalled()
    expect(state.restore).not.toHaveBeenCalled()
  })
  it('does not restore or read the personal ledger after canonical mutation failure', async () => {
    state.synchronize.mockRejectedValue(new Error('Original closing basis unavailable'))
    await expect(handleStripeSubscriptionDeleted(signed(deleted()))).rejects.toThrow(
      'Original closing basis unavailable'
    )
    expect(state.restore).not.toHaveBeenCalled()
    expect(state.ledger).not.toHaveBeenCalled()
    expect(state.order).toEqual(['begin', 'lock', 'rollback'])
  })
  it('does not read the ledger after canonical default provisioning fails', async () => {
    state.restore.mockRejectedValue(new Error('Protected original obligation remains open'))
    await expect(handleStripeSubscriptionDeleted(signed(deleted()))).rejects.toThrow(
      'Protected original obligation remains open'
    )
    expect(state.ledger).not.toHaveBeenCalled()
    expect(state.order).toEqual(['begin', 'lock', 'cancel', 'rollback'])
  })
  it('keeps the personal ledger check outside the committed financial transaction even if it fails', async () => {
    state.ledger.mockImplementation(async () => {
      expect(state.active).toBe(false)
      throw new Error('Original personal ledger missing after commit')
    })
    await expect(handleStripeSubscriptionDeleted(signed(deleted()))).rejects.toThrow(
      'Original personal ledger missing after commit'
    )
    expect(state.order).toEqual(['begin', 'lock', 'cancel', 'restore', 'commit'])
    expect(state.transaction).toHaveBeenCalledOnce()
  })
})
