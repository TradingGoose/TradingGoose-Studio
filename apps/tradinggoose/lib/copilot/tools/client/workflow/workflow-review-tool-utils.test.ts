import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getReadableWorkflowState, resolveWorkflowTarget } from './workflow-review-tool-utils'

const mockGetRegisteredWorkflowSession = vi.hoisted(() => vi.fn())
const mockAcquireWritableWorkflowSessionLease = vi.hoisted(() => vi.fn())

vi.mock('@/lib/yjs/workflow-session-registry', () => ({
  getRegisteredWorkflowSession: (...args: unknown[]) => mockGetRegisteredWorkflowSession(...args),
}))

vi.mock('@/lib/yjs/workflow-shared-session', () => ({
  acquireWritableWorkflowSessionLease: (...args: unknown[]) =>
    mockAcquireWritableWorkflowSessionLease(...args),
}))

describe('workflow-review-tool-utils', () => {
  const workflowDoc = (blocks: Record<string, any>, variables: Record<string, any> = {}) => ({
    getMap: vi.fn((key: string) => {
      const values: Record<string, unknown> = {
        workflow: new Map([
          ['blocks', blocks],
          ['edges', []],
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
