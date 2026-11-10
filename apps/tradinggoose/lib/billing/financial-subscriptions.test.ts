/** @vitest-environment node */
import { FinancialPolicyError, type FinancialTransaction } from '@tradinggoose/billing'
import {
  organizationBillingLedger,
  type subscription,
  systemBillingTier,
} from '@tradinggoose/db/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  freezeSubscriptionBeforeMutation,
  rotateSubscriptionAfterMutation,
  validateFinancialSeatCapacity,
} from './financial-subscriptions'

const policyReads = vi.hoisted(() => ({
  read: vi.fn(),
  close: vi.fn(),
  suspend: vi.fn(),
  resume: vi.fn(),
}))
vi.mock('@tradinggoose/db', () => ({ db: {} }))
vi.mock('@tradinggoose/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tradinggoose/billing')>()),
  readFinancialReceipt: policyReads.read,
  closeFinancialPeriod: policyReads.close,
  suspendFinancialPeriodEligibility: policyReads.suspend,
  resumeFinancialPeriodEligibility: policyReads.resume,
}))
type Row = typeof subscription.$inferSelect
type Tier = typeof systemBillingTier.$inferSelect
const row = (patch: Partial<Row> = {}): Row =>
  ({
    id: 'original-subscription',
    referenceType: 'organization',
    referenceId: 'original-organization',
    plan: 'original-tier',
    billingTierId: 'original-tier',
    stripeSubscriptionId: 'original-stripe-subscription',
    stripeCustomerId: 'original-customer',
    status: 'active',
    seats: 1,
    periodStart: new Date('2026-01-01T00:00:00Z'),
    periodEnd: new Date('2026-02-01T00:00:00Z'),
    ...patch,
  }) as Row
const tier = (id: string, usageScope: 'pooled' | 'individual', patch: Partial<Tier> = {}) =>
  ({ id, ownerType: 'organization', usageScope, ...patch }) as Tier
function store(tiers: Tier[]) {
  const select = vi.fn(() => ({
    from: (table: unknown) => ({
      where: async () => {
        if (table === systemBillingTier) return tiers
        if (table === organizationBillingLedger) return [{ cost: '0', current: '0', prior: '0' }]
        throw new Error('Unexpected financial guard query')
      },
    }),
  }))
  return { tx: { select } as unknown as FinancialTransaction, select }
}
beforeEach(() => {
  policyReads.read.mockReset().mockResolvedValue(null)
  policyReads.close.mockReset().mockResolvedValue(undefined)
  policyReads.suspend.mockReset().mockResolvedValue(undefined)
  policyReads.resume.mockReset().mockResolvedValue(undefined)
})

