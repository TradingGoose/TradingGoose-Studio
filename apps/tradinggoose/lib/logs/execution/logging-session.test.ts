/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowState } from '@/lib/logs/types'
import { LoggingSession } from './logging-session'

const mocks = vi.hoisted(() => ({
  calculateCostSummary: vi.fn(() => ({
    baseExecutionCharge: 0,
    modelCost: 0,
    models: {},
    totalCompletionTokens: 0,
    totalCost: 0,
    totalInputCost: 0,
    totalOutputCost: 0,
    totalPromptTokens: 0,
    totalTokens: 0,
  })),
  completeWorkflowExecution: vi.fn(),
  createEnvironmentObject: vi.fn(
    (
      workflowId: string,
      executionId: string,
      userId?: string,
      workspaceId?: string,
      variables?: Record<string, string>
    ) => {
      if (!workspaceId) {
        throw new Error('Workflow execution logging requires workspaceId')
      }
      return {
        executionId,
        userId: userId ?? '',
        variables: variables ?? {},
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
  getResolvedBillingSettings: vi.fn(() => Promise.resolve({ billingEnabled: false })),
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
  getResolvedBillingSettings: (...args: unknown[]) =>
    (mocks.getResolvedBillingSettings as any)(...args),
}))

vi.mock('@/lib/billing/tiers', () => ({
  getTierWorkflowExecutionMultiplier: (...args: unknown[]) =>
    (mocks.getTierWorkflowExecutionMultiplier as any)(...args),
  getTierWorkflowModelCostMultiplier: (...args: unknown[]) =>
    (mocks.getTierWorkflowModelCostMultiplier as any)(...args),
}))

vi.mock('@/lib/billing/workspace-billing', () => ({
  resolveWorkspaceBillingContext: (...args: unknown[]) =>
    (mocks.resolveWorkspaceBillingContext as any)(...args),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() })),
}))

vi.mock('@/lib/logs/execution/logger', () => ({
  executionLogger: {
    completeWorkflowExecution: (...args: unknown[]) =>
      (mocks.completeWorkflowExecution as any)(...args),
    startWorkflowExecution: (...args: unknown[]) => (mocks.startWorkflowExecution as any)(...args),
  },
}))

vi.mock('@/lib/logs/execution/logging-factory', () => ({
  calculateCostSummary: (...args: unknown[]) => (mocks.calculateCostSummary as any)(...args),
  createEnvironmentObject: (...args: unknown[]) => (mocks.createEnvironmentObject as any)(...args),
  createTriggerObject: (...args: unknown[]) => (mocks.createTriggerObject as any)(...args),
  loadWorkflowSummaryForExecution: (...args: unknown[]) =>
    (mocks.loadWorkflowSummaryForExecution as any)(...args),
}))

vi.mock('@/lib/telemetry/tracer', () => ({
  trackPlatformEvent: (...args: unknown[]) => (mocks.trackPlatformEvent as any)(...args),
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
    mocks.getResolvedBillingSettings.mockResolvedValue({ billingEnabled: false })
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
        variables: { API_URL: 'https://example.com' },
        workspaceId: 'workspace-1',
        workflowState,
      })
    ).resolves.toBe('log-1')

    expect(mocks.loadWorkflowSummaryForExecution).toHaveBeenCalledWith('workflow-1')
    expect(mocks.startWorkflowExecution).toHaveBeenCalledWith({
      environment: {
        executionId: 'execution-1',
        userId: 'user-1',
        variables: { API_URL: 'https://example.com' },
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

  it('completes failed executions with a root error span and final output', async () => {
    const session = new LoggingSession('workflow-1', 'execution-1', 'manual', 'request-1')
    await session.start({ userId: 'user-1', workspaceId: 'workspace-1', workflowState })

    await session.completeWithError({
      endedAt: '2026-04-23T00:00:00.000Z',
      error: { message: 'boom' },
      totalDurationMs: 0,
    })

    expect(mocks.completeWorkflowExecution).toHaveBeenCalledWith({
      costSummary: expect.objectContaining({
        baseExecutionCharge: 0,
        totalCost: 0,
      }),
      endedAt: '2026-04-23T00:00:00.000Z',
      executionId: 'execution-1',
      finalOutput: { error: 'boom' },
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
  })

  it('completes execution logs with explicit workspace scope after a separate start request', async () => {
    mocks.getResolvedBillingSettings.mockResolvedValue({ billingEnabled: true })
    const session = new LoggingSession('workflow-1', 'execution-1', 'manual', 'request-1', 'log-1')

    await session.complete({
      actorUserId: 'user-1',
      endedAt: '2026-04-23T00:00:01.000Z',
      finalOutput: { ok: true },
      totalDurationMs: 1000,
      traceSpans: [],
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
        totalDurationMs: 1000,
        workflowLogId: 'log-1',
        workspaceId: 'workspace-1',
      })
    )
  })
})
