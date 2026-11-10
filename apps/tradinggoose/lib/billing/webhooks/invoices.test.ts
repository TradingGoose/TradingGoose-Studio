/** @vitest-environment node */
import {
  financialNamespace,
  type InvoiceReceipt,
  type Period,
  periodKey as policyPeriodKey,
} from '@tradinggoose/billing'
import { db } from '@tradinggoose/db'
import Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  handleInvoiceFinalized,
  handleInvoicePaymentFailed,
  handleInvoicePaymentSucceeded,
} from './invoices'

const state = vi.hoisted(() => ({
  read: vi.fn(),
  readSubscription: vi.fn(),
  register: vi.fn(),
  accept: vi.fn(),
  acknowledge: vi.fn(),
  lookup: vi.fn(),
  lock: vi.fn(),
  transaction: vi.fn(),
  transactions: [] as object[],
}))
vi.mock('@tradinggoose/db', () => ({ db: { transaction: state.transaction } }))
vi.mock('@tradinggoose/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tradinggoose/billing')>()),
  readFinancialReceipt: state.read,
  lockFinancialRoots: state.lock,
  readSubscriptionInvoice: state.readSubscription,
  registerSubscriptionInvoice: state.register,
  acceptInvoicePayment: state.accept,
  acknowledgeInvoiceIssued: state.acknowledge,
}))

const period: Period = {
  subscriptionId: 'local-original',
  stripeSubscriptionId: 'stripe-original',
  customerId: 'customer-original',
  start: '2026-04-01T00:00:00.000Z',
  end: '2026-05-01T00:00:00.000Z',
}
const intent: InvoiceReceipt = {
  recordType: 'invoice',
  fingerprint: 'accepted-original-fingerprint',
  root: { type: 'user', id: 'original-owner' },
  period,
  amountCents: '2500',
  currency: 'usd',
  invoiceObligationState: 'open',
  issuance: 'issued',
  invoiceId: 'in_original',
  requestKey: 'original-request',
  subtype: 'late_settlement_adjustment',
  financialClosureState: 'open',
  dispatchState: 'complete',
  dispatchAtMs: 0,
  markers: [],
}
const namespace = financialNamespace(intent.root)
const key = 'original-accepted-invoice'
const bound = { namespace, key, intent }
const stripe = new Stripe('sk_test_local_fixture')
function signed(object: unknown, type = 'invoice.payment_succeeded') {
  const payload = JSON.stringify({ id: 'evt_invoice', object: 'event', type, data: { object } })
  const secret = 'whsec_local_test_fixture'
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret })
  return stripe.webhooks.constructEvent(payload, header, secret)
}
function metadata() {
  return {
    type: 'overage_billing',
    financialNamespace: namespace,
    financialKey: key,
    financialFingerprint: intent.fingerprint,
    subscriptionId: period.stripeSubscriptionId,
    periodStart: period.start,
    periodEnd: period.end,
  }
}
function recurringLine(start = 1775001600, end = 1777593600) {
  return {
    id: 'line_original',
    object: 'line_item',
    period: { start, end },
    parent: {
      type: 'subscription_item_details',
      subscription_item_details: {
        subscription: 'stripe-original',
        subscription_item: 'item_original',
        proration: false,
      },
    },
  }
}
function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'in_original',
    object: 'invoice',
    status: 'paid',
    customer: 'customer-original',
    currency: 'usd',
    total: 2500,
    amount_paid: 2500,
    attempt_count: 1,
    // Deliberately different from the recurring service period.
    period_start: 1772323200,
    period_end: 1775001600,
    parent: {
      type: 'subscription_details',
      subscription_details: { subscription: 'stripe-original' },
    },
    metadata: metadata(),
    lines: { object: 'list', data: [recurringLine()], has_more: false },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.transactions.length = 0
  state.transaction.mockImplementation(async (callback: (tx: object) => Promise<unknown>) => {
    const query = {
      where: () => query,
      for: () => query,
      limit: () => state.lookup(),
    }
    const tx = { ordinal: state.transactions.length, select: () => ({ from: () => query }) }
    state.transactions.push(tx)
    return callback(tx)
  })
  state.read.mockImplementation(
    async (_db: unknown, requestedNamespace: string, requestedKey: string) =>
      requestedNamespace === namespace && requestedKey === key ? intent : null
  )
  state.readSubscription.mockResolvedValue(null)
  state.register.mockResolvedValue({ ...bound, intent: { ...intent, subtype: 'subscription' } })
  state.lookup.mockResolvedValue([
    {
      id: 'local-original',
      referenceType: 'user',
      referenceId: 'original-owner',
      status: 'active',
      stripeSubscriptionId: 'stripe-original',
      stripeCustomerId: 'customer-original',
      periodStart: new Date(period.start!),
      periodEnd: new Date(period.end!),
    },
  ])
  state.lock.mockResolvedValue(undefined)
  state.accept.mockResolvedValue(undefined)
  state.acknowledge.mockResolvedValue(undefined)
})

