import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetRegisteredWorkflowSession = vi.fn()
const mockGetVariablesForWorkflow = vi.fn()

vi.mock('@/lib/yjs/workflow-session-registry', () => ({
  getRegisteredWorkflowSession: (...args: unknown[]) => mockGetRegisteredWorkflowSession(...args),
  getVariablesForWorkflow: (...args: unknown[]) => mockGetVariablesForWorkflow(...args),
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
  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = vi.fn()
    mockGetVariablesForWorkflow.mockReturnValue({})
  })

  it('uses the live Yjs session snapshot when one is registered', async () => {
    const doc = {
      getMap: vi.fn((key: string) => {
        const values: Record<string, unknown> = {
          workflow: new Map([
            ['blocks', { 'block-1': { type: 'agent', name: 'Agent', subBlocks: {}, outputs: {} } }],
            ['edges', []],
            ['loops', {}],
            ['parallels', {}],
          ]),
          textFields: new Map(),
        }
        return values[key]
      }),
    }

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

  it('reads the authoritative workflow API when no live Yjs session is registered', async () => {
    mockGetRegisteredWorkflowSession.mockReturnValue(null)
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          name: 'Database Workflow',
          workspaceId: 'workspace-db',
          state: {
            blocks: { 'block-1': { type: 'agent', name: 'Agent', subBlocks: {}, outputs: {} } },
            edges: [],
            loops: {},
            parallels: {},
            variables: {
              'var-1': {
                id: 'var-1',
                workflowId: 'workflow-db',
                name: 'risk',
                type: 'number',
                value: 2,
              },
            },
            lastSaved: '2026-04-05T23:42:00.000Z',
          },
        },
      }),
    } as Response)

    const { getReadableWorkflowState } = await import('./workflow-review-tool-utils')
    const result = await getReadableWorkflowState(
      {
        toolCallId: 'tool-1',
        toolName: 'read_workflow',
        workflowId: 'workflow-current',
      },
      'workflow-db'
    )

    expect(result.source).toBe('api')
    expect(result.workflowId).toBe('workflow-db')
    expect(result.workflowName).toBe('Database Workflow')
    expect(result.workspaceId).toBe('workspace-db')
    expect(global.fetch).toHaveBeenCalledWith('/api/workflows/workflow-db', {
      method: 'GET',
    })
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
          input: {
            id: 'input',
            type: 'input_trigger',
            name: 'Input Form',
            position: { x: 0, y: 0 },
            enabled: true,
            subBlocks: {},
            outputs: {},
          },
          parallel: {
            id: 'parallel',
            type: 'parallel',
            name: 'Parallel',
            position: { x: 200, y: 0 },
            enabled: true,
            subBlocks: {},
            outputs: {},
          },
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

    expect(
      buildWorkflowSummary({
        blocks: {
          input: {
            id: 'input',
            type: 'input_trigger',
            name: 'Input',
            position: { x: 0, y: 0 },
            enabled: true,
            subBlocks: {},
            outputs: {},
          },
          parallel: {
            id: 'parallel',
            type: 'parallel',
            name: 'Parallel',
            position: { x: 200, y: 0 },
            enabled: true,
            subBlocks: {},
            outputs: {},
          },
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
      }).connectionIssues
    ).toEqual([
      {
        edgeIndex: 0,
        source: 'input',
        target: 'parallel',
        message:
          'Invalid container edge: parallel container input requires targetHandle "target" for incoming outer edges.',
      },
    ])
  })
})
