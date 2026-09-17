/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowState } from '@/lib/logs/types'
import { LoggingSession } from './logging-session'

const mocks = vi.hoisted(() => ({
  completeWorkflowExecution: vi.fn(),
  createEnvironmentObject: vi.fn(
    (workflowId: string, executionId: string, userId?: string, workspaceId?: string) => {
      if (!workspaceId) {
        throw new Error('Workflow execution logging requires workspaceId')
      }
      return {
        executionId,
        userId: userId ?? '',
        variables: {},
        workflowId,
        workspaceId,
      }
    }
  ),
  createTriggerObject: vi.fn((type: string, additionalData?: Record<string, unknown>) => {
    const source = typeof additionalData?.source === 'string' ? additionalData.source : type
    const { source: _source, ...data } = additionalData ?? {}
    return {
      data,
      source,
      timestamp: '2026-04-23T00:00:00.000Z',
      type,
    }
  }),
  getResolvedBillingSettings: vi.fn(async () => ({
    billingEnabled: false,
    workflowExecutionChargeUsd: 0.25,
  })),
  getTierWorkflowExecutionMultiplier: vi.fn(() => 1),
  getTierWorkflowModelCostMultiplier: vi.fn(() => 1),
  loadWorkflowSummaryForExecution: vi.fn(() =>
    Promise.resolve({
      color: '#000000',
      createdAt: '2026-04-23T00:00:00.000Z',
      description: null,
      folderId: null,
      folderName: null,
      id: 'workflow-1',
      name: 'Workflow',
      updatedAt: '2026-04-23T00:00:00.000Z',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })
  ),
  resolveWorkspaceBillingContext: vi.fn(() => Promise.resolve({ tier: 'free' })),
  startWorkflowExecution: vi.fn(() =>
    Promise.resolve({
      snapshot: { id: 'snapshot-1' },
      workflowLog: { id: 'log-1' },
    })
  ),
  trackPlatformEvent: vi.fn(),
}))

vi.mock('@/lib/billing/settings', () => ({
  getResolvedBillingSettings: mocks.getResolvedBillingSettings,
}))

vi.mock('@/lib/billing/tiers', () => ({
  getTierWorkflowExecutionMultiplier: mocks.getTierWorkflowExecutionMultiplier,
  getTierWorkflowModelCostMultiplier: mocks.getTierWorkflowModelCostMultiplier,
}))

vi.mock('@/lib/billing/workspace-billing', () => ({
  resolveWorkspaceBillingContext: mocks.resolveWorkspaceBillingContext,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() })),
}))

vi.mock('@/lib/logs/execution/logger', () => ({
  executionLogger: {
    completeWorkflowExecution: mocks.completeWorkflowExecution,
    startWorkflowExecution: mocks.startWorkflowExecution,
  },
}))

vi.mock('@tradinggoose/db', () => ({ db: {} }))
vi.mock('@/lib/logs/execution/logging-factory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./logging-factory')>()),
  createEnvironmentObject: mocks.createEnvironmentObject,
  createTriggerObject: mocks.createTriggerObject,
  loadWorkflowSummaryForExecution: mocks.loadWorkflowSummaryForExecution,
}))

vi.mock('@/lib/telemetry/tracer', () => ({
  trackPlatformEvent: mocks.trackPlatformEvent,
}))