describe('signed original financial invoice binding', () => {
  it('accepts payment on the original retained period without resolving today’s owner or resetting usage', async () => {
    const original = structuredClone(intent)
    await handleInvoicePaymentSucceeded(signed(invoice()))
    expect(state.read).toHaveBeenCalledExactlyOnceWith(db, namespace, key)
    expect(state.accept).toHaveBeenCalledExactlyOnceWith(state.transactions[0], {
      namespace,
      key,
      invoiceId: 'in_original',
      customerId: 'customer-original',
      amountCents: '2500',
      currency: 'usd',
      fingerprint: intent.fingerprint,
      period,
      paid: true,
      notifyFailure: true,
    })
    expect(intent).toEqual(original)
    expect(state.lookup).not.toHaveBeenCalled()
    expect(state.register).not.toHaveBeenCalled()
    expect(state.acknowledge).not.toHaveBeenCalled()
  })
  it.each([1, 2])(
    'delegates failure to the original debt and records only the first notification fact (%s)',
    async (attempt_count) => {
      await handleInvoicePaymentFailed(
        signed(invoice({ status: 'open', attempt_count }), 'invoice.payment_failed')
      )
      expect(state.accept).toHaveBeenCalledExactlyOnceWith(
        state.transactions[0],
        expect.objectContaining({
          namespace,
          key,
          paid: false,
          period,
          amountCents: '2500',
          notifyFailure: attempt_count === 1,
        })
      )
      expect(state.lookup).not.toHaveBeenCalled()
    }
  )
  it('marks issuance separately from payment acceptance', async () => {
    await handleInvoiceFinalized(signed(invoice({ status: 'open' }), 'invoice.finalized'))
    expect(state.acknowledge).toHaveBeenCalledExactlyOnceWith(
      state.transactions[0],
      namespace,
      key,
      'in_original'
    )
    expect(state.accept).not.toHaveBeenCalled()
    expect(state.register).not.toHaveBeenCalled()
  })
  it.each([
    { customer: 'different-customer' },
    { total: 2501 },
    { total: -1 },
    { currency: 'eur' },
    { id: 'different-invoice' },
    { metadata: { ...metadata(), financialFingerprint: 'different-fingerprint' } },
    { metadata: { ...metadata(), subscriptionId: 'new-subscription' } },
    { metadata: { ...metadata(), periodStart: '2026-05-01T00:00:00.000Z' } },
    { metadata: { ...metadata(), periodEnd: '2026-06-01T00:00:00.000Z' } },
    { metadata: { ...metadata(), financialNamespace: 'billing-usage:user:different-owner' } },
    { metadata: { ...metadata(), financialKey: 'new-key' } },
  ])('refuses mismatched signed financial references: %j', async (override) => {
    await expect(handleInvoicePaymentSucceeded(signed(invoice(override)))).rejects.toThrow()
    expect(state.accept).not.toHaveBeenCalled()
    expect(state.acknowledge).not.toHaveBeenCalled()
    expect(state.register).not.toHaveBeenCalled()
  })
  it('refuses incomplete overage references rather than treating them as a regular invoice', async () => {
    await expect(
      handleInvoicePaymentSucceeded(
        signed(invoice({ metadata: { type: 'overage_billing', financialNamespace: namespace } }))
      )
    ).rejects.toThrow('incomplete original financial references')
    expect(state.readSubscription).not.toHaveBeenCalled()
    expect(state.accept).not.toHaveBeenCalled()
  })
  it('requires an accepted original intent and a paid status for success', async () => {
    state.read.mockResolvedValue(null)
    await expect(handleInvoicePaymentSucceeded(signed(invoice()))).rejects.toThrow(
      'no accepted original intent'
    )
    await expect(
      handleInvoicePaymentSucceeded(signed(invoice({ status: 'open' })))
    ).rejects.toThrow('does not prove a paid invoice')
    expect(state.accept).not.toHaveBeenCalled()
  })
  it.each([2500.5, Number.MAX_SAFE_INTEGER + 1])(
    'refuses fractional/unsafe provider cents before acceptance (%s)',
    async (total) => {
      await expect(handleInvoicePaymentSucceeded(signed(invoice({ total })))).rejects.toThrow(
        'safe signed integer'
      )
      expect(state.accept).not.toHaveBeenCalled()
    }
  )
  it('keeps financial acceptance failures visible without a second write or network path', async () => {
    state.accept.mockRejectedValue(
      new Error('Another original debt keeps financial closure blocked')
    )
    await expect(handleInvoicePaymentSucceeded(signed(invoice()))).rejects.toThrow(
      'Another original debt'
    )
    expect(state.accept).toHaveBeenCalledOnce()
    expect(state.transaction).toHaveBeenCalledOnce()
    expect(state.acknowledge).not.toHaveBeenCalled()
  })
})

