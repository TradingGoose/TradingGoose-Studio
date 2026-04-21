/**
 * @vitest-environment node
 */

import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureStripeUserCustomer } from './stripe-customers'

const { mockEq, userTable } = vi.hoisted(() => ({
  mockEq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  userTable: {
    id: 'user.id',
    stripeCustomerId: 'user.stripeCustomerId',
    email: 'user.email',
    name: 'user.name',
  },
}))

let userRows: Array<{ stripeCustomerId: string | null; email: string; name: string }> = []
let userUpdates: Array<Record<string, unknown>> = []
let persistUserUpdate = true

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  user: userTable,
}))

vi.mock('drizzle-orm', () => ({
  eq: mockEq,
}))

function createDbClient() {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(userRows)),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values) => ({
        where: vi.fn(async () => {
          userUpdates.push(values)
          if (persistUserUpdate && userRows[0]) {
            userRows[0] = {
              ...userRows[0],
              stripeCustomerId: values.stripeCustomerId as string | null,
            }
          }
          return []
        }),
      })),
    })),
  }
}

function createStripeClient() {
  return {
    customers: {
      create: vi.fn(),
      retrieve: vi.fn(),
    },
  }
}

describe('ensureStripeUserCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    userRows = [{ stripeCustomerId: null, email: 'user@example.com', name: 'Portal User' }]
    userUpdates = []
    persistUserUpdate = true
  })

  it('returns null when the user does not exist', async () => {
    userRows = []
    const dbClient = createDbClient()
    const stripe = createStripeClient()

    const customer = await ensureStripeUserCustomer(stripe, {
      dbClient,
      userId: 'user-1',
    })

    expect(customer).toBeNull()
    expect(stripe.customers.retrieve).not.toHaveBeenCalled()
    expect(stripe.customers.create).not.toHaveBeenCalled()
    expect(userUpdates).toEqual([])
  })

  it('creates a personal Stripe customer when none is stored', async () => {
    const dbClient = createDbClient()
    const stripe = createStripeClient()
    stripe.customers.create.mockResolvedValue({
      id: 'cus_user_123',
    })

    const customer = await ensureStripeUserCustomer(stripe, {
      dbClient,
      userId: 'user-1',
    })

    expect(customer?.id).toBe('cus_user_123')
    expect(stripe.customers.create).toHaveBeenCalledWith(
      {
        email: 'user@example.com',
        name: 'Portal User',
        metadata: {
          userId: 'user-1',
          customerType: 'user',
        },
      },
      {
        idempotencyKey: `auth-signup:user-customer:${createHash('sha256').update('user-1').digest('hex')}`,
      }
    )
    expect(userUpdates).toEqual([
      expect.objectContaining({
        stripeCustomerId: 'cus_user_123',
      }),
    ])
  })

  it('reuses the stored Stripe customer when lookup succeeds', async () => {
    userRows = [
      { stripeCustomerId: 'cus_existing', email: 'user@example.com', name: 'Portal User' },
    ]
    const dbClient = createDbClient()
    const stripe = createStripeClient()
    stripe.customers.retrieve.mockResolvedValue({
      id: 'cus_existing',
    })

    const customer = await ensureStripeUserCustomer(stripe, {
      dbClient,
      userId: 'user-1',
    })

    expect(customer?.id).toBe('cus_existing')
    expect(stripe.customers.create).not.toHaveBeenCalled()
    expect(userUpdates).toEqual([])
  })

  it('recreates a stale stored Stripe customer with the replacement idempotency key', async () => {
    userRows = [{ stripeCustomerId: 'cus_stale', email: 'user@example.com', name: 'Portal User' }]
    const dbClient = createDbClient()
    const stripe = createStripeClient()
    stripe.customers.retrieve.mockRejectedValue(
      Object.assign(new Error('No such customer'), { code: 'resource_missing' })
    )
    stripe.customers.create.mockResolvedValue({
      id: 'cus_user_123',
    })

    const customer = await ensureStripeUserCustomer(stripe, {
      dbClient,
      userId: 'user-1',
    })

    expect(customer?.id).toBe('cus_user_123')
    expect(stripe.customers.create).toHaveBeenCalledWith(expect.any(Object), {
      idempotencyKey: `billing-portal:user-customer-replacement:${createHash('sha256').update('user-1:cus_stale').digest('hex')}`,
    })
    expect(userUpdates).toEqual([
      expect.objectContaining({
        stripeCustomerId: 'cus_user_123',
      }),
    ])
  })

  it('recreates a deleted stored Stripe customer with the replacement idempotency key', async () => {
    userRows = [{ stripeCustomerId: 'cus_deleted', email: 'user@example.com', name: 'Portal User' }]
    const dbClient = createDbClient()
    const stripe = createStripeClient()
    stripe.customers.retrieve.mockResolvedValue({
      deleted: true,
      id: 'cus_deleted',
    })
    stripe.customers.create.mockResolvedValue({
      id: 'cus_user_456',
    })

    const customer = await ensureStripeUserCustomer(stripe, {
      dbClient,
      userId: 'user-1',
    })

    expect(customer?.id).toBe('cus_user_456')
    expect(stripe.customers.create).toHaveBeenCalledWith(expect.any(Object), {
      idempotencyKey: `billing-portal:user-customer-replacement:${createHash('sha256').update('user-1:cus_deleted').digest('hex')}`,
    })
    expect(userUpdates).toEqual([
      expect.objectContaining({
        stripeCustomerId: 'cus_user_456',
      }),
    ])
  })

  it('does not recreate or overwrite the stored Stripe customer on transient lookup failures', async () => {
    userRows = [
      { stripeCustomerId: 'cus_existing', email: 'user@example.com', name: 'Portal User' },
    ]
    const dbClient = createDbClient()
    const stripe = createStripeClient()
    stripe.customers.retrieve.mockRejectedValue(new Error('Stripe API unavailable'))

    await expect(
      ensureStripeUserCustomer(stripe, {
        dbClient,
        userId: 'user-1',
      })
    ).rejects.toThrow('Stripe API unavailable')

    expect(stripe.customers.create).not.toHaveBeenCalled()
    expect(userUpdates).toEqual([])
  })

  it('reuses the same Stripe idempotency key if local persistence is lost between retries', async () => {
    const dbClient = createDbClient()
    const stripe = createStripeClient()
    persistUserUpdate = false
    stripe.customers.create.mockResolvedValue({
      id: 'cus_user_123',
    })

    await ensureStripeUserCustomer(stripe, {
      dbClient,
      userId: 'user-1',
    })
    await ensureStripeUserCustomer(stripe, {
      dbClient,
      userId: 'user-1',
    })

    expect(stripe.customers.create).toHaveBeenNthCalledWith(1, expect.any(Object), {
      idempotencyKey: `auth-signup:user-customer:${createHash('sha256').update('user-1').digest('hex')}`,
    })
    expect(stripe.customers.create).toHaveBeenNthCalledWith(2, expect.any(Object), {
      idempotencyKey: `auth-signup:user-customer:${createHash('sha256').update('user-1').digest('hex')}`,
    })
  })
})
