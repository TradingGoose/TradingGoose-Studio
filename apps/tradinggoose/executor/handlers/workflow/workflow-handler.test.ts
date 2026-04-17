import { beforeEach, describe, expect, it, vi } from 'vitest'
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

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: {
    getState: vi.fn(() => ({
      workflows: {
        'child-workflow-id': {
          name: 'Child Workflow',
        },
      },
    })),
  },
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
      metadata: { id: BlockType.WORKFLOW, name: 'Workflow Block' },
      position: { x: 0, y: 0 },
      config: { tool: BlockType.WORKFLOW, params: {} },
      inputs: { workflowId: 'string' },
      outputs: {},
      enabled: true,
    }

    mockContext = {
      workflowId: 'parent-workflow-id',
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

  it('queues the child workflow and maps the completed result', async () => {
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
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3000/api/jobs/job-1',
      expect.objectContaining({
        cache: 'no-store',
      })
    )
    expect(result).toEqual({
      success: true,
      childWorkflowName: 'Child Workflow',
      result: { value: 42 },
      childTraceSpans: [],
    })
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
})