describe('signed ordinary subscription invoices', () => {
  it('uses retained invoice binding without consulting a replacement subscription', async () => {
    state.readSubscription.mockResolvedValue({
      ...bound,
      intent: { ...intent, subtype: 'subscription' },
    })
    await handleInvoicePaymentSucceeded(signed(invoice({ metadata: {} })))
    expect(state.readSubscription).toHaveBeenCalledExactlyOnceWith(db, 'in_original')
    expect(state.lookup).not.toHaveBeenCalled()
    expect(state.register).not.toHaveBeenCalled()
    expect(state.accept).toHaveBeenCalledWith(
      state.transactions[0],
      expect.objectContaining({ period, amountCents: '2500', fingerprint: intent.fingerprint })
    )
  })
  it.each([
    { data: [recurringLine(1775088000, 1777593600)], has_more: false },
    { data: [recurringLine(1775001600, 1777680000)], has_more: false },
    { data: [recurringLine()], has_more: true },
    { data: [], has_more: false },
  ])(
    'revalidates original recurring service evidence for a retained invoice: %j',
    async (lines) => {
      state.readSubscription.mockResolvedValue({
        ...bound,
        intent: { ...intent, subtype: 'subscription' },
      })
      await expect(
        handleInvoicePaymentSucceeded(signed(invoice({ metadata: {}, lines })))
      ).rejects.toThrow()
      expect(state.lookup).not.toHaveBeenCalled()
      expect(state.register).not.toHaveBeenCalled()
      expect(state.accept).not.toHaveBeenCalled()
      expect(state.transaction).not.toHaveBeenCalled()
    }
  )
  it('registers the complete recurring line service period on the original root, not invoice lookback', async () => {
    await handleInvoicePaymentSucceeded(
      signed(invoice({ metadata: { userId: 'forged-new-owner' } }))
    )
    expect(state.lookup).toHaveBeenCalledTimes(2)
    expect(state.lock).toHaveBeenNthCalledWith(1, state.transactions[0], [
      { type: 'user', id: 'original-owner' },
    ])
    expect(state.lock).toHaveBeenNthCalledWith(2, state.transactions[1], [
      { type: 'user', id: 'original-owner' },
    ])
    expect(state.register).toHaveBeenCalledExactlyOnceWith(state.transactions[0], {
      root: { type: 'user', id: 'original-owner' },
      period,
      invoiceId: 'in_original',
      amountCents: '2500',
      currency: 'usd',
    })
    expect(state.accept).toHaveBeenCalledWith(
      state.transactions[1],
      expect.objectContaining({ namespace, key, period, amountCents: '2500' })
    )
    expect(state.transactions).toHaveLength(2)
  })
  it.each([
    { lines: { data: [recurringLine()], has_more: true } },
    { lines: { data: [], has_more: false } },
    { lines: { data: [recurringLine(), recurringLine(1777593600, 1780272000)], has_more: false } },
    { lines: { data: [recurringLine(-1, 1777593600)], has_more: false } },
  ])('refuses incomplete, ambiguous or invalid service periods: %j', async (override) => {
    await expect(
      handleInvoicePaymentSucceeded(signed(invoice({ metadata: {}, ...override })))
    ).rejects.toThrow()
    expect(state.register).not.toHaveBeenCalled()
    expect(state.accept).not.toHaveBeenCalled()
  })
  it('does not reset or charge through another path after canonical registration failure', async () => {
    state.register.mockRejectedValue(new Error('Original closing monetary basis is missing'))
    await expect(handleInvoicePaymentSucceeded(signed(invoice({ metadata: {} })))).rejects.toThrow(
      'Original closing monetary basis'
    )
    expect(state.accept).not.toHaveBeenCalled()
    expect(state.register).toHaveBeenCalledOnce()
  })
  it('ignores an unrelated one-off invoice without creating a financial identity', async () => {
    await handleInvoicePaymentSucceeded(signed(invoice({ metadata: {}, parent: null })))
    expect(state.lookup).not.toHaveBeenCalled()
    expect(state.transaction).not.toHaveBeenCalled()
    expect(state.accept).not.toHaveBeenCalled()
  })
})

