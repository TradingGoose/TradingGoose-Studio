import { beforeEach, describe, expect, it, vi } from 'vitest'

const { cancel, deleteInvoice, getSubscription, renewalEligibility, voidInvoice } = vi.hoisted(
  () => ({
    cancel: vi.fn(),
    deleteInvoice: vi.fn(),
    getSubscription: vi.fn(),
    renewalEligibility: vi.fn(),
    voidInvoice: vi.fn(),
  })
)

vi.mock('@/lib/billing/core/subscription', () => ({
  getSubscriptionByStripeSubscriptionId: getSubscription,
}))

vi.mock('@/lib/billing/tier-availability-policy', () => ({
  evaluateSubscriptionTierRenewalEligibility: renewalEligibility,
}))

vi.mock('@/lib/billing/stripe-client', () => ({
  requireStripeClient: () => ({
    invoices: {
      del: deleteInvoice,
      voidInvoice,
    },
    subscriptions: {
      cancel,
    },
  }),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

function createEvent(status: string | null = 'draft') {
  return {
    id: 'evt_renewal',
    data: {
      object: {
        id: 'in_renewal',
        billing_reason: 'subscription_cycle',
        status,
        parent: {
          subscription_details: {
            subscription: 'sub_renewal',
          },
        },
      },
    },
  }
}

describe('handleInvoiceCreated renewal rejection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSubscription.mockResolvedValue({
      id: 'local-subscription',
      referenceType: 'user',
      referenceId: 'user-1',
      status: 'active',
      tier: { id: 'tier-private', status: 'archived' },
    })
    renewalEligibility.mockReturnValue({ isRenewable: false })
    deleteInvoice.mockResolvedValue({})
    voidInvoice.mockResolvedValue({})
    cancel.mockResolvedValue({})
  })

  it('cancels before deleting a draft invoice with stable idempotency keys', async () => {
    const { handleInvoiceCreated } = await import('./invoices')

    await handleInvoiceCreated(createEvent('draft') as any)

    expect(deleteInvoice).toHaveBeenCalledWith('in_renewal', {
      idempotencyKey: 'renewal-rejection:delete:in_renewal',
    })
    expect(cancel).toHaveBeenCalledWith('sub_renewal', {
      idempotencyKey: 'renewal-rejection:cancel:sub_renewal:in_renewal',
    })
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(
      deleteInvoice.mock.invocationCallOrder[0]
    )
  })

  it('throws after cancellation when draft invoice suppression fails', async () => {
    deleteInvoice.mockRejectedValue(new Error('Stripe delete failed'))
    const { handleInvoiceCreated } = await import('./invoices')

    await expect(handleInvoiceCreated(createEvent('draft') as any)).rejects.toThrow(
      'Stripe delete failed'
    )
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('cancels before voiding an open invoice', async () => {
    const { handleInvoiceCreated } = await import('./invoices')

    await handleInvoiceCreated(createEvent('open') as any)

    expect(voidInvoice).toHaveBeenCalledWith('in_renewal', {
      idempotencyKey: 'renewal-rejection:void:in_renewal',
    })
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(voidInvoice.mock.invocationCallOrder[0])
  })

  it('suppresses an already-canceled retry without canceling again', async () => {
    getSubscription.mockResolvedValue({
      id: 'local-subscription',
      referenceType: 'user',
      referenceId: 'user-1',
      status: 'canceled',
      tier: { id: 'tier-private', status: 'active' },
    })
    renewalEligibility.mockReturnValue({ isRenewable: true })
    const { handleInvoiceCreated } = await import('./invoices')

    await handleInvoiceCreated(createEvent('open') as any)

    expect(voidInvoice).toHaveBeenCalledOnce()
    expect(cancel).not.toHaveBeenCalled()
  })

  it('cancels void, paid, and unknown rejected renewals and reports terminal states', async () => {
    const { handleInvoiceCreated } = await import('./invoices')

    await handleInvoiceCreated(createEvent('void') as any)
    await expect(handleInvoiceCreated(createEvent('paid') as any)).rejects.toThrow(
      'was paid before availability enforcement'
    )
    await expect(handleInvoiceCreated(createEvent('uncollectible') as any)).rejects.toThrow(
      'Unsupported renewal invoice status: uncollectible'
    )

    expect(cancel).toHaveBeenCalledTimes(3)
  })

  it('rejects a missing tier but leaves an eligible active tier untouched', async () => {
    getSubscription.mockResolvedValueOnce({
      id: 'local-subscription',
      referenceType: 'user',
      referenceId: 'user-1',
      status: 'active',
      tier: null,
    })
    const { handleInvoiceCreated } = await import('./invoices')

    await handleInvoiceCreated(createEvent('void') as any)
    expect(cancel).toHaveBeenCalledOnce()

    vi.clearAllMocks()
    getSubscription.mockResolvedValue({
      id: 'local-subscription',
      referenceType: 'user',
      referenceId: 'user-1',
      status: 'active',
      tier: { id: 'tier-private', status: 'active', isPublic: false },
    })
    renewalEligibility.mockReturnValue({ isRenewable: true })

    await handleInvoiceCreated(createEvent('draft') as any)
    expect(deleteInvoice).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
  })
})

describe('handleInvoicePaymentSucceeded renewal rejection', () => {
  it('ignores void invoices before subscription or usage lookup', async () => {
    vi.clearAllMocks()
    const { handleInvoicePaymentSucceeded } = await import('./invoices')

    await handleInvoicePaymentSucceeded(createEvent('void') as any)

    expect(getSubscription).not.toHaveBeenCalled()
  })
})
