/** @vitest-environment node */
import * as schema from '@tradinggoose/db/schema'
import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  options: null as unknown,
  select: vi.fn(),
  from: vi.fn(),
  transaction: vi.fn(),
  insert: vi.fn(),
  hydrate: vi.fn(),
  synchronize: vi.fn(),
  ledger: vi.fn(),
  welcome: vi.fn(),
  error: vi.fn(),
  order: [] as string[],
  rows: [] as unknown[],
  table: null as unknown,
  paid: vi.fn(),
  failed: vi.fn(),
  finalized: vi.fn(),
}))
vi.mock('@tradinggoose/db', () => ({
  db: {
    select: state.select,
    transaction: state.transaction,
    insert: state.insert,
    update: () => {
      throw new Error('Unexpected direct financial write')
    },
    delete: () => {
      throw new Error('Unexpected direct financial delete')
    },
  },
}))
vi.mock('better-auth', async (original) => ({
  ...(await original<typeof import('better-auth')>()),
  betterAuth: (options: unknown) => ({
    options,
    api: {
      signInEmail: () => {
        throw new Error('Auth actions are not part of this callback test')
      },
      signUpEmail: () => {
        throw new Error('Auth actions are not part of this callback test')
      },
      getSession: () => {
        throw new Error('Session actions are not part of this callback test')
      },
    },
    handler: () => {
      throw new Error('Auth handler is not part of this callback test')
    },
  }),
}))
vi.mock('@better-auth/stripe', () => ({
  stripe: (options: unknown) => {
    state.options = options
    return { id: 'stripe-fixture' }
  },
}))
vi.mock('@/lib/billing/financial-adapter', () => ({
  financialDrizzleAdapter: () => {
    throw new Error('Unexpected adapter initialization')
  },
}))
vi.mock('@/lib/billing/plans', () => ({ getBetterAuthPlansConfig: () => [] }))
vi.mock('@/lib/billing/webhooks/invoices', () => ({
  handleInvoicePaymentSucceeded: state.paid,
  handleInvoicePaymentFailed: state.failed,
  handleInvoiceFinalized: state.finalized,
}))
vi.mock('@/lib/billing', () => ({ sendBillingTierWelcomeEmail: state.welcome }))
vi.mock('@/lib/billing/core/usage', () => ({
  getEffectiveCurrentPeriodCost: state.ledger,
  handleNewUser: () => {
    throw new Error('No provisioning in subscription callbacks')
  },
}))
vi.mock('@/lib/billing/tiers', () => ({
  hydrateSubscriptionsWithTiers: state.hydrate,
  requireBillingTierById: vi.fn(),
}))
vi.mock('@/lib/billing/tiers/persistence', () => ({
  syncSubscriptionBillingTierFromStripeSubscription: state.synchronize,
}))
vi.mock('@/lib/system-services/stripe-runtime', () => ({
  createStripeClientProxy: () => ({}),
  getStripeServiceConfig: () => ({}),
  hasStripeSecretKey: () => false,
}))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: state.error }),
}))

import './auth'

type Subscription = {
  id: string
  referenceType: 'user' | 'organization'
  referenceId: string
  status: string
}
type Callbacks = {
  onSubscriptionComplete(input: {
    subscription: Subscription
    stripeSubscription: unknown
  }): Promise<void>
  onSubscriptionUpdate(input: {
    subscription: Subscription
    event: { data: { object: unknown } }
  }): Promise<void>
}
const callbacks = (state.options as { subscription: Callbacks }).subscription
const onEvent = (state.options as { onEvent(event: Stripe.Event): Promise<void> }).onEvent
const original: Subscription = {
  id: 'original-local',
  referenceType: 'user',
  referenceId: 'original-user',
  status: 'active',
}
const callbackSubscription: Subscription = {
  ...original,
  referenceId: 'untrusted-callback-reference',
}
const stripeSubscription = {
  id: 'stripe-original',
  metadata: { userId: 'untrusted-metadata-user' },
}
const complete = () =>
  callbacks.onSubscriptionComplete({ subscription: callbackSubscription, stripeSubscription })
const update = () =>
  callbacks.onSubscriptionUpdate({
    subscription: callbackSubscription,
    event: { data: { object: stripeSubscription } },
  })
beforeEach(() => {
  vi.clearAllMocks()
  state.order.length = 0
  state.rows = [original]
  state.table = schema.subscription
  state.from.mockImplementation((table) => {
    if (table !== state.table) throw new Error('No member fanout or unrelated lookup is permitted')
    return { where: () => ({ limit: async () => state.rows }) }
  })
  state.select.mockImplementation(() => ({ from: state.from }))
  state.transaction.mockImplementation(() => {
    throw new Error('No financial mutation in ledger read callback')
  })
  state.insert.mockImplementation(() => {
    throw new Error('No ledger repair in subscription callback')
  })
  state.synchronize.mockImplementation(async () => {
    state.order.push('tier')
  })
  state.hydrate.mockImplementation(async (rows) => {
    state.order.push('hydrate')
    return rows
  })
  state.ledger.mockImplementation(async () => {
    state.order.push('ledger')
    return '0.30000000000000001'
  })
  state.welcome.mockImplementation(async () => {
    state.order.push('welcome')
  })
})