function prorationLine(
  kind: 'subscription_item_details' | 'invoice_item_details' = 'subscription_item_details',
  start = 1776211200,
  end = 1777593600,
  creditedInvoice?: string
) {
  return {
    id: 'line_adjustment',
    object: 'line_item',
    amount: -500,
    period: { start, end },
    parent: {
      type: kind,
      [kind]: {
        subscription: 'stripe-original',
        subscription_item: 'item_original',
        invoice_item: 'invoice_item_original',
        proration: true,
        proration_details: creditedInvoice
          ? { credited_items: { invoice: creditedInvoice, invoice_line_items: ['line_credit'] } }
          : null,
      },
    },
  }
}
const head = (current: Period, previous: Period | null = null) => ({
  recordType: 'period-head',
  root: intent.root,
  current,
  previous,
})
const basis = (original: Period, closing = false) => ({
  recordType: 'period',
  root: intent.root,
  period: original,
  closing: closing
    ? {
        mode: 'user',
        acceptedUsd: '0',
        copilotUsd: '0',
        memberUsd: {},
        allowanceUsd: '40',
        frozenAt: '2026-05-01T00:00:00.000Z',
      }
    : null,
})
function financialBasis(current = period, previous: Period | null = null) {
  state.read.mockImplementation(async (_tx: unknown, _namespace: string, requested: string) => {
    if (requested === 'period-head') return head(current, previous)
    if (requested === policyPeriodKey(current)) return basis(current)
    if (previous && requested === policyPeriodKey(previous)) return basis(previous, true)
    return null
  })
}

