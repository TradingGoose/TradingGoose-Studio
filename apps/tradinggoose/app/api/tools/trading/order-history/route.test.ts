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
    chain.orderBy = vi.fn(() => Promise.resolve(selectQueue.shift() ?? []))
    return chain
  }

  return {
    selectQueue,
    checkAuth: vi.fn(),
    checkWorkspaceAccess: vi.fn(),
    select: vi.fn(makeSelectChain),
  }
})

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: mocks.select,
  },
  orderHistoryTable: {
    workspaceId: 'orderHistoryTable.workspaceId',
    recordedAt: 'orderHistoryTable.recordedAt',
  },
  workflowExecutionLogs: {
    id: 'workflowExecutionLogs.id',
    workspaceId: 'workflowExecutionLogs.workspaceId',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value })),
  gte: vi.fn((field: unknown, value: unknown) => ({ field, type: 'gte', value })),
  lte: vi.fn((field: unknown, value: unknown) => ({ field, type: 'lte', value })),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: (...args: unknown[]) => mocks.checkAuth(...args),
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

describe('order history support route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.selectQueue.length = 0
    mocks.checkAuth.mockResolvedValue({ success: true, userId: 'user-1' })
    mocks.checkWorkspaceAccess.mockResolvedValue({ exists: true, hasAccess: true })
  })

  it('returns workspace history without log-specific filters', async () => {
    mocks.selectQueue.push([
      {
        id: 'order-history-1',
        workspaceId: 'workspace-1',
        provider: 'alpaca',
        environment: 'paper',
        recordedAt: new Date('2026-04-01T00:00:00.000Z'),
        submissionSource: 'workflow',
        logId: null,
        listingIdentity: { listing_id: 'AAPL', listing_type: 'stock' },
        request: {
          accountId: 'account-1',
          credentialId: 'credential-1',
          serviceId: 'alpaca-paper',
          quantity: 1,
          side: 'buy',
        },
        response: { orderId: 'provider-order-1' },
        normalizedOrder: { status: 'filled', symbol: 'AAPL' },
      },
    ])
    const { GET } = await import('./route')

    const response = await GET(
      new NextRequest(
        'http://localhost/api/tools/trading/order-history?workspaceId=workspace-1&startDate=2026-04-01T00:00:00.000Z&endDate=2026-04-02T00:00:00.000Z'
      )
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        count: 1,
        history: [
          expect.not.objectContaining({
            accountId: 'account-1',
            credentialId: 'credential-1',
            serviceId: 'alpaca-paper',
          }),
        ],
        workspaceId: 'workspace-1',
      },
    })
  })
})
