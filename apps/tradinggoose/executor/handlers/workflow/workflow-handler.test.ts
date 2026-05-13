import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateInternalToken } from '@/lib/auth/internal'
import { BlockType } from '@/executor/consts'
import { WorkflowBlockHandler } from '@/executor/handlers/workflow/workflow-handler'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

vi.mock('@/lib/auth/internal', () => ({
  generateInternalToken: vi.fn().mockResolvedValue('test-token'),
}))

vi.mock('@/lib/urls/utils', () => ({
  getBaseUrl: vi.fn(() => 'http://localhost:3000'),
}))

global.fetch = vi.fn()

describe('WorkflowBlockHandler', () => {
  let handler: WorkflowBlockHandler
  let mockBlock: SerializedBlock
  let mockContext: ExecutionContext

  beforeEach(() => {
    vi.clearAllMocks()
    handler = new WorkflowBlockHandler()

    mockBlock = {
      id: 'workflow-block-1',
      metadata: { id: BlockType.WORKFLOW_INPUT, name: 'Workflow Block' },
      position: { x: 0, y: 0 },
      config: { tool: BlockType.WORKFLOW_INPUT, params: {} },
      inputs: { workflowId: 'string' },
      outputs: {},
      enabled: true,
    }

    mockContext = {
      workflowId: 'parent-workflow-id',
      workspaceId: 'test-workspace-id',
      userId: 'user-1',
      executionId: 'execution-1',
      workflowDepth: 0,
      triggerType: 'manual',
      blockStates: new Map(),
      blockLogs: [],
      metadata: { duration: 0 },
      environmentVariables: {},
      decisions: { router: new Map(), condition: new Map() },
      loopIterations: new Map(),
      loopItems: new Map(),
      completedLoops: new Set(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      workflow: {
        version: '1.0',
        blocks: [],
        connections: [],
        loops: {},
      },
    }
  })

  it('throws when workflowId is missing', async () => {
    await expect(handler.execute(mockBlock, {}, mockContext)).rejects.toThrow(
      'No workflow selected for execution'
    )
  })

  it('enforces workflow depth before queueing', async () => {
    await expect(
      handler.execute(
        mockBlock,
        { workflowId: 'child-workflow-id' },
        { ...mockContext, workflowDepth: 10 }
      )
    ).rejects.toThrow('Maximum workflow nesting depth of 10 exceeded')
  })

  it('handles the original workflow block type through the queue path', () => {
    expect(
      handler.canHandle({
        ...mockBlock,
        metadata: { id: BlockType.WORKFLOW, name: 'Workflow Block' },
      })
    ).toBe(true)
  })

  it('queues the child workflow and maps the completed result', async () => {
    vi.mocked(generateInternalToken)
      .mockResolvedValueOnce('queue-token')
      .mockResolvedValueOnce('poll-token')
    const fetchMock = vi.mocked(global.fetch)
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            taskId: 'job-1',
            workflowName: 'Child Workflow',
          }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'completed',
            output: {
              success: true,
              output: { value: 42 },
              traceSpans: [],
            },
          }),
      } as Response)

    const deferred = await handler.execute(
      mockBlock,
      { workflowId: 'child-workflow-id', input: { symbol: 'AAPL' } },
      mockContext
    )

    expect(typeof deferred).toBe('object')
    expect((deferred as { kind?: string }).kind).toBe('deferred')

    const result = await (deferred as { wait: () => Promise<Record<string, unknown>> }).wait()

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:3000/api/workflows/child-workflow-id/queue',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer queue-token',
          'Content-Type': 'application/json',
        }),
      })
    )
    const queueBody = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)
    expect(queueBody).toMatchObject({
      input: { symbol: 'AAPL' },
      executionTarget: 'live',
      triggerType: 'api',
      workflowDepth: 1,
    })
    expect(queueBody).not.toHaveProperty('parentWorkflowId')
    expect(queueBody).not.toHaveProperty('parentExecutionId')
    expect(queueBody).not.toHaveProperty('parentBlockId')
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3000/api/jobs/job-1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer poll-token',
          'Content-Type': 'application/json',
        }),
        cache: 'no-store',
      })
    )
    expect(result).toEqual({
      success: true,
      childWorkflowName: 'Child Workflow',
      result: { value: 42 },
      childTraceSpans: [],
    })
    expect(generateInternalToken).toHaveBeenCalledWith('user-1', {
      workflowExecution: {
        source: 'workflow_block',
        parentWorkflowId: 'parent-workflow-id',
        parentExecutionId: 'execution-1',
        parentBlockId: 'workflow-block-1',
      },
    })
    expect(generateInternalToken).toHaveBeenCalledTimes(2)
  })

  it('wraps failed child workflow executions', async () => {
    const fetchMock = vi.mocked(global.fetch)
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            taskId: 'job-2',
            workflowName: 'Child Workflow',
          }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'completed',
            output: {
              success: false,
              error: 'Child failed',
              traceSpans: [],
            },
          }),
      } as Response)

    const deferred = await handler.execute(
      mockBlock,
      { workflowId: 'child-workflow-id' },
      mockContext
    )

    await expect(
      (deferred as { wait: () => Promise<Record<string, unknown>> }).wait()
    ).rejects.toThrow('Error in child workflow "Child Workflow": Child failed')
  })

  it('cancels queued child workflows when the parent is cancelled', async () => {
    vi.mocked(generateInternalToken)
      .mockResolvedValueOnce('queue-token')
      .mockResolvedValueOnce('cancel-token')
    const fetchMock = vi.mocked(global.fetch)
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            taskId: 'job-3',
            workflowName: 'Child Workflow',
          }),
      } as Response)
      .mockResolvedValueOnce({ ok: true } as Response)

    const deferred = await handler.execute(
      mockBlock,
      { workflowId: 'child-workflow-id' },
      {
        ...mockContext,
        shouldCancelExecution: vi.fn().mockResolvedValue(true),
      }
    )

    await expect(
      (deferred as { wait: () => Promise<Record<string, unknown>> }).wait()
    ).rejects.toThrow('Child workflow execution was cancelled')

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3000/api/jobs/job-3',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          Authorization: 'Bearer cancel-token',
          'Content-Type': 'application/json',
        }),
      })
    )
    expect(generateInternalToken).toHaveBeenCalledTimes(2)
  })

  it('cancels queued child workflows when child polling reaches its deadline', async () => {
    vi.useFakeTimers()
    const nowSpy = vi.spyOn(Date, 'now')
    let now = 0
    nowSpy.mockImplementation(() => now)
    const fetchMock = vi.mocked(global.fetch)
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            taskId: 'job-4',
            workflowName: 'Child Workflow',
          }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'processing' }),
      } as Response)
      .mockResolvedValueOnce({ ok: true } as Response)

    try {
      const deferred = await handler.execute(
        mockBlock,
        { workflowId: 'child-workflow-id' },
        mockContext
      )

      const waitPromise = (deferred as { wait: () => Promise<Record<string, unknown>> }).wait()
      const errorPromise = waitPromise.catch((error) => error as Error)
      await vi.advanceTimersByTimeAsync(0)
      now = 30 * 60 * 1000 + 1
      await vi.advanceTimersByTimeAsync(1_000)

      await expect(errorPromise).resolves.toMatchObject({
        message: expect.stringContaining('Child workflow execution timed out'),
      })
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        'http://localhost:3000/api/jobs/job-4',
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    } finally {
      nowSpy.mockRestore()
      vi.useRealTimers()
    }
  })
})
