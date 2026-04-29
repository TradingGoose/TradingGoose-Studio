/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resolveTradingProviderContext,
  resolveTradingProviderSelectedAccount,
} from '@/app/api/providers/trading/shared'
import { executeTradingProviderOrderDetailRequest } from '@/providers/trading'

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
    workflowId: 'orderHistoryTable.workflowId',
    workflowExecutionId: 'orderHistoryTable.workflowExecutionId',
    workflowLogId: 'orderHistoryTable.workflowLogId',
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

vi.mock('@/app/api/providers/trading/shared', () => ({
  resolveTradingProviderContext: vi.fn(),
  resolveTradingProviderSelectedAccount: vi.fn(),
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
  workflowId: 'workflow-1',
  workflowExecutionId: 'execution-1',
  workflowLogId: 'log-1',
  listingIdentity: { listing_type: 'stock', listing_id: 'AAPL' },
  request: { accountId: 'account-1', side: 'buy' },
  response: { orderId: 'provider-order-1' },
  normalizedOrder: { symbol: 'AAPL', status: 'filled' },
}

describe('order provider detail route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.chains.length = 0
    mocks.resultsQueue.length = 0
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.checkWorkspaceAccess.mockResolvedValue({ exists: true, hasAccess: true })
    vi.mocked(resolveTradingProviderContext).mockResolvedValue({
      accessToken: 'access-token-1',
      environment: 'paper',
      provider: 'alpaca',
    } as any)
    vi.mocked(resolveTradingProviderSelectedAccount).mockResolvedValue({
      accountId: 'account-1',
    } as any)
    vi.mocked(executeTradingProviderOrderDetailRequest).mockResolvedValue({
      providerOrderId: 'provider-order-1',
      status: 'filled',
    } as any)
  })

  it('loads the workspace order and requests live provider detail with selected account context', async () => {
    mocks.resultsQueue.push([orderRow])
    const { POST } = await import('./route')

    const response = await POST(
      new NextRequest(
        'http://localhost/api/orders/order-1/provider-detail?workspaceId=workspace-1',
        {
          body: JSON.stringify({
            accountId: 'account-1',
            credentialId: 'credential-1',
            environment: 'paper',
          }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        }
      ),
      { params: Promise.resolve({ orderId: 'order-1' }) }
    )

    expect(response.status).toBe(200)
    expect(mocks.checkWorkspaceAccess).toHaveBeenCalledWith('workspace-1', 'user-1')
    expect(mocks.eq).toHaveBeenCalledWith('orderHistoryTable.id', 'order-1')
    expect(mocks.eq).toHaveBeenCalledWith('orderHistoryTable.workspaceId', 'workspace-1')
    expect(resolveTradingProviderContext).toHaveBeenCalledWith({
      operationKind: 'order',
      requestData: {
        credentialId: 'credential-1',
        environment: 'paper',
        provider: 'alpaca',
      },
      requestId: 'request-1',
    })
    expect(resolveTradingProviderSelectedAccount).toHaveBeenCalledWith({
      accountId: 'account-1',
      baseContext: expect.objectContaining({ accessToken: 'access-token-1' }),
    })
    expect(executeTradingProviderOrderDetailRequest).toHaveBeenCalledWith(
      'alpaca',
      expect.objectContaining({ id: 'order-1', workspaceId: 'workspace-1' }),
      expect.objectContaining({
        accessToken: 'access-token-1',
        accountId: 'account-1',
        environment: 'paper',
        orderId: 'order-1',
        provider: 'alpaca',
      })
    )
    expect(await response.json()).toEqual({
      data: {
        orderId: 'order-1',
        provider: 'alpaca',
        providerDetail: {
          providerOrderId: 'provider-order-1',
          status: 'filled',
        },
      },
    })
  })
})