describe('signed recurring anchors and original proration basis', () => {
  it.each(['unpaid', 'paused'])(
    'registers exact-current proration-only debt using canonical suspended authority during %s',
    async (status) => {
      state.lookup.mockResolvedValue([
        {
          id: period.subscriptionId,
          referenceType: 'user',
          referenceId: intent.root.id,
          stripeSubscriptionId: period.stripeSubscriptionId,
          stripeCustomerId: period.customerId,
          periodStart: new Date(period.start!),
          periodEnd: new Date(period.end!),
          status,
        },
      ])
      state.read.mockImplementation(async (_tx: unknown, _namespace: string, key: string) => {
        if (key === 'period-head') return head(period)
        if (key === policyPeriodKey(period))
          return {
            ...basis(period),
            suspension: {
              allowanceUsd: '40',
              mode: 'user',
              defaultGrant: false,
              capturedAt: '2026-04-15T00:00:00.000Z',
            },
          }
        return null
      })
      await handleInvoiceFinalized(
        signed(
          invoice({ metadata: {}, lines: { data: [prorationLine()], has_more: false } }),
          'invoice.finalized'
        )
      )
      expect(state.register).toHaveBeenCalledWith(
        state.transactions[0],
        expect.objectContaining({ period, amountCents: '2500' })
      )
      expect(state.accept).not.toHaveBeenCalled()
    }
  )
  for (const path of ['new', 'retained'] as const) {
    for (const kind of ['mixed', 'proration-only'] as const) {
      for (const event of [
        'invoice.finalized',
        'invoice.payment_failed',
        'invoice.payment_succeeded',
        'invoice.paid',
      ] as const) {
        it(`handles ${path} ${kind} ${event} without changing the full signed amount`, async () => {
          if (path === 'retained')
            state.readSubscription.mockResolvedValue({
              ...bound,
              intent: { ...intent, subtype: 'subscription' },
            })
          const adjustment = prorationLine(
            'invoice_item_details',
            kind === 'mixed' ? 1773532800 : 1776211200,
            kind === 'mixed' ? 1775001600 : 1777593600
          )
          const data =
            kind === 'mixed'
              ? [adjustment, recurringLine(), { ...recurringLine(), id: 'line_same_period' }]
              : [adjustment]
          const value = signed(
            invoice({
              metadata: {},
              status: ['invoice.paid', 'invoice.payment_succeeded'].includes(event)
                ? 'paid'
                : 'open',
              lines: { data, has_more: false },
            }),
            event
          )
          if (event === 'invoice.finalized') await handleInvoiceFinalized(value)
          else if (event === 'invoice.payment_failed') await handleInvoicePaymentFailed(value)
          else await handleInvoicePaymentSucceeded(value)
          if (path === 'new')
            expect(state.register).toHaveBeenCalledWith(
              state.transactions[0],
              expect.objectContaining({ period, amountCents: '2500', currency: 'usd' })
            )
          else {
            expect(state.lookup).not.toHaveBeenCalled()
            expect(state.register).not.toHaveBeenCalled()
          }
          if (event === 'invoice.finalized') {
            expect(state.accept).not.toHaveBeenCalled()
            expect(state.acknowledge).not.toHaveBeenCalled()
          } else
            expect(state.accept).toHaveBeenCalledWith(
              expect.anything(),
              expect.objectContaining({
                period,
                amountCents: '2500',
                paid: ['invoice.paid', 'invoice.payment_succeeded'].includes(event),
              })
            )
        })
      }
    }
  }
  it.each(['subscription_item_details', 'invoice_item_details'] as const)(
    'resolves %s proration-only data to a proven original previous period',
    async (kind) => {
      const current = {
        ...period,
        start: '2026-05-01T00:00:00.000Z',
        end: '2026-06-01T00:00:00.000Z',
      }
      state.lookup.mockResolvedValue([
        {
          id: period.subscriptionId,
          referenceType: 'user',
          referenceId: intent.root.id,
          stripeSubscriptionId: period.stripeSubscriptionId,
          stripeCustomerId: period.customerId,
          periodStart: new Date(current.start),
          periodEnd: new Date(current.end),
        },
      ])
      financialBasis(current, period)
      await handleInvoiceFinalized(
        signed(
          invoice({ metadata: {}, lines: { data: [prorationLine(kind)], has_more: false } }),
          'invoice.finalized'
        )
      )
      expect(state.register).toHaveBeenCalledWith(
        state.transactions[0],
        expect.objectContaining({ period })
      )
    }
  )
  it('uses a positively linked older original invoice and closing basis rather than a replacement period', async () => {
    const older = { ...period, start: '2026-02-01T00:00:00.000Z', end: '2026-03-01T00:00:00.000Z' }
    financialBasis()
    const read = state.read.getMockImplementation()!
    state.read.mockImplementation((tx, ns, requested) =>
      requested === policyPeriodKey(older)
        ? Promise.resolve(basis(older, true))
        : read(tx, ns, requested)
    )
    state.readSubscription.mockImplementation(async (_tx, id) =>
      id === 'in_credited'
        ? { ...bound, intent: { ...intent, subtype: 'subscription', period: older, invoiceId: id } }
        : null
    )
    await handleInvoiceFinalized(
      signed(
        invoice({
          metadata: {},
          lines: {
            data: [prorationLine('invoice_item_details', 1771113600, 1772323200, 'in_credited')],
            has_more: false,
          },
        }),
        'invoice.finalized'
      )
    )
    expect(state.register).toHaveBeenCalledWith(
      state.transactions[0],
      expect.objectContaining({ period: older })
    )
  })
  it('requires a closing basis for a previous period and never manufactures it from partial dates', async () => {
    const current = {
      ...period,
      start: '2026-05-01T00:00:00.000Z',
      end: '2026-06-01T00:00:00.000Z',
    }
    financialBasis(current, period)
    const read = state.read.getMockImplementation()!
    state.read.mockImplementation((tx, ns, requested) =>
      requested === policyPeriodKey(period)
        ? Promise.resolve(basis(period))
        : read(tx, ns, requested)
    )
    await expect(
      handleInvoiceFinalized(
        signed(
          invoice({ metadata: {}, lines: { data: [prorationLine()], has_more: false } }),
          'invoice.finalized'
        )
      )
    ).rejects.toThrow('closing basis')
    expect(state.register).not.toHaveBeenCalled()
  })
  it('refuses a missing current basis instead of repairing an existing head', async () => {
    state.read.mockResolvedValue(head(period))
    await expect(
      handleInvoiceFinalized(
        signed(
          invoice({ metadata: {}, lines: { data: [prorationLine()], has_more: false } }),
          'invoice.finalized'
        )
      )
    ).rejects.toThrow()
    expect(state.register).not.toHaveBeenCalled()
  })
  it('refuses two proven complete periods containing the same adjustment', async () => {
    financialBasis(period, {
      ...period,
      start: '2026-04-10T00:00:00.000Z',
      end: '2026-05-10T00:00:00.000Z',
    })
    await expect(
      handleInvoiceFinalized(
        signed(
          invoice({
            metadata: {},
            lines: {
              data: [prorationLine('invoice_item_details', 1776211200, 1776297600)],
              has_more: false,
            },
          }),
          'invoice.finalized'
        )
      )
    ).rejects.toThrow('ambiguous')
    expect(state.register).not.toHaveBeenCalled()
  })
  it('reuses a concurrently retained original binding under its owning transaction', async () => {
    state.readSubscription
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...bound, intent: { ...intent, subtype: 'subscription' } })
    await handleInvoicePaymentSucceeded(
      signed(invoice({ metadata: {}, lines: { data: [prorationLine()], has_more: false } }))
    )
    expect(state.register).not.toHaveBeenCalled()
    expect(state.accept).toHaveBeenCalledWith(
      state.transactions[1],
      expect.objectContaining({ period })
    )
  })
  it.each([
    {
      lines: {
        data: [prorationLine('invoice_item_details', 1773532800, 1775001600)],
        has_more: false,
      },
    },
    { lines: { data: [prorationLine()], has_more: true } },
    { lines: { data: [recurringLine(), recurringLine(1777593600, 1780272000)], has_more: false } },
    {
      lines: {
        data: [{ ...recurringLine(), subscription: 'different-subscription' }],
        has_more: false,
      },
    },
    {
      lines: {
        data: [{ ...prorationLine(), parent: null, subscription: 'stripe-original' }],
        has_more: false,
      },
    },
    {
      lines: {
        data: [prorationLine('invoice_item_details', 1777593600, 1776211200)],
        has_more: false,
      },
    },
    {
      lines: {
        data: [prorationLine('invoice_item_details', 9007199254740, 9007199254741)],
        has_more: false,
      },
    },
    {
      lines: {
        data: [
          {
            ...prorationLine(),
            parent: {
              type: 'invoice_item_details',
              invoice_item_details: { subscription: 'stripe-original', proration: 'false' },
            },
          },
        ],
        has_more: false,
      },
    },
    { customer: 'replacement-customer' },
    { total: -1.5 },
  ])('refuses unproven, malformed or changed proration evidence %j', async (override) => {
    await expect(
      handleInvoicePaymentSucceeded(
        signed(
          invoice({
            metadata: {},
            lines: { data: [prorationLine()], has_more: false },
            ...override,
          })
        )
      )
    ).rejects.toThrow()
    expect(state.register).not.toHaveBeenCalled()
    expect(state.accept).not.toHaveBeenCalled()
  })
})

