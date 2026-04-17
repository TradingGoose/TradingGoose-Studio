/**
 * Integration tests for scheduled workflow execution API route
 *
 * @vitest-environment node
 */
import type { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function createMockRequest(): NextRequest {
  const mockHeaders = new Map([
    ['authorization', 'Bearer test-cron-secret'],
    ['content-type', 'application/json'],
  ])

  return {
    headers: {
      get: (key: string) => mockHeaders.get(key.toLowerCase()) || null,
    },
    url: 'http://localhost:3000/api/schedules/execute',
  } as NextRequest
}

describe('Scheduled Workflow Execution API Route', () => {
  const enqueuePendingExecutionMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    enqueuePendingExecutionMock.mockReset()
    enqueuePendingExecutionMock.mockResolvedValue({
      pendingExecutionId: 'pending-schedule-1',
      billingScopeId: 'billing-scope-1',
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('should return 503 when due schedules cannot be queued because Trigger.dev is unavailable', async () => {
    vi.doMock('@/lib/auth/internal', () => ({
      verifyCronAuth: vi.fn().mockReturnValue(null),
    }))

    vi.doMock('@/lib/api-key/service', () => ({
      getApiKeyOwnerUserId: vi.fn().mockResolvedValue('test-user-id'),
    }))

    class MockTriggerExecutionUnavailableError extends Error {
      statusCode: number
      constructor(message: string, statusCode = 503) {
        super(message)
        this.name = 'TriggerExecutionUnavailableError'
        this.statusCode = statusCode
      }
    }

    vi.doMock('@/lib/trigger/settings', () => ({
      TriggerExecutionUnavailableError: MockTriggerExecutionUnavailableError,
    }))

    enqueuePendingExecutionMock.mockRejectedValueOnce(
      new MockTriggerExecutionUnavailableError(
        'Trigger.dev is required for scheduled executions, but it is disabled or not configured.'
      )
    )

    vi.doMock('@/lib/execution/pending-execution', () => ({
      enqueuePendingExecution: enqueuePendingExecutionMock,
      isPendingExecutionLimitError: vi.fn(() => false),
    }))

    vi.doMock('drizzle-orm', () => ({
      asc: vi.fn((column) => ({ type: 'asc', column })),
      and: vi.fn((...conditions) => ({ type: 'and', conditions })),
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
      lte: vi.fn((field, value) => ({ field, value, type: 'lte' })),
      not: vi.fn((condition) => ({ type: 'not', condition })),
      sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
        strings,
        values,
      })),
    }))

    vi.doMock('@tradinggoose/db', () => {
      const scheduleRows = [
        {
          id: 'schedule-1',
          workflowId: 'workflow-1',
          blockId: null,
          cronExpression: null,
          lastRanAt: null,
          failedCount: 0,
          timezone: 'UTC',
          nextRunAt: new Date('2024-01-01T00:00:00.000Z'),
        },
      ]

      const workflowRows = [
        {
          workspaceId: 'workspace-1',
          pinnedApiKeyId: 'api-key-1',
        },
      ]

      let selectCallCount = 0
      const mockDb = {
        select: vi.fn().mockImplementation(() => {
          selectCallCount += 1

          return {
            from: vi.fn().mockImplementation(() => {
              if (selectCallCount === 1) {
                return {
                  where: vi.fn().mockResolvedValue(scheduleRows),
                }
              }

              return {
                where: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue(workflowRows),
                }),
              }
            }),
          }
        }),
      }

      return {
        db: mockDb,
        workflowSchedule: {},
        workflow: {},
      }
    })

    const { TriggerExecutionUnavailableError } = await import('@/lib/trigger/settings')
    enqueuePendingExecutionMock.mockRejectedValueOnce(
      new TriggerExecutionUnavailableError(
        'Trigger.dev is required for scheduled executions, but it is disabled or not configured.'
      )
    )

    const { GET } = await import('@/app/api/schedules/execute/route')
    const response = await GET(createMockRequest())

    expect(response).toBeDefined()
    expect(response.status).toBe(503)
    const data = await response.json()
    expect(data.error).toContain('Trigger.dev is required for scheduled executions')
  })

  it('should queue schedules through pending execution when enabled', async () => {
    vi.doMock('@/lib/auth/internal', () => ({
      verifyCronAuth: vi.fn().mockReturnValue(null),
    }))

    vi.doMock('@/lib/api-key/service', () => ({
      getApiKeyOwnerUserId: vi.fn().mockResolvedValue('test-user-id'),
    }))

    vi.doMock('@/lib/trigger/settings', () => ({
      TriggerExecutionUnavailableError: class TriggerExecutionUnavailableError extends Error {
        constructor(
          message: string,
          public statusCode = 503
        ) {
          super(message)
          this.name = 'TriggerExecutionUnavailableError'
        }
      },
    }))

    vi.doMock('drizzle-orm', () => ({
      asc: vi.fn((column) => ({ type: 'asc', column })),
      and: vi.fn((...conditions) => ({ type: 'and', conditions })),
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
      lte: vi.fn((field, value) => ({ field, value, type: 'lte' })),
      not: vi.fn((condition) => ({ type: 'not', condition })),
      sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
        strings,
        values,
      })),
    }))

    vi.doMock('@/lib/execution/pending-execution', () => ({
      enqueuePendingExecution: enqueuePendingExecutionMock,
      isPendingExecutionLimitError: vi.fn(() => false),
    }))

    vi.doMock('@tradinggoose/db', () => {
      const scheduleRows = [
        {
          id: 'schedule-1',
          workflowId: 'workflow-1',
          blockId: null,
          cronExpression: null,
          lastRanAt: null,
          failedCount: 0,
          timezone: 'UTC',
          nextRunAt: new Date('2024-01-01T00:00:00.000Z'),
        },
      ]

      const workflowRows = [
        {
          workspaceId: 'workspace-1',
          pinnedApiKeyId: 'api-key-1',
        },
      ]

      let selectCallCount = 0
      const mockDb = {
        select: vi.fn().mockImplementation(() => {
          selectCallCount += 1

          return {
            from: vi.fn().mockImplementation(() => {
              if (selectCallCount === 1) {
                return {
                  where: vi.fn().mockResolvedValue(scheduleRows),
                }
              }

              return {
                where: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue(workflowRows),
                }),
              }
            }),
          }
        }),
      }

      return {
        db: mockDb,
        workflowSchedule: {},
        workflow: {},
      }
    })

    const { GET } = await import('@/app/api/schedules/execute/route')
    const response = await GET(createMockRequest())

    expect(response).toBeDefined()
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveProperty('executedCount', 1)
    expect(enqueuePendingExecutionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        executionType: 'schedule',
        userId: 'test-user-id',
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      })
    )
  })

  it('should handle case with no due schedules', async () => {
    vi.doMock('@/lib/auth/internal', () => ({
      verifyCronAuth: vi.fn().mockReturnValue(null),
    }))

    vi.doMock('@/lib/trigger/settings', () => ({
      TriggerExecutionUnavailableError: class TriggerExecutionUnavailableError extends Error {
        constructor(
          message: string,
          public statusCode = 503
        ) {
          super(message)
          this.name = 'TriggerExecutionUnavailableError'
        }
      },
    }))

    vi.doMock('drizzle-orm', () => ({
      asc: vi.fn((column) => ({ type: 'asc', column })),
      and: vi.fn((...conditions) => ({ type: 'and', conditions })),
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
      lte: vi.fn((field, value) => ({ field, value, type: 'lte' })),
      not: vi.fn((condition) => ({ type: 'not', condition })),
      sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
        strings,
        values,
      })),
    }))

    vi.doMock('@tradinggoose/db', () => {
      const mockDb = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => []),
          })),
        })),
      }

      return {
        db: mockDb,
        workflowSchedule: {},
        workflow: {},
      }
    })

    const { GET } = await import('@/app/api/schedules/execute/route')
    const response = await GET(createMockRequest())

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveProperty('message')
    expect(data).toHaveProperty('executedCount', 0)
  })

  it('should execute multiple schedules in parallel', async () => {
    vi.doMock('@/lib/auth/internal', () => ({
      verifyCronAuth: vi.fn().mockReturnValue(null),
    }))

    vi.doMock('@/lib/api-key/service', () => ({
      getApiKeyOwnerUserId: vi.fn().mockResolvedValue('test-user-id'),
    }))

    vi.doMock('@/lib/trigger/settings', () => ({
      TriggerExecutionUnavailableError: class TriggerExecutionUnavailableError extends Error {
        constructor(
          message: string,
          public statusCode = 503
        ) {
          super(message)
          this.name = 'TriggerExecutionUnavailableError'
        }
      },
    }))

    vi.doMock('drizzle-orm', () => ({
      and: vi.fn((...conditions) => ({ type: 'and', conditions })),
      eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
      lte: vi.fn((field, value) => ({ field, value, type: 'lte' })),
      not: vi.fn((condition) => ({ type: 'not', condition })),
    }))

    vi.doMock('@/lib/execution/pending-execution', () => ({
      enqueuePendingExecution: enqueuePendingExecutionMock,
      isPendingExecutionLimitError: vi.fn(() => false),
    }))

    vi.doMock('@tradinggoose/db', () => {
      const scheduleRows = [
        {
          id: 'schedule-1',
          workflowId: 'workflow-1',
          blockId: null,
          cronExpression: null,
          lastRanAt: null,
          failedCount: 0,
          timezone: 'UTC',
          nextRunAt: new Date('2024-01-01T00:00:00.000Z'),
        },
        {
          id: 'schedule-2',
          workflowId: 'workflow-2',
          blockId: null,
          cronExpression: null,
          lastRanAt: null,
          failedCount: 0,
          timezone: 'UTC',
          nextRunAt: new Date('2024-01-01T00:00:00.000Z'),
        },
      ]

      const workflowRows = [
        {
          workspaceId: 'workspace-1',
          pinnedApiKeyId: 'api-key-1',
        },
      ]

      let selectCallCount = 0
      const mockDb = {
        select: vi.fn().mockImplementation(() => {
          selectCallCount += 1

          return {
            from: vi.fn().mockImplementation(() => {
              if (selectCallCount === 1) {
                return {
                  where: vi.fn().mockResolvedValue(scheduleRows),
                }
              }

              return {
                where: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue(workflowRows),
                }),
              }
            }),
          }
        }),
      }

      return {
        db: mockDb,
        workflowSchedule: {},
        workflow: {},
      }
    })

    const { GET } = await import('@/app/api/schedules/execute/route')
    const response = await GET(createMockRequest())

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveProperty('executedCount', 2)
    expect(enqueuePendingExecutionMock).toHaveBeenCalledTimes(2)
  })
})
