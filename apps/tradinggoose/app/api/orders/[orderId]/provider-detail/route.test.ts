/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authorizeTradingCredentialRequest,
  resolveTradingProviderContext,
} from '@/lib/trading/context'
import { executeTradingProviderOrderDetailRequest } from '@/providers/trading'
import { TradingBrokerRequestError } from '@/providers/trading/portfolio-utils'

const mocks = vi.hoisted(() => {
  const resultsQueue: unknown[][] = []
  const chains: Array<Record<string, any>> = []
  const makeChain = () => {
    const chain: Record<string, any> = {}
    chain.from = vi.fn(() => chain)
    chain.where = vi.fn(() => chain)
    chain.limit = vi.fn(() => chain)
    chain.then = (resolve: (value: unknown[]) => unknown, reject: (reason?: unknown) => unknown) =>
      Promise.resolve(resultsQueue.shift() ?? []).then(resolve, reject)
    chains.push(chain)
    return chain
  }

  return {
    chains,
    checkAuth: vi.fn(),
    checkWorkspaceAccess: vi.fn(),
    eq: vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value })),
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
    workflowSummary: 'workflowExecutionLogs.workflowSummary',
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
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings: Array.from(strings),
      type: 'sql',
      values,
    })),
    {
      join: vi.fn((values: unknown[], separator: unknown) => ({
        separator,
        type: 'sql.join',
        values,
      })),
      raw: vi.fn((value: string) => ({ type: 'sql.raw', value })),
    }
  ),
}))

vi.mock('@/lib/trading/context', () => ({
  authorizeTradingCredentialRequest: vi.fn(),
  logTradingBrokerRequestFailure: vi.fn(),
  resolveTradingProviderContext: vi.fn(),
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

vi.mock('@/providers/trading', () => ({
  executeTradingProviderOrderDetailRequest: vi.fn(),
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
  request: {
    accountId: 'account-1',
    credentialId: 'credential-1',
    serviceId: 'alpaca-paper',
    side: 'buy',
  },
  response: { orderId: 'provider-order-1' },
  normalizedOrder: { symbol: 'AAPL', status: 'filled' },
}

describe('order provider detail route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.chains.length = 0
    mocks.resultsQueue.length = 0
    mocks.checkAuth.mockResolvedValue({ success: true, userId: 'user-1' })
    mocks.checkWorkspaceAccess.mockResolvedValue({ exists: true, hasAccess: true })
    vi.mocked(authorizeTradingCredentialRequest).mockResolvedValue({
      credentialOwnerUserId: 'credential-owner-1',
      tokenAccountId: 'account-credential-1',
    })
    vi.mocked(resolveTradingProviderContext).mockResolvedValue({
      accessToken: 'access-token-1',
      environment: 'paper',
      provider: 'alpaca',
    } as any)
    vi.mocked(executeTradingProviderOrderDetailRequest).mockResolvedValue({
      providerOrderId: 'provider-order-1',
      orderDetail: { status: 'filled' },
    } as any)
  })

  it('loads the workspace order and requests live provider detail from recorded order context', async () => {
    mocks.resultsQueue.push([orderRow])
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest(
        'http://localhost/api/orders/order-1/provider-detail?workspaceId=workspace-1',
        { method: 'POST' }
      ),
      { params: Promise.resolve({ orderId: 'order-1' }) }
    )

    expect(response.status).toBe(200)
    expect(mocks.checkAuth).toHaveBeenCalledWith(expect.any(NextRequest), {
      requireWorkflowId: false,
    })
    expect(mocks.checkWorkspaceAccess).toHaveBeenCalledWith('workspace-1', 'user-1')
    expect(mocks.eq).toHaveBeenCalledWith('orderHistoryTable.id', 'order-1')
    expect(mocks.eq).toHaveBeenCalledWith('orderHistoryTable.workspaceId', 'workspace-1')
    expect(authorizeTradingCredentialRequest).toHaveBeenCalledWith({
      request: expect.any(NextRequest),
      credentialId: 'credential-1',
      workspaceId: 'workspace-1',
      workflowId: undefined,
    })
    expect(resolveTradingProviderContext).toHaveBeenCalledWith({
      requestData: {
        credentialId: 'credential-1',
        serviceId: 'alpaca-paper',
        provider: 'alpaca',
      },
      requestId: 'request-1',
      userId: 'user-1',
      credentialOwnerUserId: 'credential-owner-1',
      tokenAccountId: 'account-credential-1',
    })
    expect(executeTradingProviderOrderDetailRequest).toHaveBeenCalledWith(
      'alpaca',
      expect.objectContaining({ id: 'order-1', workspaceId: 'workspace-1' }),
      expect.objectContaining({
        accessToken: 'access-token-1',
        environment: 'paper',
        orderId: 'order-1',
        provider: 'alpaca',
      })
    )
    expect(await response.json()).toEqual({
      data: {
        appOrderId: 'order-1',
        logId: 'log-1',
        orderId: 'order-1',
        orderDetail: { status: 'filled' },
        provider: 'alpaca',
        providerOrderId: 'provider-order-1',
        providerDetail: {
          providerOrderId: 'provider-order-1',
          orderDetail: { status: 'filled' },
        },
        workspaceId: 'workspace-1',
      },
    })
  })

  it('rejects provider-detail refresh when the order record has no credential context', async () => {
    mocks.resultsQueue.push([{ ...orderRow, request: { accountId: 'account-1' } }])
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest(
        'http://localhost/api/orders/order-1/provider-detail?workspaceId=workspace-1',
        { method: 'POST' }
      ),
      { params: Promise.resolve({ orderId: 'order-1' }) }
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Order history record is missing trading credential context',
    })
    expect(resolveTradingProviderContext).not.toHaveBeenCalled()
  })

  it('maps provider detail broker failures without returning a generic 500', async () => {
    mocks.resultsQueue.push([orderRow])
    vi.mocked(executeTradingProviderOrderDetailRequest).mockRejectedValueOnce(
      new TradingBrokerRequestError({
        message: 'Provider order not found',
        providerId: 'alpaca',
        status: 404,
        url: 'https://broker.example/orders/provider-order-1',
      })
    )
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest(
        'http://localhost/api/orders/order-1/provider-detail?workspaceId=workspace-1',
        { method: 'POST' }
      ),
      { params: Promise.resolve({ orderId: 'order-1' }) }
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Broker request failed' })
  })

  it('maps broker network failures to a valid 502 response', async () => {
    mocks.resultsQueue.push([orderRow])
    vi.mocked(executeTradingProviderOrderDetailRequest).mockRejectedValueOnce(
      new TradingBrokerRequestError({
        message: 'fetch failed',
        providerId: 'alpaca',
        status: 0,
        url: 'https://broker.example/orders/provider-order-1',
      })
    )
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest(
        'http://localhost/api/orders/order-1/provider-detail?workspaceId=workspace-1',
        { method: 'POST' }
      ),
      { params: Promise.resolve({ orderId: 'order-1' }) }
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'Broker request failed' })
  })
})
