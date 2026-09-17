/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TraceSpan, WorkflowState } from '@/lib/logs/types'
import { LoggingSession } from './logging-session'

const mocks = vi.hoisted(() => ({
  completeWorkflowExecution: vi.fn(),
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
  loadWorkflowSummaryForExecution: mocks.loadWorkflowSummaryForExecution,
}))

vi.mock('@/lib/telemetry/tracer', () => ({
  trackPlatformEvent: mocks.trackPlatformEvent,
}))

describe('LoggingSession', () => {
  const modelSpans: TraceSpan[] = [
    {
      id: 'agent',
      name: 'Agent',
      type: 'agent',
      duration: 1000,
      status: 'success',
      startTime: '2026-04-23T00:00:00.000Z',
      endTime: '2026-04-23T00:00:01.000Z',
      model: 'test-model',
      cost: { input: 1.5, output: 0.5, total: 2 },
      tokens: { prompt: 100, completion: 50, total: 150 },
    },
  ]
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
    mocks.getTierWorkflowModelCostMultiplier.mockReturnValue(1)
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
        source: 'records',
        timestamp: expect.any(String),
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
    'completes failures before model calls with only the applicable base charge: %s',
    async (billable) => {
      mocks.getResolvedBillingSettings.mockResolvedValue({
        billingEnabled: true,
        workflowExecutionChargeUsd: 0.25,
      })
      const session = new LoggingSession('workflow-1', 'execution-1', 'manual', 'request-1')
      await session.start({ userId: 'user-1', workspaceId: 'workspace-1', workflowState })

      await session.complete({
        endedAt: '2026-04-23T00:00:00.000Z',
        success: false,
        failureReason: 'boom',
        totalDurationMs: 0,
        billable,
      })

      expect(mocks.completeWorkflowExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          costSummary: expect.objectContaining({
            baseExecutionCharge: billable ? 0.25 : 0,
            totalCost: billable ? 0.25 : 0,
            modelCost: 0,
          }),
          endedAt: '2026-04-23T00:00:00.000Z',
          executionId: 'execution-1',
          finalOutput: {},
          failureReason: 'boom',
          success: false,
          totalDurationMs: 0,
          traceSpans: [],
          workflowLogId: 'log-1',
          workspaceId: 'workspace-1',
        })
      )
      expect(mocks.trackPlatformEvent).toHaveBeenCalledWith(
        'platform.workflow.executed',
        expect.objectContaining({
          'execution.error_message': 'boom',
          'execution.status': 'error',
          'execution.blocks_executed': 0,
          'workflow.id': 'workflow-1',
        })
      )
    }
  )

  it.each([
    [true, 1],
    [true, 1.5],
    [false, 1.5],
  ] as const)(
    'preserves incurred model costs and tokens (billable: %s, multiplier: %s)',
    async (billable, multiplier) => {
      mocks.getResolvedBillingSettings.mockResolvedValue({
        billingEnabled: true,
        workflowExecutionChargeUsd: 0.25,
      })
      mocks.getTierWorkflowModelCostMultiplier.mockReturnValue(multiplier)
      const session = new LoggingSession('workflow-1', 'execution-1', 'manual', undefined, 'log-1')
      await session.complete({
        success: false,
        failureReason: 'Workflow execution was cancelled',
        workspaceId: 'workspace-1',
        actorUserId: 'user-1',
        traceSpans: modelSpans,
        billable,
      })
      expect(mocks.completeWorkflowExecution).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          traceSpans: modelSpans,
          costSummary: {
            totalCost: 2 * multiplier + (billable ? 0.25 : 0),
            baseExecutionCharge: billable ? 0.25 : 0,
            modelCost: 2 * multiplier,
            totalInputCost: 1.5 * multiplier,
            totalOutputCost: 0.5 * multiplier,
            totalPromptTokens: 100,
            totalCompletionTokens: 50,
            totalTokens: 150,
            models: {
              'test-model': {
                input: 1.5 * multiplier,
                output: 0.5 * multiplier,
                total: 2 * multiplier,
                tokens: { prompt: 100, completion: 50, total: 150 },
              },
            },
          },
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
      traceSpans: [{ ...modelSpans[0], status: 'error' }],
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

  it.each([true, false])(
    'keeps terminal completion independent from billing lookup failures (success: %s)',
    async (success) => {
      mocks.getResolvedBillingSettings.mockRejectedValueOnce(new Error('billing unavailable'))
      const session = new LoggingSession(
        'workflow-1',
        'execution-1',
        'manual',
        'request-1',
        'log-1'
      )

      await session.complete({
        endedAt: '2026-04-23T00:00:01.000Z',
        finalOutput: { ok: true },
        success,
        totalDurationMs: 1000,
        traceSpans: modelSpans,
        workspaceId: 'workspace-1',
        failureReason: success ? undefined : 'boom',
      })

      expect(mocks.completeWorkflowExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          endedAt: '2026-04-23T00:00:01.000Z',
          success,
          costSummary: expect.objectContaining({
            totalCost: 2,
            modelCost: 2,
            baseExecutionCharge: 0,
            totalTokens: 150,
          }),
        })
      )
    }
  )
})
