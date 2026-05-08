/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const selectQueue: unknown[][] = []
  const values = vi.fn()
  const returning = vi.fn()

  const makeSelectChain = () => {
    const chain: Record<string, any> = {}
    chain.from = vi.fn(() => chain)
    chain.where = vi.fn(() => chain)
    chain.orderBy = vi.fn(() => Promise.resolve(selectQueue.shift() ?? []))
    chain.limit = vi.fn(() => Promise.resolve(selectQueue.shift() ?? []))
    return chain
  }

  return {
    selectQueue,
    checkAuth: vi.fn(),
    checkWorkspaceAccess: vi.fn(),
    insert: vi.fn(() => ({ values })),
    returning,
    select: vi.fn(makeSelectChain),
    values,
  }
})

vi.mock('@tradinggoose/db', () => ({
  db: {
    insert: mocks.insert,
    select: mocks.select,
  },
  orderHistoryTable: {
    workspaceId: 'orderHistoryTable.workspaceId',
    recordedAt: 'orderHistoryTable.recordedAt',
    logId: 'orderHistoryTable.logId',
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
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

const postRequest = (body: Record<string, unknown>) =>
  new NextRequest('http://localhost/api/tools/trading/order-history', {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })

const baseBody = {
  workspaceId: 'workspace-1',
  provider: 'alpaca',
  submissionSource: 'workflow',
  request: { side: 'buy' },
  response: { orderId: 'order-1' },
}

describe('order history support route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.selectQueue.length = 0
    mocks.checkAuth.mockResolvedValue({ success: true, userId: 'user-1' })
    mocks.checkWorkspaceAccess.mockResolvedValue({ exists: true, hasAccess: true, canWrite: true })
    mocks.returning.mockResolvedValue([{ id: 'order-history-1' }])
    mocks.values.mockReturnValue({ returning: mocks.returning })
  })

  it('rejects inserts without explicit workspace scope', async () => {
    const { POST } = await import('./route')

    const response = await POST(postRequest({ ...baseBody, workspaceId: undefined }))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      success: false,
      error: { message: 'workspaceId is required' },
    })
    expect(mocks.select).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('rejects inaccessible POST workspace scope before reading log ownership', async () => {
    mocks.checkWorkspaceAccess.mockResolvedValue({ exists: true, hasAccess: true, canWrite: false })
    const { POST } = await import('./route')

    const response = await POST(postRequest({ ...baseBody, logId: 'log-1' }))

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      success: false,
      error: { message: 'Not found' },
    })
    expect(mocks.checkWorkspaceAccess).toHaveBeenCalledWith('workspace-1', 'user-1')
    expect(mocks.select).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('rejects requested logs from another workspace', async () => {
    mocks.selectQueue.push([{ id: 'log-2', workspaceId: 'workspace-2' }])
    const { POST } = await import('./route')

    const response = await POST(postRequest({ ...baseBody, logId: 'log-2' }))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      success: false,
      error: { message: 'logId does not belong to the workspace' },
    })
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('stores explicit log links within the same workspace', async () => {
    mocks.selectQueue.push([{ id: 'log-1', workspaceId: 'workspace-1' }])
    const { POST } = await import('./route')

    const response = await POST(
      postRequest({
        ...baseBody,
        logId: 'log-1',
      })
    )

    expect(response.status).toBe(201)
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        logId: 'log-1',
        submissionSource: 'workflow',
      })
    )
  })

  it('returns workspace history without log-specific filters', async () => {
    mocks.checkWorkspaceAccess.mockResolvedValue({ exists: true, hasAccess: true })
    mocks.selectQueue.push([{ id: 'order-history-1' }])
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
        workspaceId: 'workspace-1',
      },
    })
  })
})
