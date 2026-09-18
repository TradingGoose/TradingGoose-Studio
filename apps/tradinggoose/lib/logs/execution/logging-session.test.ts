/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TraceSpan, WorkflowState } from '@/lib/logs/types'
import { LoggingSession } from './logging-session'

const mocks = vi.hoisted(() => ({
  completeWorkflowExecution: vi.fn(),
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
  startWorkflowExecution: vi.fn(() =>
    Promise.resolve({
      snapshot: { id: 'snapshot-1' },
      workflowLog: { id: 'log-1' },
    })
  ),
  trackPlatformEvent: vi.fn(),
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
    mocks.completeWorkflowExecution.mockResolvedValue({ cost: { total: 2.25 } })
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
    'passes explicit completion and billing eligibility: %s',
    async (billable) => {
      const session = new LoggingSession(
        'workflow-1',
        'execution-1',
        'manual',
        'request-1',
        'log-1'
      )
      await session.complete({
        endedAt: '2026-04-23T00:00:00.000Z',
        success: false,
        failureReason: 'Workflow execution was cancelled',
        workspaceId: 'workspace-1',
        traceSpans: modelSpans,
        billable,
      })
      expect(mocks.completeWorkflowExecution).toHaveBeenCalledExactlyOnceWith({
        endedAt: '2026-04-23T00:00:00.000Z',
        executionId: 'execution-1',
        workflowLogId: 'log-1',
        workspaceId: 'workspace-1',
        success: false,
        failureReason: 'Workflow execution was cancelled',
        totalDurationMs: 0,
        finalOutput: {},
        traceSpans: modelSpans,
        billable,
        hasResponseBlock: undefined,
        variables: undefined,
        workflowInput: undefined,
      })
      expect(mocks.trackPlatformEvent).toHaveBeenCalledWith(
        'platform.workflow.executed',
        expect.objectContaining({
          'execution.error_message': 'Workflow execution was cancelled',
          'execution.total_cost': 2.25,
          'execution.status': 'error',
        })
      )
    }
  )

  it('uses explicit success even with recovered error spans', async () => {
    const session = new LoggingSession('workflow-1', 'execution-1', 'manual', undefined, 'log-1')
    await session.complete({
      success: true,
      traceSpans: [{ ...modelSpans[0], status: 'error' }],
      workspaceId: 'workspace-1',
    })
    expect(mocks.completeWorkflowExecution).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    )
    expect(mocks.trackPlatformEvent).toHaveBeenCalledWith(
      'platform.workflow.executed',
      expect.objectContaining({ 'execution.has_errors': false, 'execution.status': 'success' })
    )
  })

  it('propagates settlement failure so durable accounting can be retried', async () => {
    mocks.completeWorkflowExecution.mockRejectedValueOnce(new Error('billing unavailable'))
    const session = new LoggingSession('workflow-1', 'execution-1', 'manual', undefined, 'log-1')
    await expect(session.complete({ success: true, workspaceId: 'workspace-1' })).rejects.toThrow(
      'billing unavailable'
    )
    expect(mocks.trackPlatformEvent).not.toHaveBeenCalled()
  })
})
