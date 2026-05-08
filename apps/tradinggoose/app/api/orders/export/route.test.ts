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
    chain.orderBy = vi.fn(() => chain)
    chain.then = (resolve: (value: unknown[]) => unknown, reject: (reason?: unknown) => unknown) =>
      Promise.resolve(resultsQueue.shift() ?? []).then(resolve, reject)
    chains.push(chain)
    return chain
  }

  const sql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings: Array.from(strings),
    type: 'sql',
    values,
  })) as any
  sql.join = vi.fn((values: unknown[], separator: unknown) => ({
    separator,
    type: 'sql.join',
    values,
  }))
  sql.raw = vi.fn((value: string) => ({ type: 'sql.raw', value }))

  return {
    chains,
    checkWorkspaceAccess: vi.fn(),
    eq: vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value })),
    getSession: vi.fn(),
    resultsQueue,
    select: vi.fn(makeChain),
    sql,
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
  gte: vi.fn((field: unknown, value: unknown) => ({ field, type: 'gte', value })),
  isNotNull: vi.fn((field: unknown) => ({ field, type: 'isNotNull' })),
  isNull: vi.fn((field: unknown) => ({ field, type: 'isNull' })),
  lte: vi.fn((field: unknown, value: unknown) => ({ field, type: 'lte', value })),
  or: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'or' })),
  sql: mocks.sql,
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
  normalizedOrder: {
    averageFillPrice: '184.25',
    filledQuantity: '5',
    status: 'filled',
    symbol: 'AAPL',
  },
}

describe('orders export route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.chains.length = 0
    mocks.resultsQueue.length = 0
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.checkWorkspaceAccess.mockResolvedValue({ exists: true, hasAccess: true })
  })

  it('exports workspace-scoped filtered order records as CSV', async () => {
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
      new NextRequest(
        'http://localhost/api/orders/export?workspaceId=workspace-1&side=buy&orderType=limit&timeInForce=day'
      )
    )
    const csv = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/csv')
    expect(response.headers.get('Content-Disposition')).toContain('orders-')
    expect(mocks.checkWorkspaceAccess).toHaveBeenCalledWith('workspace-1', 'user-1')
    expect(mocks.eq).toHaveBeenCalledWith(
      'orderHistoryTable.workspaceId',
      'workflowExecutionLogs.workspaceId'
    )
    expect(mocks.eq).toHaveBeenCalledWith(expect.any(Object), 'buy')
    expect(mocks.eq).toHaveBeenCalledWith(expect.any(Object), 'limit')
    expect(mocks.eq).toHaveBeenCalledWith(expect.any(Object), 'day')
    expect(mocks.chains[0]?.orderBy).toHaveBeenCalled()
    expect(csv).toContain('"App Order ID","Provider Order ID","Listing"')
    expect(csv).toContain('"order-1","provider-order-1","AAPL","workflow","alpaca"')
  })
})
