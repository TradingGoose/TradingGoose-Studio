import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const rows: unknown[][] = []
  const chain: Record<string, any> = {}
  chain.from = vi.fn(() => chain)
  chain.innerJoin = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.limit = vi.fn(() => Promise.resolve(rows.shift() ?? []))
  return {
    chain,
    getSession: vi.fn(),
    getUserEntityPermissions: vi.fn(),
    rows,
  }
})

vi.mock('@tradinggoose/db', () => ({ db: { select: vi.fn(() => mocks.chain) } }))
vi.mock('@tradinggoose/db/schema', () => ({ webhook: {}, workflow: {} }))
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/permissions/utils', () => ({
  getUserEntityPermissions: mocks.getUserEntityPermissions,
}))
vi.mock('@/lib/urls/utils', () => ({ getBaseUrl: () => 'http://localhost:3000' }))

import { GET } from './route'

describe('operator Stripe webhook setup contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rows.length = 0
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } })
  })

  it('returns the exact locally owned billing lifecycle event list', async () => {
    mocks.rows.push([
      {
        webhook: { id: 'webhook-1', provider: 'stripe', path: 'stripe', isActive: true },
        workflow: { userId: 'user-1', workspaceId: 'workspace-1' },
      },
    ])

    const response = await GET(
      new Request('http://localhost/api/webhooks/test?id=webhook-1') as any
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.setup.events).toEqual([
      'charge.succeeded',
      'invoice.created',
      'invoice.finalized',
      'invoice.payment_failed',
      'invoice.payment_succeeded',
      'customer.subscription.created',
      'customer.subscription.deleted',
    ])
  })

  it('does not expose setup for a non-Stripe webhook', async () => {
    mocks.rows.push([
      {
        webhook: { id: 'webhook-1', provider: 'generic', path: 'generic', isActive: true },
        workflow: { userId: 'user-1', workspaceId: null },
      },
    ])

    const response = await GET(
      new Request('http://localhost/api/webhooks/test?id=webhook-1') as any
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Stripe webhook is required',
    })
  })
})