describe('configured subscription callbacks use original personal ledger directly', () => {
  it('checks the hydrated original personal ledger before welcome email', async () => {
    await complete()
    expect(state.synchronize).toHaveBeenCalledExactlyOnceWith({
      subscriptionId: original.id,
      stripeSubscription,
    })
    expect(state.ledger).toHaveBeenCalledExactlyOnceWith('original-user')
    expect(state.welcome).toHaveBeenCalledExactlyOnceWith(original)
    expect(state.order).toEqual(['tier', 'hydrate', 'ledger', 'welcome'])
    expect(state.from).toHaveBeenCalledExactlyOnceWith(schema.subscription)
    expect(state.transaction).not.toHaveBeenCalled()
    expect(state.insert).not.toHaveBeenCalled()
  })
  it('refuses a missing personal ledger before welcome without provisioning or mutating it', async () => {
    const missing = new Error('Original user financial ledger is missing')
    state.ledger.mockRejectedValue(missing)
    await expect(complete()).rejects.toBe(missing)
    expect(state.ledger).toHaveBeenCalledExactlyOnceWith('original-user')
    expect(state.welcome).not.toHaveBeenCalled()
    expect(state.transaction).not.toHaveBeenCalled()
    expect(state.insert).not.toHaveBeenCalled()
  })
  it.each(['complete', 'update'])('does not fan out organization members on %s', async (kind) => {
    const organization = { ...original, referenceType: 'organization', referenceId: 'original-org' }
    state.rows = [organization]
    await (kind === 'complete' ? complete() : update())
    expect(state.ledger).not.toHaveBeenCalled()
    expect(state.from).toHaveBeenCalledExactlyOnceWith(schema.subscription)
    expect(state.insert).not.toHaveBeenCalled()
    expect(state.transaction).not.toHaveBeenCalled()
    if (kind === 'complete') expect(state.welcome).toHaveBeenCalledExactlyOnceWith(organization)
    else expect(state.welcome).not.toHaveBeenCalled()
  })
  it('checks the original personal ledger on update without a welcome email', async () => {
    await update()
    expect(state.ledger).toHaveBeenCalledExactlyOnceWith('original-user')
    expect(state.order).toEqual(['tier', 'hydrate', 'ledger'])
    expect(state.welcome).not.toHaveBeenCalled()
    expect(state.error).not.toHaveBeenCalled()
  })
  it('keeps update missing-ledger refusal in its existing caught/logged boundary', async () => {
    const missing = new Error('Original user financial ledger is missing')
    state.ledger.mockRejectedValue(missing)
    await expect(update()).resolves.toBeUndefined()
    expect(state.error).toHaveBeenCalledExactlyOnceWith(
      '[onSubscriptionUpdate] Original personal financial ledger is unavailable',
      {
        subscriptionId: original.id,
        referenceType: 'user',
        referenceId: 'original-user',
        error: missing,
      }
    )
    expect(state.welcome).not.toHaveBeenCalled()
    expect(state.insert).not.toHaveBeenCalled()
    expect(state.transaction).not.toHaveBeenCalled()
  })
  it.each(['complete', 'update'])(
    'keeps missing original hydration outside the %s ledger boundary',
    async (kind) => {
      state.hydrate.mockResolvedValue([])
      await expect(kind === 'complete' ? complete() : update()).rejects.toThrow(
        'could not be hydrated'
      )
      expect(state.ledger).not.toHaveBeenCalled()
      expect(state.welcome).not.toHaveBeenCalled()
    }
  )
})

describe('configured signed invoice event dispatch', () => {
  it.each(['invoice.paid', 'invoice.payment_succeeded'] as const)(
    'forwards %s unchanged to the existing paid handler',
    async (type) => {
      const event = { id: 'evt_original_invoice', type, data: { object: { id: 'in_original' } } }
      await onEvent(event as Stripe.Event)
      expect(state.paid).toHaveBeenCalledExactlyOnceWith(event)
      expect(state.failed).not.toHaveBeenCalled()
      expect(state.finalized).not.toHaveBeenCalled()
    }
  )
  it.each(['invoice.paid', 'invoice.payment_succeeded'] as const)(
    'propagates original settlement failure for %s instead of acknowledging it',
    async (type) => {
      const failure = new Error('Original invoice binding refused')
      state.paid.mockRejectedValueOnce(failure)
      const event = { id: 'evt_original_invoice', type, data: { object: { id: 'in_original' } } }
      await expect(onEvent(event as Stripe.Event)).rejects.toBe(failure)
      expect(state.paid).toHaveBeenCalledExactlyOnceWith(event)
      expect(state.error).toHaveBeenCalledWith(
        '[onEvent] Failed to process webhook',
        expect.objectContaining({ eventId: event.id, eventType: type, error: failure })
      )
    }
  )
  it.each(['invoice.payment_failed', 'invoice.finalized'] as const)(
    'retains %s routing',
    async (type) => {
      const event = { id: 'evt_original_invoice', type, data: { object: { id: 'in_original' } } }
      await onEvent(event as Stripe.Event)
      expect(
        type === 'invoice.payment_failed' ? state.failed : state.finalized
      ).toHaveBeenCalledExactlyOnceWith(event)
      expect(state.paid).not.toHaveBeenCalled()
    }
  )
  it('leaves unrelated events outside every invoice handler', async () => {
    await onEvent({ id: 'evt_unrelated', type: 'charge.updated' } as Stripe.Event)
    expect(state.paid).not.toHaveBeenCalled()
    expect(state.failed).not.toHaveBeenCalled()
    expect(state.finalized).not.toHaveBeenCalled()
  })
})