describe('reversible eligibility and fixed seats use the shared mutation boundary', () => {
  for (const original of ['active', 'trialing', 'past_due']) {
    for (const adverse of ['unpaid', 'paused']) {
      it(`suspends ${original} to ${adverse} before the writer without permanently closing`, async () => {
        const { tx } = store([tier('original-tier', 'pooled')])
        await expect(
          freezeSubscriptionBeforeMutation(tx, row({ status: original }), row({ status: adverse }))
        ).resolves.toBe(false)
        expect(policyReads.suspend).toHaveBeenCalledExactlyOnceWith(
          tx,
          { type: 'organization', id: 'original-organization' },
          expect.objectContaining({ subscriptionId: 'original-subscription' })
        )
        expect(policyReads.close).not.toHaveBeenCalled()
        expect(policyReads.resume).not.toHaveBeenCalled()
      })
    }
  }
  it('requires retained suspension before same-period recovery and resumes after actual write', async () => {
    const before = row({ status: 'unpaid' })
    const after = row()
    const original = {
      subscriptionId: before.id,
      stripeSubscriptionId: before.stripeSubscriptionId,
      customerId: before.stripeCustomerId,
      start: before.periodStart!.toISOString(),
      end: before.periodEnd!.toISOString(),
    }
    policyReads.read
      .mockResolvedValueOnce({ recordType: 'period-head', current: original })
      .mockResolvedValueOnce({
        recordType: 'period',
        closing: null,
        suspension: { mode: 'pooled' },
      })
    const { tx } = store([tier('original-tier', 'pooled')])
    expect(await freezeSubscriptionBeforeMutation(tx, before, after)).toBe(false)
    expect(policyReads.resume).not.toHaveBeenCalled()
    policyReads.read.mockResolvedValueOnce({ recordType: 'period', suspension: { mode: 'pooled' } })
    await rotateSubscriptionAfterMutation(tx, before, after, false)
    expect(policyReads.resume).toHaveBeenCalledExactlyOnceWith(
      tx,
      { type: 'organization', id: before.referenceId },
      original
    )
    expect(policyReads.close).not.toHaveBeenCalled()
  })
  for (const closing of [false, true]) {
    it(`does not repair missing suspension or reopen closing:${closing}`, async () => {
      const before = row({ status: 'paused' })
      const original = {
        subscriptionId: before.id,
        stripeSubscriptionId: before.stripeSubscriptionId,
        customerId: before.stripeCustomerId,
        start: before.periodStart!.toISOString(),
        end: before.periodEnd!.toISOString(),
      }
      policyReads.read
        .mockResolvedValueOnce({ recordType: 'period-head', current: original })
        .mockResolvedValueOnce({ recordType: 'period', closing: closing ? {} : null })
      const { tx } = store([tier('original-tier', 'pooled')])
      await expect(freezeSubscriptionBeforeMutation(tx, before, row())).rejects.toThrow(
        'suspended subscription authority'
      )
      expect(policyReads.resume).not.toHaveBeenCalled()
      expect(policyReads.close).not.toHaveBeenCalled()
    })
  }
  for (const seats of [100, 2, 0, -1, 1.5]) {
    it(`refuses explicit fixed quantity ${seats} before member or invitation reads`, async () => {
      const { tx, select } = store([])
      await expect(
        validateFinancialSeatCapacity(
          tx,
          row({ seats }),
          tier('original-tier', 'pooled', { seatMode: 'fixed', seatCount: 3 })
        )
      ).rejects.toThrow('seat quantity')
      expect(select).not.toHaveBeenCalled()
    })
  }
  for (const seats of [3, null]) {
    it(`keeps valid fixed quantity ${seats} and its original null representation`, async () => {
      const select = vi.fn(() => ({ from: () => ({ where: async () => [{ count: 2 }] }) }))
      const candidate = row({ seats })
      await expect(
        validateFinancialSeatCapacity(
          { select } as unknown as FinancialTransaction,
          candidate,
          tier('original-tier', 'pooled', { seatMode: 'fixed', seatCount: 3 })
        )
      ).rejects.toThrow('members and pending')
      expect(candidate.seats).toBe(seats)
      expect(select).toHaveBeenCalledTimes(2)
    })
  }
})