describe('original proration provenance refuses corruption', () => {
  it('does not accept an ambiguous original subscription lookup', async () => {
    const originals = await state.lookup()
    state.lookup.mockResolvedValue([originals[0], { ...originals[0], id: 'ambiguous-original' }])
    await expect(
      handleInvoiceFinalized(
        signed(
          invoice({ metadata: {}, lines: { data: [prorationLine()], has_more: false } }),
          'invoice.finalized'
        )
      )
    ).rejects.toThrow('missing or ambiguous')
    expect(state.register).not.toHaveBeenCalled()
  })
  it('requires closing provenance when the original current subscription is canceled', async () => {
    const originals = await state.lookup()
    state.lookup.mockResolvedValue([{ ...originals[0], status: 'canceled' }])
    financialBasis()
    await expect(
      handleInvoiceFinalized(
        signed(
          invoice({ metadata: {}, lines: { data: [prorationLine()], has_more: false } }),
          'invoice.finalized'
        )
      )
    ).rejects.toThrow('closing basis')
    expect(state.register).not.toHaveBeenCalled()
  })
  it.each([
    { mode: 'unknown', frozenAt: '2026-05-01T00:00:00.000Z' },
    { mode: 'user', frozenAt: 'unknown' },
  ])('refuses malformed closing provenance %j', async (closing) => {
    financialBasis()
    state.read.mockImplementation(async (_tx, _namespace, requested) =>
      requested === 'period-head'
        ? head(period)
        : requested === policyPeriodKey(period)
          ? { ...basis(period, true), closing: { ...basis(period, true).closing, ...closing } }
          : null
    )
    await expect(
      handleInvoiceFinalized(
        signed(
          invoice({ metadata: {}, lines: { data: [prorationLine()], has_more: false } }),
          'invoice.finalized'
        )
      )
    ).rejects.toThrow('closing basis')
    expect(state.register).not.toHaveBeenCalled()
  })
  it('refuses a credited invoice from another original financial owner', async () => {
    financialBasis()
    state.readSubscription.mockImplementation(async (_tx, id) =>
      id === 'in_foreign_credit'
        ? {
            ...bound,
            intent: {
              ...intent,
              subtype: 'subscription',
              root: { type: 'user', id: 'different-owner' },
            },
          }
        : null
    )
    await expect(
      handleInvoiceFinalized(
        signed(
          invoice({
            metadata: {},
            lines: {
              data: [
                prorationLine('invoice_item_details', 1776211200, 1777593600, 'in_foreign_credit'),
              ],
              has_more: false,
            },
          }),
          'invoice.finalized'
        )
      )
    ).rejects.toThrow('Credited invoice original')
    expect(state.register).not.toHaveBeenCalled()
  })
})

describe('signed settlement original-root ownership', () => {
  it('awaits the owning original-root lock before canonical settlement reads or writes', async () => {
    let release!: () => void
    state.lock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const settled = handleInvoicePaymentFailed(
      signed(invoice({ status: 'open' }), 'invoice.payment_failed')
    )
    await vi.waitFor(() =>
      expect(state.lock).toHaveBeenCalledExactlyOnceWith(state.transactions[0], [intent.root])
    )
    expect(state.accept).not.toHaveBeenCalled()
    release()
    await settled
    expect(state.accept).toHaveBeenCalledExactlyOnceWith(
      state.transactions[0],
      expect.objectContaining({ namespace, key, paid: false })
    )
  })
  it('leaves already closed duplicate handling to canonical readback without a new target lock', async () => {
    state.read.mockResolvedValue({ ...intent, invoiceObligationState: 'closed' })
    await handleInvoicePaymentSucceeded(signed(invoice()))
    expect(state.lock).not.toHaveBeenCalled()
    expect(state.accept).toHaveBeenCalledExactlyOnceWith(
      state.transactions[0],
      expect.objectContaining({ namespace, key, paid: true })
    )
  })
})

