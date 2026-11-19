import { invitation, member } from '@tradinggoose/db/schema'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  billing: vi.fn(),
  subscription: vi.fn(),
  select: vi.fn(),
  stripe: vi.fn(),
  retrieve: vi.fn(),
  updateStripe: vi.fn(),
  updateDb: vi.fn(),
}))
vi.mock('@tradinggoose/db', () => ({ db: { select: mocks.select, update: mocks.updateDb } }))
vi.mock('@/lib/auth', () => ({ getSession: mocks.session }))
vi.mock('@/lib/billing/core/billing', () => ({ getOrganizationSubscription: mocks.subscription }))
vi.mock('@/lib/billing/settings', () => ({
  getBillingGateState: mocks.billing,
  BILLING_DISABLED_ERROR: 'Billing disabled',
}))
vi.mock('@/lib/billing/stripe-client', () => ({ requireStripeClient: mocks.stripe }))

import { GET, PUT } from './route'

let membership: Array<{ role: string }>
const tables: unknown[] = []
const params = { params: Promise.resolve({ id: 'org-large' }) }
const subscriptionItem = {
  id: 'si_team',
  quantity: 60,
  price: {
    id: 'price_team',
    currency: 'usd',
    billing_scheme: 'per_unit',
    recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' },
    unit_amount: null,
    unit_amount_decimal: '12000',
  },
}
const seatPrice = { amountUsd: 120, interval: 'year' }
const request = (method = 'GET', seats = 60) =>
  new NextRequest('http://localhost/api/organizations/org-large/seats', {
    method,
    ...(method === 'PUT' ? { body: JSON.stringify({ seats }) } : {}),
  })

beforeEach(() => {
  vi.clearAllMocks()
  tables.length = 0
  membership = [{ role: 'owner' }]
  mocks.session.mockResolvedValue({ user: { id: 'user-1' } })
  mocks.billing.mockResolvedValue({ billingEnabled: true })
  mocks.stripe.mockReturnValue({
    subscriptions: { retrieve: mocks.retrieve, update: mocks.updateStripe },
  })
  mocks.updateStripe.mockResolvedValue({ id: 'sub_organization', status: 'active' })
  mocks.updateDb.mockReturnValue({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  })
  mocks.retrieve.mockResolvedValue({
    status: 'active',
    currency: 'usd',
    items: { data: [subscriptionItem] },
  })
  mocks.subscription.mockResolvedValue({
    seats: 60,
    stripeSubscriptionId: 'sub_organization',
    tier: {
      displayName: 'Team',
      ownerType: 'organization',
      seatCount: 1,
      seatMaximum: 80,
      seatMode: 'adjustable',
      stripeYearlyPriceId: 'price_team',
    },
  })
  mocks.select.mockImplementation((selection) => ({
    from: (table: unknown) => {
      tables.push(table)
      return {
        where: () =>
          selection
            ? Promise.resolve([{ count: table === member ? 53 : 3 }])
            : { limit: async () => membership },
      }
    },
  }))
})

