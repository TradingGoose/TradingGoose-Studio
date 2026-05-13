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
    buildOrderWhereCondition: vi.fn((workspaceId: string, filters: unknown) => ({
      filters,
      type: 'where',
      workspaceId,
    })),
    checkWorkspaceAccess: vi.fn(),
    getSession: vi.fn(),
    select: vi.fn(makeSelectChain),
    selectQueue,
    serializeOrderSearchOptions: vi.fn(async (rows: unknown[]) =>
      rows.map((row: any) => ({
        id: row.id,
        provider: row.provider,
        environment: row.environment ?? null,
        side: null,
        quantity: null,
        notional: null,
        placedAt: null,
        recordedAt: row.recordedAt.toISOString(),
        symbol: null,
        quote: null,
        companyName: null,
        iconUrl: null,
        assetClass: null,
        listingType: null,
      }))
    ),
  }
})

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: mocks.select,
  },
  orderHistoryTable: {
    recordedAt: 'orderHistoryTable.recordedAt',
  },
}))

vi.mock('drizzle-orm', () => ({
  desc: vi.fn((value: unknown) => ({ type: 'desc', value })),
}))

vi.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mocks.getSession(...args),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() })),
}))

vi.mock('@/lib/permissions/utils', () => ({
  checkWorkspaceAccess: (...args: unknown[]) => mocks.checkWorkspaceAccess(...args),
}))

vi.mock('@/lib/trading/order-records', () => ({
  buildOrderWhereCondition: (workspaceId: string, filters: unknown) =>
    mocks.buildOrderWhereCondition(workspaceId, filters),
  serializeOrderSearchOptions: (rows: unknown[]) => mocks.serializeOrderSearchOptions(rows),
}))

vi.mock('@/lib/utils', () => ({
  generateRequestId: vi.fn(() => 'request-1'),
}))

const orderRow = {
  id: 'order-1',
  provider: 'alpaca',
  environment: 'paper',
  recordedAt: new Date('2026-04-23T00:00:00.000Z'),
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

  it('searches only within the requested workspace through canonical order-record filters', async () => {
    mocks.selectQueue.push([orderRow])
    const { GET } = await import('./route')

    const response = await GET(
      new NextRequest('http://localhost/api/tools/trading/order-history/search?workspaceId=ws-1')
    )

    expect(response.status).toBe(200)
    expect(mocks.checkWorkspaceAccess).toHaveBeenCalledWith('ws-1', 'user-1')
    expect(mocks.buildOrderWhereCondition).toHaveBeenCalledWith('ws-1', { orderSearch: '' })
    expect(mocks.serializeOrderSearchOptions).toHaveBeenCalledWith([orderRow])
    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        count: 1,
        workspaceId: 'ws-1',
      },
    })
  })

  it('passes typed search text to canonical order-record filters', async () => {
    const providerOrderId = '550e8400-e29b-41d4-a716-446655440000'
    mocks.selectQueue.push([orderRow])
    const { GET } = await import('./route')

    const response = await GET(
      new NextRequest(
        `http://localhost/api/tools/trading/order-history/search?workspaceId=workspace-1&q=${providerOrderId}`
      )
    )

    expect(response.status).toBe(200)
    expect(mocks.buildOrderWhereCondition).toHaveBeenCalledWith('workspace-1', {
      orderSearch: providerOrderId,
    })
  })
})
