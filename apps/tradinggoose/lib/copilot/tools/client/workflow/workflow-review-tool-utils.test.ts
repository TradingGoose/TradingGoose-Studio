import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetRegisteredWorkflowSession = vi.fn()
const mockAcquireWritableWorkflowSessionLease = vi.fn()

vi.mock('@/lib/yjs/workflow-session-registry', () => ({
  getRegisteredWorkflowSession: (...args: unknown[]) => mockGetRegisteredWorkflowSession(...args),
}))

vi.mock('@/lib/yjs/workflow-shared-session', () => ({
  acquireWritableWorkflowSessionLease: (...args: unknown[]) =>
    mockAcquireWritableWorkflowSessionLease(...args),
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: {
    getState: () => ({
      workflows: {},
      getActiveWorkflowId: () => undefined,
    }),
  },
}))

describe('workflow-review-tool-utils', () => {
  const block = (id: string, type = 'function', name = id, x = 0) => ({
    id,
    type,
    name,
    position: { x, y: 0 },
    enabled: true,
    subBlocks: {},
    outputs: {},
  })
  const workflowDoc = (blocks: Record<string, any>, variables: Record<string, any> = {}) => ({
    getMap: vi.fn((key: string) => {
      const values: Record<string, unknown> = {
        workflow: new Map([
          ['blocks', blocks],
          ['edges', []],
          ['loops', {}],
          ['parallels', {}],
        ]),
        textFields: new Map(),
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
      doc,
    })

    const { getReadableWorkflowState } = await import('./workflow-review-tool-utils')
    const result = await getReadableWorkflowState(
      {
        toolCallId: 'tool-1',
        toolName: 'read_workflow',
        workflowId: 'workflow-current',
      },
      'workflow-live'
    )

    expect(result.source).toBe('live')
    expect(result.workflowId).toBe('workflow-live')
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
      session: { workflowId: 'workflow-db', doc },
      release,
    })

    const { getReadableWorkflowState } = await import('./workflow-review-tool-utils')
    const result = await getReadableWorkflowState(
      {
        toolCallId: 'tool-1',
        toolName: 'read_workflow',
        workflowId: 'workflow-current',
      },
      'workflow-db'
    )

    expect(result.source).toBe('yjs')
    expect(result.workflowId).toBe('workflow-db')
    expect(result.workspaceId).toBeNull()
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
    const { getReadableWorkflowState } = await import('./workflow-review-tool-utils')
    await expect(
      getReadableWorkflowState({
        toolCallId: 'tool-1',
        toolName: 'read_workflow',
        workflowId: 'workflow-current',
      })
    ).rejects.toThrow('Workflow target is required')
  })

  it('builds workflow document payloads with entity aliases', async () => {
    const { buildWorkflowDocumentToolResult } = await import('./workflow-review-tool-utils')

    expect(
      buildWorkflowDocumentToolResult({
        workflowId: 'workflow-entity',
        workflowName: 'Momentum Flow',
        workflowDocument: 'flowchart TD',
      })
    ).toEqual({
      entityKind: 'workflow',
      entityId: 'workflow-entity',
      entityName: 'Momentum Flow',
      entityDocument: 'flowchart TD',
      workflowId: 'workflow-entity',
      workflowName: 'Momentum Flow',
      workflowDocument: 'flowchart TD',
      documentFormat: 'tg-mermaid-v1',
    })
  })

  it('surfaces invalid external edges into container end handles', async () => {
    const { buildWorkflowSummary } = await import('./workflow-review-tool-utils')

    expect(
      buildWorkflowSummary({
        blocks: {
          input: block('input', 'input_trigger', 'Input Form'),
          parallel: block('parallel', 'parallel', 'Parallel', 200),
        },
        edges: [
          {
            id: 'edge-input-parallel-end',
            source: 'input',
            target: 'parallel',
            targetHandle: 'parallel-end-target',
          },
        ],
        loops: {},
        parallels: {},
      }).connectionIssues
    ).toEqual([
      {
        edgeIndex: 0,
        source: 'input',
        target: 'parallel',
        targetHandle: 'parallel-end-target',
        message:
          'Invalid container edge: parallel container input requires targetHandle "target" for incoming outer edges.',
      },
    ])
  })

  it('surfaces missing outer input handles on incoming container edges', async () => {
    const { buildWorkflowSummary } = await import('./workflow-review-tool-utils')

    const summary = buildWorkflowSummary({
      blocks: {
        input: block('input', 'input_trigger', 'Input'),
        orphan: block('orphan', 'function', 'Orphan', 400),
        parallel: block('parallel', 'parallel', 'Parallel', 200),
      },
      edges: [
        {
          id: 'edge-input-parallel',
          source: 'input',
          target: 'parallel',
        },
      ],
      loops: {},
      parallels: {},
    })

    expect(summary.connectionIssues).toEqual([
      {
        edgeIndex: 0,
        source: 'input',
        target: 'parallel',
        message:
          'Invalid container edge: parallel container input requires targetHandle "target" for incoming outer edges.',
      },
    ])
  })

  it('marks container branch edges as internal so missing outer edges stay visible', async () => {
    const { buildWorkflowSummary } = await import('./workflow-review-tool-utils')

    const child = {
      ...block('child', 'function', 'Child'),
      data: { parentId: 'parallel', extent: 'parent' },
    }
    const summary = buildWorkflowSummary({
      blocks: {
        agent: block('agent', 'agent', 'Agent'),
        input: block('input', 'input_trigger', 'Input Form'),
        parallel: block('parallel', 'parallel', 'Parallel'),
        child,
      },
      edges: [
        {
          id: 'parallel-start-child',
          source: 'parallel',
          sourceHandle: 'parallel-start-source',
          target: 'child',
        },
        {
          id: 'child-parallel-end',
          source: 'child',
          target: 'parallel',
          targetHandle: 'parallel-end-target',
        },
        {
          id: 'parallel-end-agent',
          source: 'parallel',
          sourceHandle: 'parallel-end-source',
          target: 'agent',
        },
      ],
      loops: {},
      parallels: {},
    })

    expect(summary.connectionIssues).toEqual([])
    expect(summary.blocks).toContainEqual(
      expect.objectContaining({
        blockId: 'input',
        connections: { externalIn: 0, externalOut: 0, internalIn: 0, internalOut: 0 },
      })
    )
    expect(summary.blocks).toContainEqual(
      expect.objectContaining({
        blockId: 'parallel',
        connections: { externalIn: 0, externalOut: 1, internalIn: 1, internalOut: 1 },
      })
    )
    expect(summary.edges.some((edge) => edge.source === 'input' || edge.target === 'input')).toBe(
      false
    )
    expect(summary.edges).toEqual([
      expect.objectContaining({ source: 'parallel', target: 'child', scope: 'internal' }),
      expect.objectContaining({ source: 'child', target: 'parallel', scope: 'internal' }),
      expect.objectContaining({ source: 'parallel', target: 'agent', scope: 'external' }),
    ])
  })
})