describe('LoggingSession', () => {
  const workflowState: WorkflowState = {
    blocks: {
      block1: {
        id: 'block1',
        type: 'agent',
        name: 'Agent',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
      },
    },
    edges: [],
    loops: {},
    parallels: {},
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getResolvedBillingSettings.mockResolvedValue({
      billingEnabled: false,
      workflowExecutionChargeUsd: 0.25,
    })
    mocks.startWorkflowExecution.mockResolvedValue({
      snapshot: { id: 'snapshot-1' },
      workflowLog: { id: 'log-1' },
    })
  })

  it('starts workflow logging with durable workspace environment, summary, and state', async () => {
    const session = new LoggingSession('workflow-1', 'execution-1', 'manual', 'request-1')

    await expect(
      session.start({
        triggerData: { source: 'records' },
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowState,
      })
    ).resolves.toBe('log-1')

    expect(mocks.loadWorkflowSummaryForExecution).toHaveBeenCalledWith('workflow-1')
    expect(mocks.startWorkflowExecution).toHaveBeenCalledWith({
      environment: {
        executionId: 'execution-1',
        userId: 'user-1',
        variables: {},
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      executionId: 'execution-1',
      trigger: {
        data: {},
        source: 'records',
        timestamp: '2026-04-23T00:00:00.000Z',
        type: 'manual',
      },
      workflowId: 'workflow-1',
      workflowState,
      workflowSummary: expect.objectContaining({
        id: 'workflow-1',
        workspaceId: 'workspace-1',
      }),
    })
  })

  it.each([true, false])(
    'completes failed executions with base-only billing: %s',
    async (billable) => {
      mocks.getResolvedBillingSettings.mockResolvedValue({
        billingEnabled: true,
        workflowExecutionChargeUsd: 0.25,
      })
      const session = new LoggingSession('workflow-1', 'execution-1', 'manual', 'request-1')
      await session.start({ userId: 'user-1', workspaceId: 'workspace-1', workflowState })

      await session.completeWithError({
        endedAt: '2026-04-23T00:00:00.000Z',
        error: { message: 'boom' },
        totalDurationMs: 0,
        billable,
      })

      expect(mocks.completeWorkflowExecution).toHaveBeenCalledWith({
        costSummary: expect.objectContaining({
          baseExecutionCharge: billable ? 0.25 : 0,
          totalCost: billable ? 0.25 : 0,
          modelCost: 0,
        }),
        endedAt: '2026-04-23T00:00:00.000Z',
        executionId: 'execution-1',
        finalOutput: { error: 'boom' },
        success: false,
        totalDurationMs: 1,
        traceSpans: [
          expect.objectContaining({
            duration: 1,
            name: 'Workflow Error',
            output: { error: 'boom' },
            status: 'error',
            type: 'workflow',
          }),
        ],
        workflowLogId: 'log-1',
        workspaceId: 'workspace-1',
      })
      expect(mocks.trackPlatformEvent).toHaveBeenCalledWith(
        'platform.workflow.executed',
        expect.objectContaining({
          'execution.error_message': 'boom',
          'execution.status': 'error',
          'workflow.id': 'workflow-1',
        })
      )
    }
  )

  it('uses explicit workflow success when completing execution logs', async () => {
    mocks.getResolvedBillingSettings.mockResolvedValue({
      billingEnabled: true,
      workflowExecutionChargeUsd: 0.25,
    })
    const session = new LoggingSession('workflow-1', 'execution-1', 'manual', 'request-1', 'log-1')

    await session.complete({
      actorUserId: 'user-1',
      endedAt: '2026-04-23T00:00:01.000Z',
      finalOutput: { ok: true },
      success: true,
      totalDurationMs: 1000,
      traceSpans: [
        {
          duration: 100,
          endTime: '2026-04-23T00:00:00.100Z',
          id: 'block-1',
          name: 'Recoverable Block',
          startTime: '2026-04-23T00:00:00.000Z',
          status: 'error',
          type: 'api',
        },
      ],
      workspaceId: 'workspace-1',
    })

    expect(mocks.resolveWorkspaceBillingContext).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
    })
    expect(mocks.completeWorkflowExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        endedAt: '2026-04-23T00:00:01.000Z',
        executionId: 'execution-1',
        finalOutput: { ok: true },
        success: true,
        totalDurationMs: 1000,
        workflowLogId: 'log-1',
        workspaceId: 'workspace-1',
      })
    )
    expect(mocks.trackPlatformEvent).toHaveBeenCalledWith(
      'platform.workflow.executed',
      expect.objectContaining({
        'execution.has_errors': false,
        'execution.status': 'success',
      })
    )
  })

  it.each(['complete', 'completeWithError'] as const)(
    'keeps %s independent from billing lookup failures',
    async (method) => {
      mocks.getResolvedBillingSettings.mockRejectedValueOnce(new Error('billing unavailable'))
      const session = new LoggingSession(
        'workflow-1',
        'execution-1',
        'manual',
        'request-1',
        'log-1'
      )

      await session[method]({
        endedAt: '2026-04-23T00:00:01.000Z',
        finalOutput: { ok: true },
        success: true,
        totalDurationMs: 1000,
        traceSpans: [],
        workspaceId: 'workspace-1',
        error: { message: 'boom' },
      })

      expect(mocks.completeWorkflowExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          endedAt: '2026-04-23T00:00:01.000Z',
          success: method === 'complete',
        })
      )
    }
  )
})
