import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nativeToolCallId } from '@/lib/copilot/native/identity'
import { executeWorkflowWithFullLogging } from './workflow-execution-utils'
import { getReadableWorkflowState, resolveWorkflowTarget } from './workflow-review-tool-utils'

const mockGetRegisteredWorkflowSession = vi.hoisted(() => vi.fn())
const mockAcquireWritableWorkflowSessionLease = vi.hoisted(() => vi.fn())
const mockRunQueuedWorkflowExecution = vi.hoisted(() => vi.fn())

vi.unmock('@/blocks/registry')
vi.mock('@/lib/workflows/queued-execution-client', () => ({
  runQueuedWorkflowExecution: mockRunQueuedWorkflowExecution,
}))

vi.mock('@/lib/yjs/workflow-session-registry', () => ({
  getRegisteredWorkflowSession: (...args: unknown[]) => mockGetRegisteredWorkflowSession(...args),
}))

vi.mock('@/lib/yjs/workflow-shared-session', () => ({
  acquireWritableWorkflowSessionLease: (...args: unknown[]) =>
    mockAcquireWritableWorkflowSessionLease(...args),
}))

describe('workflow-review-tool-utils', () => {
  const workflowDoc = (
    blocks: Record<string, any>,
    variables: Record<string, any> = {},
    edges: Array<{ source: string; target: string }> = []
  ) => ({
    getMap: vi.fn((key: string) => {
      const values: Record<string, unknown> = {
        workflow: new Map([
          ['blocks', blocks],
          ['edges', edges],
          ['loops', {}],
          ['parallels', {}],
        ]),
        subBlockFields: new Map(),
        variables: new Map(Object.entries(variables)),
      }
      return values[key]
    }),
  })

  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = vi.fn()
  })

  it('queues distinct native runs independently while preserving repeated target identity', async () => {
    mockGetRegisteredWorkflowSession.mockReturnValue({
      workspaceId: 'workspace-live',
      doc: workflowDoc(
        {
          trigger: { type: 'manual_trigger', subBlocks: {}, outputs: {} },
          output: { type: 'response', subBlocks: {}, outputs: {} },
        },
        {},
        [{ source: 'trigger', target: 'output' }]
      ),
    })
    const targets = ['run-a', 'run-b', 'run-a'].map((runId) => ({
      threadId: 'thread',
      resourceId: 'resource',
      runId,
      toolCallId: 'functions.run_workflow:0',
      toolName: 'run_workflow',
    }))
    for (const target of targets)
      await executeWorkflowWithFullLogging({
        native: { workspaceId: 'workspace-live', target },
        workflowId: 'workflow-live',
        triggerBlockId: 'trigger',
      })
    const requests = mockRunQueuedWorkflowExecution.mock.calls.map(([request]) => request)
    expect(requests.map((request) => request.executionId)).toEqual(targets.map(nativeToolCallId))
    expect(requests[0].executionId).not.toBe(requests[1].executionId)
    expect(requests[0].executionId).toBe(requests[2].executionId)
    expect(requests.map((request) => request.native.target)).toEqual(targets)
  })

  it('uses the live Yjs session snapshot when one is registered', async () => {
    const doc = workflowDoc({
      'block-1': { type: 'agent', name: 'Agent', subBlocks: {}, outputs: {} },
    })

    mockGetRegisteredWorkflowSession.mockReturnValue({
      workflowId: 'workflow-live',
      workspaceId: 'workspace-live',
      doc,
    })

    const result = await getReadableWorkflowState('workflow-live')
    expect(result.workspaceId).toBe('workspace-live')
    expect(result.workflowState.blocks['block-1']).toMatchObject({
      type: 'agent',
      name: 'Agent',
    })
    expect(result.variables).toEqual({})
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('bootstraps the workflow Yjs session when no live session is registered', async () => {
    mockGetRegisteredWorkflowSession.mockReturnValue(null)
    const doc = workflowDoc(
      { 'block-1': { type: 'agent', name: 'Agent', subBlocks: {}, outputs: {} } },
      {
        'var-1': { id: 'var-1', workflowId: 'workflow-db', name: 'risk', type: 'number', value: 2 },
      }
    )
    const release = vi.fn()
    mockAcquireWritableWorkflowSessionLease.mockResolvedValue({
      session: {
        workflowId: 'workflow-db',
        workspaceId: 'workspace-db',
        doc,
      },
      release,
    })

    const result = await getReadableWorkflowState('workflow-db')
    expect(result.workspaceId).toBe('workspace-db')
    expect(mockAcquireWritableWorkflowSessionLease).toHaveBeenCalledWith({
      workflowId: 'workflow-db',
      workspaceId: null,
    })
    expect(global.fetch).not.toHaveBeenCalled()
    expect(result.workflowState.blocks['block-1']).toMatchObject({
      type: 'agent',
      name: 'Agent',
    })
    expect(result.variables).toEqual({
      'var-1': {
        id: 'var-1',
        workflowId: 'workflow-db',
        name: 'risk',
        type: 'number',
        value: 2,
      },
    })
    expect(release).toHaveBeenCalled()
  })

  it('fails fast when workflow execution context is missing a workflow target', async () => {
    await expect(getReadableWorkflowState()).rejects.toThrow('entityId is required')
  })

  it('loads ordinary workflow metadata for a reopened deployment without a pinned workspace', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ data: { id: 'workflow', workspaceId: 'business-workspace' } })
    )
    expect(await resolveWorkflowTarget({}, { entityId: 'workflow' })).toEqual({
      workflowId: 'workflow',
      workspaceId: 'business-workspace',
    })
    expect(fetch).toHaveBeenCalledWith('/api/workflows/workflow', { signal: undefined })
  })
  it('rejects unavailable workflow metadata and canceled lookups', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ data: { id: 'foreign', workspaceId: 'business-workspace' } })
    )
    await expect(resolveWorkflowTarget({}, { entityId: 'workflow' })).rejects.toThrow(
      'workspace is unavailable'
    )
    const abort = new AbortController()
    abort.abort(new Error('Cancelled'))
    await expect(
      resolveWorkflowTarget({}, { entityId: 'workflow', signal: abort.signal })
    ).rejects.toThrow('Cancelled')
  })
})
