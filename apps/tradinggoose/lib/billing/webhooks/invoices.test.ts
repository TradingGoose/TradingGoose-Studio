import { beforeEach, describe, expect, it, vi } from 'vitest'

const { cancel, deleteInvoice, getSubscription, renewalEligibility, retrieveInvoice, voidInvoice } =
  vi.hoisted(() => ({
    cancel: vi.fn(),
    deleteInvoice: vi.fn(),
    getSubscription: vi.fn(),
    renewalEligibility: vi.fn(),
    retrieveInvoice: vi.fn(),
    voidInvoice: vi.fn(),
  }))

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
      retrieve: retrieveInvoice,
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
    retrieveInvoice.mockImplementation(async () => ({ status: 'draft' }))
    voidInvoice.mockResolvedValue({})
    cancel.mockResolvedValue({})
  })

  it('deletes a draft invoice before canceling its rejected renewal', async () => {
    const { handleInvoiceCreated } = await import('./invoices')

    await handleInvoiceCreated(createEvent('draft') as any)

    expect(cancel).toHaveBeenCalledWith('sub_renewal', {
      idempotencyKey: 'renewal-rejection:cancel:sub_renewal:in_renewal',
    })
    expect(deleteInvoice).toHaveBeenCalledWith('in_renewal', {
      idempotencyKey: 'renewal-rejection:delete:in_renewal',
    })
    expect(deleteInvoice.mock.invocationCallOrder[0]).toBeLessThan(
      cancel.mock.invocationCallOrder[0]
    )
    expect(voidInvoice).not.toHaveBeenCalled()
  }, 15_000)

  it('throws before cancellation when draft invoice deletion fails', async () => {
    deleteInvoice.mockRejectedValue(new Error('Stripe deletion failed'))
    const { handleInvoiceCreated } = await import('./invoices')

    await expect(handleInvoiceCreated(createEvent('draft') as any)).rejects.toThrow(
      'Stripe deletion failed'
    )
    expect(cancel).not.toHaveBeenCalled()
    expect(voidInvoice).not.toHaveBeenCalled()
  })

  it('voids an open invoice before canceling its rejected renewal', async () => {
    retrieveInvoice.mockResolvedValue({ status: 'open' })
    const { handleInvoiceCreated } = await import('./invoices')

    await handleInvoiceCreated(createEvent('open') as any)

    expect(voidInvoice).toHaveBeenCalledWith('in_renewal', {
      idempotencyKey: 'renewal-rejection:void:in_renewal',
    })
    expect(voidInvoice.mock.invocationCallOrder[0]).toBeLessThan(cancel.mock.invocationCallOrder[0])
  })

  it('suppresses an already-canceled retry without canceling again', async () => {
    retrieveInvoice.mockResolvedValue({ status: 'open' })
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

  it('suppresses and cancels a rejected renewal after local settlement removed the subscription', async () => {
    retrieveInvoice.mockResolvedValue({ status: 'open' })
    getSubscription.mockResolvedValue(null)
    renewalEligibility.mockReturnValue({ isRenewable: false })
    const { handleInvoiceCreated } = await import('./invoices')

    await handleInvoiceCreated(createEvent('open') as any)

    expect(voidInvoice).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
    expect(voidInvoice.mock.invocationCallOrder[0]).toBeLessThan(cancel.mock.invocationCallOrder[0])
  })

  it('cancels suppressed renewals and reports unsuppressible terminal states', async () => {
    retrieveInvoice
      .mockResolvedValueOnce({ status: 'void' })
      .mockResolvedValueOnce({ status: 'paid' })
      .mockResolvedValueOnce({ status: 'uncollectible' })
    const { handleInvoiceCreated } = await import('./invoices')

    await handleInvoiceCreated(createEvent('void') as any)
    await expect(handleInvoiceCreated(createEvent('paid') as any)).rejects.toThrow(
      'was paid before availability enforcement'
    )
    await expect(handleInvoiceCreated(createEvent('uncollectible') as any)).rejects.toThrow(
      'Unsupported renewal invoice status: uncollectible'
    )

    expect(cancel).toHaveBeenCalledOnce()
  })

  it('rejects a missing tier but leaves an eligible active tier untouched', async () => {
    retrieveInvoice.mockResolvedValue({ status: 'void' })
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

  it('retries cancellation without repeating suppression after a partial success', async () => {
    retrieveInvoice
      .mockResolvedValueOnce({ status: 'open' })
      .mockRejectedValueOnce(
        Object.assign(new Error('Missing invoice'), { code: 'resource_missing' })
      )
    cancel.mockRejectedValueOnce(new Error('Stripe cancellation failed')).mockResolvedValueOnce({})
    const { handleInvoiceCreated } = await import('./invoices')

    await expect(handleInvoiceCreated(createEvent('open') as any)).rejects.toThrow(
      'Stripe cancellation failed'
    )
    await handleInvoiceCreated(createEvent('open') as any)

    expect(voidInvoice).toHaveBeenCalledOnce()
    expect(deleteInvoice).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledTimes(2)
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
