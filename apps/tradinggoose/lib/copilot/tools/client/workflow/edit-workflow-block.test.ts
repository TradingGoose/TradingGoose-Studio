import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { EditWorkflowBlockClientTool } from '@/lib/copilot/tools/client/workflow/edit-workflow-block'

const mockGetReadableWorkflowState = vi.fn()
const mockResolveWorkflowTarget = vi.fn()
const mockSetWorkflowState = vi.fn()
const mockGetRegisteredWorkflowSession = vi.fn()

let accessLevel: 'limited' | 'full' = 'limited'

vi.mock('@/lib/copilot/tools/client/workflow/workflow-review-tool-utils', () => ({
  getReadableWorkflowState: (...args: any[]) => mockGetReadableWorkflowState(...args),
  resolveWorkflowTarget: (...args: any[]) => mockResolveWorkflowTarget(...args),
  buildWorkflowDocumentToolResult: ({
    workflowId,
    workflowName,
    workflowDocument,
  }: {
    workflowId: string
    workflowName?: string
    workflowDocument: string
  }) => ({
    entityKind: 'workflow',
    entityId: workflowId,
    ...(workflowName ? { entityName: workflowName } : {}),
    entityDocument: workflowDocument,
    workflowId,
    ...(workflowName ? { workflowName } : {}),
    workflowDocument,
    documentFormat: 'tg-mermaid-v1',
  }),
}))

vi.mock('@/lib/yjs/workflow-session-registry', () => ({
  getRegisteredWorkflowSession: (...args: any[]) => mockGetRegisteredWorkflowSession(...args),
}))

vi.mock('@/lib/yjs/workflow-session', () => ({
  setWorkflowState: (...args: any[]) => mockSetWorkflowState(...args),
}))

vi.mock('@/stores/copilot/store-access', () => ({
  getCopilotStoreForToolCall: () => ({
    getState: () => ({
      accessLevel,
      toolCallsById: {},
    }),
  }),
}))

describe('EditWorkflowBlockClientTool', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals?.()
    accessLevel = 'limited'
    mockGetReadableWorkflowState.mockReset()
    mockResolveWorkflowTarget.mockReset()
    mockSetWorkflowState.mockReset()
    mockGetRegisteredWorkflowSession.mockReset()

    mockResolveWorkflowTarget.mockResolvedValue({
      workflowId: 'wf-1',
      workflowName: 'Workflow 1',
      workspaceId: 'workspace-1',
    })

    mockGetReadableWorkflowState.mockResolvedValue({
      workflowId: 'wf-1',
      source: 'live',
      workflowState: {
        direction: 'TD',
        blocks: {
          fn1: {
            id: 'fn1',
            type: 'function',
            name: 'Compute Indicators',
            position: { x: 0, y: 0 },
            subBlocks: {
              code: { id: 'code', type: 'code', value: 'return { ok: true }' },
            },
            outputs: {},
            enabled: true,
          },
        },
        edges: [],
        loops: {},
        parallels: {},
      },
    })

    mockGetRegisteredWorkflowSession.mockReturnValue({
      workflowId: 'wf-1',
      channelId: 'pair-1',
      yjsSessionId: 'wf-1',
      doc: { id: 'doc-1' },
      provider: null,
      undoManager: null,
    })
  })

  it('stages block edits for review through the shared workflow review flow', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url === '/api/copilot/execute-copilot-server-tool') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            result: {
              workflowDocument: 'flowchart TD\n%% TG_WORKFLOW {"version":"tg-mermaid-v1","direction":"TD"}',
              workflowState: {
                direction: 'TD',
                blocks: {
                  fn1: {
                    id: 'fn1',
                    type: 'function',
                    name: 'Compute Market Indicators',
                    position: { x: 0, y: 0 },
                    subBlocks: {
                      code: { id: 'code', type: 'code', value: 'return { rsi: 50 }' },
                    },
                    outputs: {},
                    enabled: true,
                  },
                },
                edges: [],
                loops: {},
                parallels: {},
              },
            },
          }),
        }
      }

      if (url === '/api/copilot/tools/mark-complete') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        }
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const tool = new EditWorkflowBlockClientTool('tool-review')
    tool.setExecutionContext({
      toolCallId: 'tool-review',
      toolName: 'edit_workflow_block',
      workflowId: 'wf-1',
      log: vi.fn(),
    })

    await tool.handleUserAction({
      workflowId: 'wf-1',
      blockId: 'fn1',
      blockType: 'function',
      subBlocks: {
        code: 'return { rsi: 50 }',
      },
    })

    expect(tool.getState()).toBe(ClientToolCallState.review)
    expect(mockSetWorkflowState).not.toHaveBeenCalled()
  })
})
