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
        toolName: 'get_user_workflow',
        channelId: 'channel-1',
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

  it('falls back to the authoritative workflow API when no live Yjs session is registered', async () => {
    mockGetRegisteredWorkflowSession.mockReturnValue(null)
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
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
        toolName: 'get_user_workflow',
        channelId: 'channel-1',
        workflowId: 'workflow-current',
      },
      'workflow-db'
    )

    expect(result.source).toBe('api')
    expect(result.workflowId).toBe('workflow-db')
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
        toolName: 'get_user_workflow',
        channelId: 'channel-1',
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

  it('rejects duplicate workflow names instead of picking one silently', async () => {
    mockGetRegisteredWorkflowSession.mockReturnValue(null)
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'workflow-a', name: 'Analysts' },
          { id: 'workflow-b', name: 'analysts' },
        ],
      }),
    } as Response)

    const { resolveWorkflowTarget } = await import('./workflow-review-tool-utils')
    await expect(
      resolveWorkflowTarget(
        {
          toolCallId: 'tool-1',
          toolName: 'get_workflow_from_name',
          channelId: 'channel-1',
        },
        { workflow_name: 'Analysts' }
      )
    ).rejects.toThrow('Multiple workflows named "Analysts" found')
  })
})
