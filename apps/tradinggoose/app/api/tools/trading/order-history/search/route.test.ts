/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const selectQueue: unknown[][] = []
  const makeSelectChain = () => {
    const chain: Record<string, any> = {}
    chain.from = vi.fn(() => chain)
    chain.where = vi.fn(() => chain)
    chain.orderBy = vi.fn(() => chain)
    chain.limit = vi.fn(() => Promise.resolve(selectQueue.shift() ?? []))
    return chain
  }

  return {
    selectQueue,
    checkWorkspaceAccess: vi.fn(),
    eq: vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value })),
    getSession: vi.fn(),
    select: vi.fn(makeSelectChain),
  }
})

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: mocks.select,
  },
  orderHistoryTable: {
    id: 'orderHistoryTable.id',
    workspaceId: 'orderHistoryTable.workspaceId',
    listingIdentity: 'orderHistoryTable.listingIdentity',
    normalizedOrder: 'orderHistoryTable.normalizedOrder',
    response: 'orderHistoryTable.response',
    request: 'orderHistoryTable.request',
    recordedAt: 'orderHistoryTable.recordedAt',
  },
}))

const sql = vi.hoisted(() => {
  const tag = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    type: 'sql',
    values,
  })) as any
  return tag
})

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  desc: vi.fn((value: unknown) => ({ type: 'desc', value })),
  eq: mocks.eq,
  gte: vi.fn((field: unknown, value: unknown) => ({ field, type: 'gte', value })),
  lt: vi.fn((field: unknown, value: unknown) => ({ field, type: 'lt', value })),
  or: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'or' })),
  sql,
}))

vi.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mocks.getSession(...args),
}))

vi.mock('@/lib/listing/identity', () => ({
  areListingIdentitiesEqual: vi.fn(() => false),
  toListingValueObject: vi.fn((value) => value ?? null),
}))

vi.mock('@/lib/listing/resolve', () => ({
  resolveListingIdentity: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() })),
}))

vi.mock('@/lib/permissions/utils', () => ({
  checkWorkspaceAccess: (...args: unknown[]) => mocks.checkWorkspaceAccess(...args),
}))

vi.mock('@/lib/utils', () => ({
  generateRequestId: vi.fn(() => 'request-1'),
}))

const orderRow = {
  id: 'order-1',
  provider: 'alpaca',
  environment: 'paper',
  recordedAt: new Date('2026-04-23T00:00:00.000Z'),
  listingIdentity: { listing_type: 'default', listing_id: 'AAPL' },
  request: { side: 'buy', quantity: 1 },
  response: { submittedAt: '2026-04-23T00:00:00.000Z' },
  normalizedOrder: { symbol: 'AAPL' },
}

describe('order history search route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.selectQueue.length = 0
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.checkWorkspaceAccess.mockResolvedValue({ exists: true, hasAccess: true })
  })

  it('rejects bearer-only requests because the selector route is session scoped', async () => {
    mocks.getSession.mockResolvedValue(null)
    const { GET } = await import('./route')

    const response = await GET(
      new NextRequest('http://localhost/api/tools/trading/order-history/search?workspaceId=ws-1', {
        headers: { authorization: 'Bearer internal-token' },
      })
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      success: false,
      error: { message: 'Unauthorized' },
    })
  })

  it('rejects inaccessible workspace filters before reading order rows', async () => {
    mocks.checkWorkspaceAccess.mockResolvedValue({ exists: true, hasAccess: false })
    const { GET } = await import('./route')

    const response = await GET(
      new NextRequest('http://localhost/api/tools/trading/order-history/search?workspaceId=ws-1')
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      success: false,
      error: { message: 'Not found' },
    })
    expect(mocks.checkWorkspaceAccess).toHaveBeenCalledWith('ws-1', 'user-1')
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it('rejects searches without explicit workspace scope', async () => {
    const { GET } = await import('./route')

    const response = await GET(
      new NextRequest('http://localhost/api/tools/trading/order-history/search?q=AAPL')
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      success: false,
      error: { message: 'workspaceId is required' },
    })
    expect(mocks.select).not.toHaveBeenCalled()
    expect(mocks.checkWorkspaceAccess).not.toHaveBeenCalled()
  })

  it('searches only within the requested workspace', async () => {
    mocks.selectQueue.push([orderRow])
    const { GET } = await import('./route')

    const response = await GET(
      new NextRequest('http://localhost/api/tools/trading/order-history/search?workspaceId=ws-1')
    )

    expect(response.status).toBe(200)
    expect(mocks.checkWorkspaceAccess).toHaveBeenCalledWith('ws-1', 'user-1')
    expect(mocks.eq).toHaveBeenCalledWith('orderHistoryTable.workspaceId', 'ws-1')
    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        count: 1,
        workspaceId: 'ws-1',
      },
    })
  })

  it('searches provider order id paths when the query is a UUID', async () => {
    const providerOrderId = '550e8400-e29b-41d4-a716-446655440000'
    mocks.selectQueue.push([orderRow])
    const { GET } = await import('./route')

    const response = await GET(
      new NextRequest(
        `http://localhost/api/tools/trading/order-history/search?workspaceId=workspace-1&q=${providerOrderId}`
      )
    )

    expect(response.status).toBe(200)
    expect(mocks.eq).toHaveBeenCalledWith('orderHistoryTable.id', providerOrderId)

    const sqlCalls = (sql.mock.calls as [TemplateStringsArray, ...unknown[]][]).map((call) => {
      const [strings, ...values] = call
      return {
        text: Array.from(strings).join(''),
        values,
      }
    })

    expect(
      sqlCalls.some(
        (call) =>
          call.values.includes('orderHistoryTable.response') && call.text.includes("->>'orderId'")
      )
    ).toBe(true)
    expect(
      sqlCalls.some(
        (call) =>
          call.values.includes('orderHistoryTable.response') &&
          call.text.includes("->'raw'->>'client_order_id'")
      )
    ).toBe(true)
    expect(
      sqlCalls.some(
        (call) =>
          call.values.includes('orderHistoryTable.normalizedOrder') && call.text.includes("->>'id'")
      )
    ).toBe(true)
    expect(
      sqlCalls.some(
        (call) => call.text.includes('NULLIF(') && call.values.includes(providerOrderId)
      )
    ).toBe(true)
    expect(
      sqlCalls.some(
        (call) =>
          call.text.includes('::text') &&
          call.values.some((value) =>
            [
              'orderHistoryTable.listingIdentity',
              'orderHistoryTable.normalizedOrder',
              'orderHistoryTable.response',
              'orderHistoryTable.request',
            ].includes(value as string)
          )
      )
    ).toBe(false)
  })
})
