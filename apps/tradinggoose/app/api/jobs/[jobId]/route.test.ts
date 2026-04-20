/**
 * @vitest-environment node
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { NextResponse } from 'next/server'

const {
  checkHybridAuthMock,
  eqMock,
  andMock,
  limitMock,
} = vi.hoisted(() => ({
  checkHybridAuthMock: vi.fn(),
  eqMock: vi.fn((field, value) => ({ field, value })),
  andMock: vi.fn((...args) => ({ args })),
  limitMock: vi.fn(),
}))

const queryChain = {
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: limitMock,
}

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: vi.fn(() => queryChain),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  pendingExecution: {
    id: 'pendingExecution.id',
    userId: 'pendingExecution.userId',
    status: 'pendingExecution.status',
    errorMessage: 'pendingExecution.errorMessage',
    createdAt: 'pendingExecution.createdAt',
    processingStartedAt: 'pendingExecution.processingStartedAt',
    result: 'pendingExecution.result',
    completedAt: 'pendingExecution.completedAt',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: eqMock,
  and: andMock,
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkHybridAuth: checkHybridAuthMock,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

vi.mock('@/lib/utils', () => ({
  generateRequestId: vi.fn(() => 'request-1'),
}))

vi.mock('@/app/api/workflows/utils', () => ({
  createErrorResponse: (message: string, status: number) =>
    NextResponse.json({ message }, { status }),
}))

import { GET } from './route'

describe('GET /api/jobs/[jobId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryChain.from.mockReturnThis()
    queryChain.where.mockReturnThis()
    checkHybridAuthMock.mockResolvedValue({
      success: true,
      userId: 'user-1',
    })
  })

  it('requires authentication', async () => {
    checkHybridAuthMock.mockResolvedValue({
      success: false,
      userId: null,
    })

    const response = await GET(new Request('http://localhost/api/jobs/job-1') as any, {
      params: Promise.resolve({ jobId: 'job-1' }),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      message: 'Authentication required',
    })
  })

  it('filters task lookup by the authenticated user', async () => {
    limitMock.mockResolvedValue([
      {
        id: 'job-1',
        status: 'failed',
        errorMessage: 'Function execution failed',
        createdAt: new Date('2026-04-16T00:00:00.000Z'),
        processingStartedAt: new Date('2026-04-16T00:00:01.000Z'),
        result: null,
        completedAt: new Date('2026-04-16T00:00:02.000Z'),
      },
    ])

    const response = await GET(new Request('http://localhost/api/jobs/job-1') as any, {
      params: Promise.resolve({ jobId: 'job-1' }),
    })

    expect(eqMock).toHaveBeenNthCalledWith(1, 'pendingExecution.id', 'job-1')
    expect(eqMock).toHaveBeenNthCalledWith(2, 'pendingExecution.userId', 'user-1')
    expect(andMock).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      taskId: 'job-1',
      status: 'failed',
      error: 'Function execution failed',
    })
  })
})
