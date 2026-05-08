/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const resultsQueue: unknown[][] = []
  const chains: Array<Record<string, any>> = []
  const makeChain = () => {
    const chain: Record<string, any> = {}
    chain.from = vi.fn(() => chain)
    chain.leftJoin = vi.fn(() => chain)
    chain.where = vi.fn(() => chain)
    chain.limit = vi.fn(() => chain)
    chain.then = (resolve: (value: unknown[]) => unknown, reject: (reason?: unknown) => unknown) =>
      Promise.resolve(resultsQueue.shift() ?? []).then(resolve, reject)
    chains.push(chain)
    return chain
  }

  return {
    chains,
    checkWorkspaceAccess: vi.fn(),
    eq: vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value })),
    getSession: vi.fn(),
    resultsQueue,
    select: vi.fn(makeChain),
  }
})

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: mocks.select,
  },
  orderHistoryTable: {
    id: 'orderHistoryTable.id',
    workspaceId: 'orderHistoryTable.workspaceId',
    provider: 'orderHistoryTable.provider',
    environment: 'orderHistoryTable.environment',
    recordedAt: 'orderHistoryTable.recordedAt',
    submissionSource: 'orderHistoryTable.submissionSource',
    logId: 'orderHistoryTable.logId',
    listingIdentity: 'orderHistoryTable.listingIdentity',
    request: 'orderHistoryTable.request',
    response: 'orderHistoryTable.response',
    normalizedOrder: 'orderHistoryTable.normalizedOrder',
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  workflowExecutionLogs: {
    id: 'workflowExecutionLogs.id',
    executionId: 'workflowExecutionLogs.executionId',
    workspaceId: 'workflowExecutionLogs.workspaceId',
    workflowSummary: 'workflowExecutionLogs.workflowSummary',
    level: 'workflowExecutionLogs.level',
    startedAt: 'workflowExecutionLogs.startedAt',
    endedAt: 'workflowExecutionLogs.endedAt',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  eq: mocks.eq,
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

vi.mock('@/lib/utils', () => ({
  generateRequestId: vi.fn(() => 'request-1'),
}))

const orderRow = {
  id: 'order-1',
  workspaceId: 'workspace-1',
  provider: 'alpaca',
  environment: 'paper',
  recordedAt: new Date('2026-04-23T00:00:00.000Z'),
  submissionSource: 'workflow',
  logId: 'log-1',
  listingIdentity: { listing_type: 'stock', listing_id: 'AAPL' },
  request: { side: 'buy', quantity: 5, orderType: 'limit', timeInForce: 'day' },
  response: { orderId: 'provider-order-1', submittedAt: '2026-04-23T00:00:00.000Z' },
  normalizedOrder: { symbol: 'AAPL', status: 'filled', averageFillPrice: '184.25' },
}

describe('order detail route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.chains.length = 0
    mocks.resultsQueue.length = 0
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.checkWorkspaceAccess.mockResolvedValue({ exists: true, hasAccess: true })
  })

  it('requires a session', async () => {
    mocks.getSession.mockResolvedValueOnce(null)
    const { GET } = await import('./route')

    const response = await GET(
      new NextRequest('http://localhost/api/orders/order-1?workspaceId=workspace-1'),
      { params: Promise.resolve({ orderId: 'order-1' }) }
    )

    expect(response.status).toBe(401)
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it('fetches details by order id and workspace-scoped linked log', async () => {
    mocks.resultsQueue.push([
      {
        order: orderRow,
        linkedLog: {
          id: 'log-1',
          executionId: 'execution-1',
          workflowSummary: { name: 'Workflow' },
          level: 'info',
          startedAt: new Date('2026-04-23T00:00:00.000Z'),
          endedAt: null,
        },
      },
    ])
    const { GET } = await import('./route')

    const response = await GET(
      new NextRequest('http://localhost/api/orders/order-1?workspaceId=workspace-1'),
      { params: Promise.resolve({ orderId: 'order-1' }) }
    )

    expect(response.status).toBe(200)
    expect(mocks.checkWorkspaceAccess).toHaveBeenCalledWith('workspace-1', 'user-1')
    expect(mocks.eq).toHaveBeenCalledWith(
      'orderHistoryTable.workspaceId',
      'workflowExecutionLogs.workspaceId'
    )
    expect(mocks.eq).toHaveBeenCalledWith('orderHistoryTable.id', 'order-1')
    expect(mocks.eq).toHaveBeenCalledWith('orderHistoryTable.workspaceId', 'workspace-1')
    expect(await response.json()).toMatchObject({
      data: {
        id: 'order-1',
        workspaceId: 'workspace-1',
        listing: { symbol: 'AAPL' },
        linkedLog: { id: 'log-1', executionId: 'execution-1', workflowName: 'Workflow' },
        request: { side: 'buy' },
      },
    })
  })
})
