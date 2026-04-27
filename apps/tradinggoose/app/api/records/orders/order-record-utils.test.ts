/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
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
    and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
    eq: vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value })),
    gte: vi.fn((field: unknown, value: unknown) => ({ field, type: 'gte', value })),
    isNotNull: vi.fn((field: unknown) => ({ field, type: 'isNotNull' })),
    isNull: vi.fn((field: unknown) => ({ field, type: 'isNull' })),
    lte: vi.fn((field: unknown, value: unknown) => ({ field, type: 'lte', value })),
    or: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'or' })),
    sql,
  }
})

vi.mock('@tradinggoose/db', () => ({
  orderHistoryTable: {
    environment: 'orderHistoryTable.environment',
    id: 'orderHistoryTable.id',
    listingIdentity: 'orderHistoryTable.listingIdentity',
    normalizedOrder: 'orderHistoryTable.normalizedOrder',
    provider: 'orderHistoryTable.provider',
    recordedAt: 'orderHistoryTable.recordedAt',
    request: 'orderHistoryTable.request',
    response: 'orderHistoryTable.response',
    submissionSource: 'orderHistoryTable.submissionSource',
    workflowExecutionId: 'orderHistoryTable.workflowExecutionId',
    workflowLogId: 'orderHistoryTable.workflowLogId',
    workspaceId: 'orderHistoryTable.workspaceId',
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  workflowExecutionLogs: {
    workflowSummary: 'workflowExecutionLogs.workflowSummary',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: mocks.and,
  eq: mocks.eq,
  gte: mocks.gte,
  isNotNull: mocks.isNotNull,
  isNull: mocks.isNull,
  lte: mocks.lte,
  or: mocks.or,
  sql: mocks.sql,
}))

describe('order record utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('serializes linked order records and redacts secrets from full detail payloads', async () => {
    const { serializeOrderRecord } = await import('./order-record-utils')

    const record = serializeOrderRecord(
      {
        environment: 'paper',
        id: 'order-1',
        linkedLog: {
          endedAt: null,
          executionId: 'execution-1',
          id: 'log-1',
          level: 'info',
          startedAt: new Date('2026-04-23T00:00:00.000Z'),
          workflowSummary: { name: 'Workflow' },
        },
        listingIdentity: { listing_id: 'AAPL', listing_type: 'stock' },
        normalizedOrder: {
          averageFillPrice: '184.25',
          side: 'buy',
          status: 'filled',
          symbol: 'AAPL',
        },
        provider: 'alpaca',
        recordedAt: new Date('2026-04-23T00:00:00.000Z'),
        request: {
          accessToken: 'secret-token',
          orderType: 'limit',
          providerParams: { accountId: 'account-1', apiKey: 'secret-key' },
          quantity: '5',
          side: 'buy',
          timeInForce: 'day',
        },
        response: {
          apiSecret: 'secret-value',
          orderId: 'provider-order-1',
          raw: { filled_avg_price: '184.25', status: 'filled' },
        },
        submissionSource: 'workflow',
        workflowExecutionId: 'execution-1',
        workflowId: 'workflow-1',
        workflowLogId: 'log-1',
        workspaceId: 'workspace-1',
      } as any,
      'full'
    )

    expect(record).toMatchObject({
      accountId: 'account-1',
      averageFillPrice: '184.25',
      hasLinkedLog: true,
      id: 'order-1',
      linkedLog: {
        executionId: 'execution-1',
        id: 'log-1',
        workflowName: 'Workflow',
      },
      listing: { listingType: 'stock', symbol: 'AAPL' },
      orderType: 'limit',
      providerOrderId: 'provider-order-1',
      side: 'buy',
      status: 'filled',
      submissionSource: 'workflow',
      timeInForce: 'day',
      workspaceId: 'workspace-1',
    })
    expect(record.request).toMatchObject({
      accessToken: '[redacted]',
      providerParams: { accountId: 'account-1', apiKey: '[redacted]' },
    })
    expect(record.response).toMatchObject({
      apiSecret: '[redacted]',
      orderId: 'provider-order-1',
    })
  })

  it('builds SQL filters for workspace, side, order type, time in force, and linked logs', async () => {
    const { buildOrderWhereCondition } = await import('./order-record-utils')

    buildOrderWhereCondition('workspace-1', {
      endDate: '',
      environment: 'paper',
      linkedLog: 'true',
      orderSearch: 'AAPL',
      orderSortBy: 'recordedAt',
      orderSortOrder: 'desc',
      orderType: 'limit',
      provider: 'alpaca',
      side: 'buy',
      startDate: '',
      status: 'filled',
      submissionSource: 'workflow',
      timeInForce: 'day',
    })

    expect(mocks.eq).toHaveBeenCalledWith('orderHistoryTable.workspaceId', 'workspace-1')
    expect(mocks.eq).toHaveBeenCalledWith('orderHistoryTable.provider', 'alpaca')
    expect(mocks.eq).toHaveBeenCalledWith('orderHistoryTable.environment', 'paper')
    expect(mocks.eq).toHaveBeenCalledWith('orderHistoryTable.submissionSource', 'workflow')
    expect(mocks.eq).toHaveBeenCalledWith(expect.any(Object), 'filled')
    expect(mocks.eq).toHaveBeenCalledWith(expect.any(Object), 'buy')
    expect(mocks.eq).toHaveBeenCalledWith(expect.any(Object), 'limit')
    expect(mocks.eq).toHaveBeenCalledWith(expect.any(Object), 'day')
    expect(mocks.isNotNull).toHaveBeenCalledWith('orderHistoryTable.workflowLogId')
    expect(mocks.or).toHaveBeenCalled()
  })
})
