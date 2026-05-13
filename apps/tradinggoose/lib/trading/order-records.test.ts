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
    logId: 'orderHistoryTable.logId',
    workspaceId: 'orderHistoryTable.workspaceId',
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
    const { serializeOrderRecord } = await import('./order-records')

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
          accountId: 'account-1',
          accessToken: 'secret-token',
          credentialId: 'credential-1',
          serviceId: 'alpaca-paper',
          orderType: 'limit',
          quantity: '5',
          side: 'buy',
          timeInForce: 'day',
        },
        response: {
          api_key: 'raw-api-key',
          apiSecret: 'secret-value',
          orderId: 'provider-order-1',
          raw: {
            account_id: 'raw-account-id',
            account_number: 'raw-account-number',
            filled_avg_price: '184.25',
            status: 'filled',
          },
        },
        submissionSource: 'workflow',
        logId: 'log-1',
        workspaceId: 'workspace-1',
      } as any,
      'full'
    )

    expect(record).toMatchObject({
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
    expect(record).not.toHaveProperty('accountId')
    expect(record.request).toMatchObject({
      accountId: '[redacted]',
      accessToken: '[redacted]',
      credentialId: '[redacted]',
      serviceId: '[redacted]',
    })
    expect(record.response).toMatchObject({
      api_key: '[redacted]',
      apiSecret: '[redacted]',
      orderId: 'provider-order-1',
      raw: {
        account_id: '[redacted]',
        account_number: '[redacted]',
      },
    })
  })

  it('serializes order search options from canonical order records', async () => {
    const { serializeOrderSearchOptions } = await import('./order-records')

    const [option] = await serializeOrderSearchOptions([
      {
        environment: 'paper',
        id: 'order-1',
        listingIdentity: null,
        normalizedOrder: {
          symbol: 'BTC/USD',
        },
        provider: 'alpaca',
        recordedAt: new Date('2026-04-23T00:00:00.000Z'),
        request: {
          quantity: '2',
          side: 'buy',
        },
        response: {
          submittedAt: '2026-04-23T01:02:03.000Z',
        },
        submissionSource: 'manual',
        logId: null,
        workspaceId: 'workspace-1',
      } as any,
    ])

    expect(option).toMatchObject({
      environment: 'paper',
      id: 'order-1',
      placedAt: '2026-04-23T01:02:03.000Z',
      provider: 'alpaca',
      quantity: 2,
      quote: 'USD',
      recordedAt: '2026-04-23T00:00:00.000Z',
      side: 'buy',
      symbol: 'BTC',
    })
  })

  it('builds SQL filters for workspace, side, order type, time in force, and linked logs', async () => {
    const { buildOrderWhereCondition } = await import('./order-records')

    buildOrderWhereCondition('workspace-1', {
      environment: 'paper',
      linkedLog: 'true',
      orderSearch: 'AAPL',
      orderType: 'limit',
      provider: 'alpaca',
      side: 'buy',
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
    expect(mocks.isNotNull).toHaveBeenCalledWith('orderHistoryTable.logId')
    expect(mocks.or).toHaveBeenCalled()
  })

  it('casts order record ids to text before search matching', async () => {
    const { buildOrderWhereCondition } = await import('./order-records')

    buildOrderWhereCondition('workspace-1', {
      orderSearch: 'order-1',
    })

    expect(
      mocks.sql.mock.calls.some((call: unknown[]) => {
        const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]]
        const template = Array.from(strings as TemplateStringsArray).join('')
        return (
          template.includes('::text ILIKE') &&
          values.includes('orderHistoryTable.id') &&
          values.includes('%order-1%')
        )
      })
    ).toBe(true)
  })

  it('does not search full JSON blobs as text', async () => {
    const { buildOrderWhereCondition } = await import('./order-records')

    buildOrderWhereCondition('workspace-1', {
      orderSearch: 'provider-order-1',
    })

    const jsonColumns = new Set([
      'orderHistoryTable.listingIdentity',
      'orderHistoryTable.request',
      'orderHistoryTable.response',
      'orderHistoryTable.normalizedOrder',
    ])

    expect(
      mocks.sql.mock.calls.some((call: unknown[]) => {
        const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]]
        const template = Array.from(strings as TemplateStringsArray).join('')
        return template.includes('::text') && values.some((value) => jsonColumns.has(String(value)))
      })
    ).toBe(false)
  })

  it('searches canonical provider, client, listing, and date order fields', async () => {
    const { buildOrderWhereCondition } = await import('./order-records')

    buildOrderWhereCondition('workspace-1', {
      orderSearch: 'provider-order-1',
    })

    const sqlCalls = (mocks.sql.mock.calls as [TemplateStringsArray, ...unknown[]][]).map(
      (call) => {
        const [strings, ...values] = call
        return {
          text: Array.from(strings).join(''),
          values,
        }
      }
    )

    expect(sqlCalls.some((call) => call.text.includes("->'order'->>'order_id'"))).toBe(true)
    expect(sqlCalls.some((call) => call.text.includes("->'order'->>'client_order_id'"))).toBe(true)
    expect(sqlCalls.some((call) => call.text.includes("->>'listing_type'"))).toBe(true)
    expect(sqlCalls.some((call) => call.text.includes('to_char('))).toBe(true)
  })

  it('does not reference joined workflow log columns unless the caller supplies them', async () => {
    const { buildOrderWhereCondition } = await import('./order-records')

    buildOrderWhereCondition('workspace-1', {
      orderSearch: 'Workflow',
    })

    expect(
      mocks.sql.mock.calls.some((call: unknown[]) =>
        call.some((value) => String(value).includes('workflowExecutionLogs'))
      )
    ).toBe(false)
  })

  it('adds caller-owned joined search expressions explicitly', async () => {
    const { buildOrderWhereCondition } = await import('./order-records')
    const joinedExpression = { type: 'joined-search-expression' } as any

    buildOrderWhereCondition(
      'workspace-1',
      {
        orderSearch: 'Workflow',
      },
      { joinedSearchExpressions: [joinedExpression] }
    )

    expect(
      mocks.sql.mock.calls.some((call: unknown[]) => {
        const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]]
        return Array.from(strings).join('').includes('ILIKE') && values.includes(joinedExpression)
      })
    ).toBe(true)
  })
})