const creditEvents = [
  'invoice.paid',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'invoice.finalized',
] as const
function dispatchSignedCredit(
  value: ReturnType<typeof invoice>,
  type: (typeof creditEvents)[number]
) {
  const event = signed(value, type)
  return type === 'invoice.finalized'
    ? handleInvoiceFinalized(event)
    : type === 'invoice.payment_failed'
      ? handleInvoicePaymentFailed(event)
      : handleInvoicePaymentSucceeded(event)
}
function creditInvoice(overrides: Record<string, unknown> = {}) {
  return invoice({
    metadata: {},
    total: -500,
    amount_paid: 0,
    lines: { data: [prorationLine()], has_more: false },
    ...overrides,
  })
}
function noDebitCalls() {
  expect(state.register).not.toHaveBeenCalled()
  expect(state.accept).not.toHaveBeenCalled()
  expect(state.acknowledge).not.toHaveBeenCalled()
}
describe('verified provider-credit classification without local debit', () => {
  for (const kind of ['subscription_item_details', 'invoice_item_details'] as const) {
    it.each(creditEvents)(
      `classifies signed %s with ${kind} using exact signed evidence without a monetary callback`,
      async (type) => {
        financialBasis()
        const value = creditInvoice({
          status: type === 'invoice.paid' || type === 'invoice.payment_succeeded' ? 'paid' : 'open',
          parent: {
            type: 'subscription_details',
            subscription_details: { subscription: { id: 'stripe-original' } },
          },
          lines: { data: [prorationLine(kind)], has_more: false },
        })
        const before = structuredClone(value)
        await expect(dispatchSignedCredit(value, type)).resolves.toEqual({
          kind: 'verified-provider-credit',
          disposition: 'no-local-debit',
          invoiceId: value.id,
          root: intent.root,
          period,
          currency: 'usd',
          signedTotalCents: '-500',
          creditedInvoiceIds: [],
        })
        expect(value).toEqual(before)
        expect(state.lock).toHaveBeenCalledExactlyOnceWith(state.transactions[0], [intent.root])
        expect(state.readSubscription).toHaveBeenCalledTimes(2)
        noDebitCalls()
      }
    )
  }
  it.each([-1, -Number.MAX_SAFE_INTEGER])(
    'retains safe signed TOTAL %s without abs/zero replacement',
    async (total) => {
      financialBasis()
      await expect(
        dispatchSignedCredit(creditInvoice({ total }), 'invoice.finalized')
      ).resolves.toMatchObject({
        kind: 'verified-provider-credit',
        signedTotalCents: String(total),
      })
      noDebitCalls()
    }
  )
  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -0.5,
    Number.MIN_SAFE_INTEGER - 1,
    Number.MAX_SAFE_INTEGER + 1,
    undefined,
    null,
    '-500',
  ])('refuses malformed provider TOTAL %s rather than acknowledging credit', async (total) => {
    financialBasis()
    // JSON signing normalizes NaN/infinities to null; no claim that JSON transported NaN.
    await expect(
      dispatchSignedCredit(creditInvoice({ total }), 'invoice.finalized')
    ).rejects.toThrow('safe signed integer')
    noDebitCalls()
  })
  it('keeps the paid-status guard ahead of credit classification', async () => {
    financialBasis()
    await expect(
      dispatchSignedCredit(creditInvoice({ status: 'open' }), 'invoice.paid')
    ).rejects.toThrow('does not prove a paid invoice')
    expect(state.transaction).not.toHaveBeenCalled()
    noDebitCalls()
  })
  it.each([0, 3500])(
    'keeps mixed negative lines with nonnegative TOTAL %s on the exact debit path',
    async (total) => {
      financialBasis()
      state.register.mockImplementation(async (_tx, input) => ({
        ...bound,
        intent: { ...intent, subtype: 'subscription', amountCents: input.amountCents },
      }))
      const outcome = await dispatchSignedCredit(
        creditInvoice({
          total,
          lines: { data: [{ ...prorationLine(), amount: 4000 }, prorationLine()], has_more: false },
        }),
        'invoice.payment_succeeded'
      )
      expect(outcome).toBeUndefined()
      expect(state.register).toHaveBeenCalledExactlyOnceWith(
        state.transactions[0],
        expect.objectContaining({ amountCents: String(total), period })
      )
      expect(state.accept).toHaveBeenCalledExactlyOnceWith(
        state.transactions[1],
        expect.objectContaining({ amountCents: String(total), paid: true })
      )
    }
  )
  it('classifies an exact recurring anchor with carried credit adjustments without replacing its service period', async () => {
    financialBasis()
    const value = creditInvoice({
      lines: {
        data: [recurringLine(), prorationLine('invoice_item_details', 1773532800, 1775001600)],
        has_more: false,
      },
    })
    await expect(dispatchSignedCredit(value, 'invoice.finalized')).resolves.toMatchObject({
      kind: 'verified-provider-credit',
      period,
    })
    noDebitCalls()
  })
  it('classifies only the exact entitled current original row when no financial head exists, without seeding', async () => {
    await expect(dispatchSignedCredit(creditInvoice(), 'invoice.finalized')).resolves.toMatchObject(
      { kind: 'verified-provider-credit', period }
    )
    noDebitCalls()
  })
  it('refuses no-head credit authority when the original subscription is no longer entitled', async () => {
    const rows = await state.lookup()
    state.lookup.mockResolvedValue([{ ...rows[0], status: 'canceled' }])
    await expect(dispatchSignedCredit(creditInvoice(), 'invoice.finalized')).rejects.toThrow(
      'basis is missing'
    )
    noDebitCalls()
  })
  it('keeps existing financial overage authority ahead of negative credit routing', async () => {
    await expect(
      dispatchSignedCredit(invoice({ total: -500 }), 'invoice.payment_succeeded')
    ).rejects.toThrow('original financial binding mismatch')
    expect(state.readSubscription).not.toHaveBeenCalled()
    noDebitCalls()
  })
  it('refuses negative drift of an already retained nonnegative subscription debit', async () => {
    state.readSubscription.mockResolvedValue({
      ...bound,
      intent: { ...intent, subtype: 'subscription' },
    })
    await expect(dispatchSignedCredit(creditInvoice(), 'invoice.finalized')).rejects.toThrow(
      'Retained signed subscription invoice binding mismatch'
    )
    expect(state.transaction).not.toHaveBeenCalled()
    noDebitCalls()
  })
  it('rereads retained debit after awaiting the owning root before any credit outcome', async () => {
    let entered!: () => void
    let release!: () => void
    const ready = new Promise<void>((resolve) => {
      entered = resolve
    })
    const proceed = new Promise<void>((resolve) => {
      release = resolve
    })
    state.lock.mockImplementationOnce(async () => {
      entered()
      await proceed
    })
    state.readSubscription
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...bound, intent: { ...intent, subtype: 'subscription' } })
    const running = dispatchSignedCredit(creditInvoice(), 'invoice.finalized')
    const rejected = expect(running).rejects.toThrow(
      'Retained signed subscription invoice binding mismatch'
    )
    await ready
    expect(state.readSubscription).toHaveBeenCalledOnce()
    noDebitCalls()
    release()
    await rejected
    expect(state.readSubscription).toHaveBeenCalledTimes(2)
    noDebitCalls()
  })
  it.each([
    { currency: 'eur' },
    { customer: 'replacement-customer' },
    { lines: { data: [prorationLine()], has_more: true } },
    { lines: { data: [recurringLine(), recurringLine(1777593600, 1780272000)], has_more: false } },
    {
      lines: {
        data: [{ ...prorationLine(), subscription: 'different-subscription' }],
        has_more: false,
      },
    },
  ])('refuses invalid original credit scope/evidence %j', async (override) => {
    financialBasis()
    await expect(
      dispatchSignedCredit(creditInvoice(override), 'invoice.finalized')
    ).rejects.toThrow()
    noDebitCalls()
  })
  it('does not waive missing historical basis for a signed recurring credit anchor', async () => {
    financialBasis()
    const value = creditInvoice({
      lines: { data: [recurringLine(1772323200, 1775001600)], has_more: false },
    })
    await expect(dispatchSignedCredit(value, 'invoice.finalized')).rejects.toThrow(
      'basis is missing'
    )
    noDebitCalls()
  })
  it('keeps a foreign credited-invoice owner refusal even when a recurring anchor is present', async () => {
    financialBasis()
    state.readSubscription.mockImplementation(async (_tx, id) =>
      id === 'in_foreign_credit'
        ? {
            ...bound,
            intent: { ...intent, subtype: 'subscription', root: { type: 'user', id: 'foreign' } },
          }
        : null
    )
    const value = creditInvoice({
      lines: {
        data: [
          recurringLine(),
          prorationLine('invoice_item_details', 1776211200, 1777593600, 'in_foreign_credit'),
        ],
        has_more: false,
      },
    })
    await expect(dispatchSignedCredit(value, 'invoice.finalized')).rejects.toThrow(
      'Credited invoice original financial binding mismatch'
    )
    noDebitCalls()
  })
})

it('classifies a genuine original frozen previous-period credit without replacing it with the current subscription period', async () => {
  const current = { ...period, start: '2026-05-01T00:00:00.000Z', end: '2026-06-01T00:00:00.000Z' }
  const rows = await state.lookup()
  state.lookup.mockResolvedValue([
    {
      ...rows[0],
      status: 'canceled',
      periodStart: new Date(current.start),
      periodEnd: new Date(current.end),
    },
  ])
  financialBasis(current, period)
  await expect(dispatchSignedCredit(creditInvoice(), 'invoice.finalized')).resolves.toMatchObject({
    kind: 'verified-provider-credit',
    period,
    signedTotalCents: '-500',
  })
  noDebitCalls()
})