describe('same-period organization monetary scope', () => {
  for (const [original, requested] of [
    ['pooled', 'individual'],
    ['individual', 'pooled'],
  ] as const) {
    it(`refuses ${original} to ${requested} before reading empty history or closing anything`, async () => {
      const { tx, select } = store([
        tier('original-tier', original),
        tier('requested-tier', requested),
      ])
      const promise = freezeSubscriptionBeforeMutation(
        tx,
        row(),
        row({ plan: 'requested-tier', billingTierId: 'requested-tier' })
      )
      await expect(promise).rejects.toMatchObject({
        status: 409,
        message: 'Same-period organization monetary scope cannot change',
      })
      await expect(promise).rejects.toBeInstanceOf(FinancialPolicyError)
      expect(select).toHaveBeenCalledTimes(1)
      expect(policyReads.read).not.toHaveBeenCalled()
      expect(policyReads.close).not.toHaveBeenCalled()
    })
  }
  for (const [name, tiers, beforePatch, requestedPatch] of [
    ['missing original tier', [tier('requested-tier', 'pooled')], {}, {}],
    ['missing requested tier', [tier('original-tier', 'pooled')], {}, {}],
    [
      'foreign original tier owner',
      [tier('original-tier', 'pooled', { ownerType: 'user' }), tier('requested-tier', 'pooled')],
      {},
      {},
    ],
    [
      'foreign requested tier owner',
      [tier('original-tier', 'pooled'), tier('requested-tier', 'pooled', { ownerType: 'user' })],
      {},
      {},
    ],
    [
      'unknown original scope',
      [tier('original-tier', 'unknown' as 'pooled'), tier('requested-tier', 'pooled')],
      {},
      {},
    ],
    [
      'unknown requested scope',
      [tier('original-tier', 'pooled'), tier('requested-tier', 'unknown' as 'pooled')],
      {},
      {},
    ],
    ['missing original binding', [], { billingTierId: null }, {}],
    ['conflicting original plan', [], { plan: 'different-tier' }, {}],
    ['missing requested binding', [], {}, { billingTierId: null }],
    ['conflicting requested plan', [], {}, { plan: 'different-tier' }],
  ] as const) {
    it(`refuses ${name} without attempting preservation or repair`, async () => {
      const { tx } = store([...tiers])
      await expect(
        freezeSubscriptionBeforeMutation(
          tx,
          row(beforePatch),
          row({ plan: 'requested-tier', billingTierId: 'requested-tier', ...requestedPatch })
        )
      ).rejects.toBeInstanceOf(FinancialPolicyError)
      expect(policyReads.read).not.toHaveBeenCalled()
      expect(policyReads.close).not.toHaveBeenCalled()
    })
  }
  for (const scope of ['pooled', 'individual'] as const) {
    it(`allows same-period ${scope} allowance and seat changes without closing the period`, async () => {
      const { tx } = store([
        tier('original-tier', scope, { includedUsageLimitUsd: '40' }),
        tier('requested-tier', scope, { includedUsageLimitUsd: '60' }),
      ])
      await expect(
        freezeSubscriptionBeforeMutation(
          tx,
          row(),
          row({ plan: 'requested-tier', billingTierId: 'requested-tier', seats: 2 })
        )
      ).resolves.toBe(false)
      expect(policyReads.read).not.toHaveBeenCalled()
      expect(policyReads.close).not.toHaveBeenCalled()
    })
  }
  it('preserves genuine rollover classification before the requested tier is written', async () => {
    const before = row()
    const period = {
      subscriptionId: before.id,
      stripeSubscriptionId: before.stripeSubscriptionId,
      customerId: before.stripeCustomerId,
      start: before.periodStart!.toISOString(),
      end: before.periodEnd!.toISOString(),
    }
    policyReads.read
      .mockResolvedValueOnce({ recordType: 'period-head', current: period })
      .mockResolvedValueOnce({ recordType: 'period', closing: null })
    const { tx, select } = store([])
    await expect(
      freezeSubscriptionBeforeMutation(
        tx,
        before,
        row({
          plan: 'requested-tier',
          billingTierId: 'requested-tier',
          periodStart: new Date('2026-02-01T00:00:00Z'),
          periodEnd: new Date('2026-03-01T00:00:00Z'),
        })
      )
    ).resolves.toBe(true)
    expect(select).not.toHaveBeenCalled()
    expect(policyReads.close).toHaveBeenCalledExactlyOnceWith(
      tx,
      { type: 'organization', id: before.referenceId },
      period
    )
  })
  it('does not add an organization-scope query to a personal subscription', async () => {
    const { tx, select } = store([])
    await expect(
      freezeSubscriptionBeforeMutation(
        tx,
        row({ referenceType: 'user' }),
        row({ referenceType: 'user', seats: 2 })
      )
    ).resolves.toBe(false)
    expect(select).not.toHaveBeenCalled()
    expect(policyReads.close).not.toHaveBeenCalled()
  })
})
