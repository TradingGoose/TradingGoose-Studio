/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowExecutionLog } from '@/lib/logs/types'

const { mockSelectWhere, mockSelect, mockInsertValues, mockInsert, mockTrigger } = vi.hoisted(
  () => {
    const mockSelectWhere = vi.fn()
    const selectChain = {
      from: vi.fn(() => ({
        where: mockSelectWhere,
      })),
    }
    const mockSelect = vi.fn(() => selectChain)
    const mockInsertValues = vi.fn()
    const mockInsert = vi.fn(() => ({
      values: mockInsertValues,
    }))
    const mockTrigger = vi.fn()

    return {
      mockSelectWhere,
      mockSelect,
      mockInsertValues,
      mockInsert,
      mockTrigger,
    }
  }
)

vi.mock('@tradinggoose/db', () => ({
  db: {
    insert: mockInsert,
    select: mockSelect,
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  workflowLogWebhook: {
    active: 'workflowLogWebhook.active',
    workflowId: 'workflowLogWebhook.workflowId',
  },
  workflowLogWebhookDelivery: {
    id: 'workflowLogWebhookDelivery.id',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, type: 'and' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, type: 'eq', value })),
}))

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'delivery-1'),
}))

vi.mock('@/background/logs-webhook-delivery', () => ({
  logsWebhookDelivery: {
    trigger: mockTrigger,
  },
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  })),
}))

const buildLog = (): WorkflowExecutionLog => ({
  id: 'log-1',
  workflowId: null,
  workspaceId: 'workspace-1',
  executionId: 'execution-1',
  stateSnapshotId: 'snapshot-1',
  workflowSummary: {
    color: '#3972F6',
    createdAt: '2026-04-22T00:00:00.000Z',
    description: null,
    id: 'deleted-workflow-1',
    name: 'Deleted Workflow',
    updatedAt: '2026-04-23T00:00:00.000Z',
    userId: 'user-1',
    workspaceId: 'workspace-1',
  },
  level: 'info',
  trigger: 'manual',
  startedAt: '2026-04-23T00:00:00.000Z',
  endedAt: '2026-04-23T00:01:00.000Z',
  totalDurationMs: 60_000,
  executionData: {},
  createdAt: '2026-04-23T00:01:00.000Z',
})

describe('emitWorkflowExecutionCompleted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelectWhere.mockResolvedValue([
      {
        id: 'subscription-1',
        url: 'https://example.com/webhook',
        secret: null,
        includeFinalOutput: true,
        includeTraceSpans: false,
        includeRateLimits: false,
        includeUsageData: false,
        levelFilter: null,
        triggerFilter: null,
      },
    ])
    mockInsertValues.mockResolvedValue(undefined)
  })

  it('queues detached workflow logs by durable delivery id', async () => {
    const { emitWorkflowExecutionCompleted } = await import('./events')

    await emitWorkflowExecutionCompleted(buildLog())

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'execution-1',
        id: 'delivery-1',
        status: 'pending',
        workflowId: 'deleted-workflow-1',
        workspaceId: 'workspace-1',
      })
    )
    expect(mockTrigger).toHaveBeenCalledWith({ deliveryId: 'delivery-1' })
    expect(Object.keys(mockTrigger.mock.calls[0][0])).toEqual(['deliveryId'])
  })
})