describe('organization seat aggregate', () => {
  it.each(['owner', 'admin', 'member'])(
    'returns all occupied seats to an authorized %s',
    async (role) => {
      membership = [{ role }]
      const response = await GET(request(), params)
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        data: {
          organizationId: 'org-large',
          maxSeats: 60,
          usedSeats: 56,
          availableSeats: 4,
          seatPrice: role === 'owner' ? seatPrice : null,
        },
      })
      expect(tables).toEqual([member, member, invitation])
      expect(mocks.subscription).toHaveBeenCalledWith('org-large')
      if (role === 'owner') {
        expect(mocks.retrieve).toHaveBeenCalledWith('sub_organization')
      } else {
        expect(mocks.stripe).not.toHaveBeenCalled()
      }
    }
  )

  it('returns occupancy before the first subscription without granting seat modifications', async () => {
    mocks.subscription.mockResolvedValue(null)
    const response = await GET(request(), params)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        organizationId: 'org-large',
        usedSeats: 56,
        maxSeats: 0,
        availableSeats: 0,
        seatPrice: null,
      },
    })
    expect((await PUT(request('PUT'), params)).status).toBe(404)
    expect(mocks.stripe).not.toHaveBeenCalled()
  })

  it('rejects updates for adjustable subscriptions without a Stripe subscription', async () => {
    mocks.subscription.mockResolvedValue({
      seats: 60,
      tier: { ownerType: 'organization', seatMode: 'adjustable', seatMaximum: 80 },
    })
    const response = await GET(request(), params)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { maxSeats: 60, seatPrice: null },
    })
    expect((await PUT(request('PUT'), params)).status).toBe(400)
    expect(mocks.stripe).not.toHaveBeenCalled()
  })

  it('keeps occupancy available when the active Stripe seat item cannot be fetched', async () => {
    mocks.retrieve.mockRejectedValueOnce(new Error('Stripe unavailable'))
    const response = await GET(request(), params)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { usedSeats: 56, maxSeats: 60, seatPrice: null },
    })
    expect((await PUT(request('PUT', 61), params)).status).toBe(200)
  })

  it('returns fixed plan capacity without a per-seat quote', async () => {
    mocks.subscription.mockResolvedValue({
      seats: 60,
      stripeSubscriptionId: 'sub_organization',
      tier: { ownerType: 'organization', seatMode: 'fixed', seatCount: 60 },
    })
    await expect((await GET(request(), params)).json()).resolves.toMatchObject({
      data: { maxSeats: 60, seatPrice: null },
    })
    expect((await PUT(request('PUT'), params)).status).toBe(400)
    expect(mocks.retrieve).not.toHaveBeenCalled()
  })

  it.each(['anonymous', 'billing-disabled', 'foreign-member'])(
    'preserves the %s access boundary before reading occupancy',
    async (scenario) => {
      if (scenario === 'anonymous') mocks.session.mockResolvedValue(null)
      if (scenario === 'billing-disabled')
        mocks.billing.mockResolvedValue({ billingEnabled: false })
      if (scenario === 'foreign-member') membership = []
      const response = await GET(request(), params)
      expect(response.status).toBe(
        { anonymous: 401, 'billing-disabled': 409, 'foreign-member': 403 }[scenario]
      )
      expect(mocks.subscription).not.toHaveBeenCalled()
      expect(tables).not.toContain(invitation)
    }
  )

  it('keeps seat mutation restricted to owners', async () => {
    membership = [{ role: 'admin' }]
    expect((await PUT(request('PUT'), params)).status).toBe(403)
    expect(mocks.subscription).not.toHaveBeenCalled()
    expect(mocks.stripe).not.toHaveBeenCalled()
  })

  it('rejects a reduction below occupied seats before updating Stripe', async () => {
    const response = await PUT(request('PUT', 55), params)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ occupiedSeats: 56 })
    expect(mocks.stripe).not.toHaveBeenCalled()
  })

  it('displays stored capacity and quotes and updates the plan item when an add-on comes first', async () => {
    mocks.retrieve.mockResolvedValue({
      status: 'active',
      currency: 'usd',
      items: {
        data: [
          {
            ...subscriptionItem,
            id: 'si_addon',
            price: { ...subscriptionItem.price, id: 'price_addon', unit_amount_decimal: '100' },
          },
          { ...subscriptionItem, quantity: 63 },
        ],
      },
    })
    await expect((await GET(request(), params)).json()).resolves.toMatchObject({
      data: { maxSeats: 60, availableSeats: 4, seatPrice },
    })
    const response = await PUT(request('PUT', 60), params)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ data: { seats: 60, previousSeats: 63 } })
    expect(mocks.updateStripe).toHaveBeenCalledExactlyOnceWith('sub_organization', {
      items: [{ id: 'si_team', quantity: 60 }],
      proration_behavior: 'create_prorations',
    })
    expect(mocks.updateDb.mock.results[0].value.set).toHaveBeenCalledWith({ seats: 60 })
  })

  it('repairs capacity on retry after Stripe succeeds and the local write fails', async () => {
    mocks.updateDb.mockImplementationOnce(() => {
      throw new Error('Database unavailable')
    })
    expect((await PUT(request('PUT', 61), params)).status).toBe(500)

    mocks.retrieve.mockResolvedValue({
      status: 'active',
      currency: 'usd',
      items: { data: [{ ...subscriptionItem, quantity: 61 }] },
    })
    expect((await PUT(request('PUT', 61), params)).status).toBe(200)
    expect(mocks.updateStripe).toHaveBeenCalledTimes(1)
    expect(mocks.updateDb.mock.results[1].value.set).toHaveBeenCalledWith({ seats: 61 })
  })
})
