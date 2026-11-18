import { invitation, member } from '@tradinggoose/db/schema'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  billing: vi.fn(),
  subscription: vi.fn(),
  select: vi.fn(),
  stripe: vi.fn(),
}))
vi.mock('@tradinggoose/db', () => ({ db: { select: mocks.select } }))
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
  mocks.subscription.mockResolvedValue({
    seats: 60,
    stripeSubscriptionId: 'sub_organization',
    tier: {
      displayName: 'Team',
      ownerType: 'organization',
      seatCount: 1,
      seatMaximum: 80,
      seatMode: 'adjustable',
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
          memberSeats: 53,
          pendingInvitations: 3,
          availableSeats: 4,
          canModifySeats: true,
        },
      })
      expect(tables).toEqual([member, member, invitation])
      expect(mocks.subscription).toHaveBeenCalledWith('org-large')
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
        tier: null,
        seatMode: null,
        seatMaximum: null,
        canModifySeats: false,
      },
    })
    expect((await PUT(request('PUT'), params)).status).toBe(404)
    expect(mocks.stripe).not.toHaveBeenCalled()
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
})
