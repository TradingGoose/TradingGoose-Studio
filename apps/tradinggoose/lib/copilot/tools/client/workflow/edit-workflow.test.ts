import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { EditWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/edit-workflow'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'

const mockGetReadableWorkflowSnapshot = vi.fn()
const mockSetWorkflowState = vi.fn()
const mockGetRegisteredWorkflowSession = vi.fn()

const workflowDocument = [
  'flowchart TD',
  '%% TG_WORKFLOW {"version":"tg-mermaid-v1","direction":"TD"}',
  '%% TG_BLOCK {"id":"block-1","type":"trigger","name":"Trigger","position":{"x":0,"y":0},"subBlocks":{},"outputs":{},"enabled":true}',
].join('\n')

let accessLevel: 'limited' | 'full' = 'limited'
let persistedToolCalls: Record<string, any> = {}

vi.mock('@/lib/copilot/tools/client/workflow/workflow-review-tool-utils', () => ({
  resolveWorkflowIdFromExecutionContext: (executionContext: any, workflowId?: string) =>
    workflowId ?? executionContext.workflowId,
  getReadableWorkflowSnapshot: (...args: any[]) => mockGetReadableWorkflowSnapshot(...args),
}))

vi.mock('@/lib/yjs/workflow-session-registry', () => ({
  getRegisteredWorkflowSession: (...args: any[]) => mockGetRegisteredWorkflowSession(...args),
}))

vi.mock('@/lib/yjs/workflow-session', () => ({
  setWorkflowState: (...args: any[]) => mockSetWorkflowState(...args),
}))

vi.mock('@/stores/copilot/store', () => ({
  getCopilotStoreForToolCall: () => ({
    getState: () => ({
      accessLevel,
      toolCallsById: persistedToolCalls,
    }),
  }),
}))

describe('EditWorkflowClientTool approval gating', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    accessLevel = 'limited'
    persistedToolCalls = {}
    mockGetReadableWorkflowSnapshot.mockReset()
    mockSetWorkflowState.mockReset()
    mockGetRegisteredWorkflowSession.mockReset()

    mockGetReadableWorkflowSnapshot.mockResolvedValue({
      workflowId: 'wf-1',
      source: 'live',
      workflowState: {
        blocks: {
          'block-1': {
            id: 'block-1',
            type: 'trigger',
            name: 'Trigger',
            position: { x: 0, y: 0 },
            subBlocks: {},
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

  it('stages workflow edits for review through the unified user-action handler', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url === '/api/copilot/execute-copilot-server-tool') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            result: {
              workflowState: {
                blocks: {
                  'block-1': {
                    id: 'block-1',
                    type: 'trigger',
                    name: 'Renamed Trigger',
                    position: { x: 0, y: 0 },
                    subBlocks: {},
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

    const tool = new EditWorkflowClientTool('tool-review')
    tool.setExecutionContext({
      toolCallId: 'tool-review',
      toolName: 'edit_workflow',
      channelId: 'pair-1',
      workflowId: 'wf-1',
      log: vi.fn(),
    })

    await tool.handleUserAction({
      workflowId: 'wf-1',
      workflowDocument,
    })

    expect(tool.getState()).toBe(ClientToolCallState.review)
    expect(mockSetWorkflowState).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await tool.handleReject()

    expect(tool.getState()).toBe(ClientToolCallState.rejected)
    expect(mockSetWorkflowState).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('stages workflow edits from a persisted workflow fallback when no live session is registered yet', async () => {
    mockGetReadableWorkflowSnapshot.mockResolvedValueOnce({
      workflowId: 'wf-1',
      source: 'api',
      workflowState: {
        blocks: {
          'block-1': {
            id: 'block-1',
            type: 'trigger',
            name: 'Persisted Trigger',
            position: { x: 0, y: 0 },
            subBlocks: {},
            outputs: {},
            enabled: true,
          },
        },
        edges: [],
        loops: {},
        parallels: {},
      },
    })

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url === '/api/copilot/execute-copilot-server-tool') {
        expect(init?.body).toContain('"currentWorkflowState"')
        expect(init?.body).toContain('Persisted Trigger')
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            result: {
              workflowState: {
                blocks: {
                  'block-1': {
                    id: 'block-1',
                    type: 'trigger',
                    name: 'Renamed Trigger',
                    position: { x: 0, y: 0 },
                    subBlocks: {},
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

      throw new Error(`Unexpected fetch URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const tool = new EditWorkflowClientTool('tool-db-fallback')
    tool.setExecutionContext({
      toolCallId: 'tool-db-fallback',
      toolName: 'edit_workflow',
      channelId: 'pair-1',
      workflowId: 'wf-1',
      log: vi.fn(),
    })

    await tool.handleUserAction({
      workflowId: 'wf-1',
      workflowDocument,
    })

    expect(tool.getState()).toBe(ClientToolCallState.review)
    expect(mockGetRegisteredWorkflowSession).not.toHaveBeenCalled()
    expect(mockSetWorkflowState).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('applies staged workflow edits through Yjs on accept', async () => {
    const nextWorkflowState = {
      blocks: {
        'block-1': {
          id: 'block-1',
          type: 'trigger',
          name: 'Accepted Trigger',
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

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url === '/api/copilot/execute-copilot-server-tool') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            result: {
              workflowState: nextWorkflowState,
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

    const tool = new EditWorkflowClientTool('tool-accept')
    tool.setExecutionContext({
      toolCallId: 'tool-accept',
      toolName: 'edit_workflow',
      channelId: 'pair-1',
      workflowId: 'wf-1',
      log: vi.fn(),
    })

    await tool.execute({
      workflowId: 'wf-1',
      workflowDocument,
    })
    await tool.handleAccept()

    expect(tool.getState()).toBe(ClientToolCallState.success)
    expect(mockSetWorkflowState).toHaveBeenCalledWith(
      { id: 'doc-1' },
      nextWorkflowState,
      YJS_ORIGINS.COPILOT_REVIEW_ACCEPT
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('auto-applies full-access workflow edits through the same Yjs approval path', async () => {
    accessLevel = 'full'

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url === '/api/copilot/execute-copilot-server-tool') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            result: {
              workflowState: {
                blocks: {},
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

    const tool = new EditWorkflowClientTool('tool-auto-apply')
    tool.setExecutionContext({
      toolCallId: 'tool-auto-apply',
      toolName: 'edit_workflow',
      channelId: 'pair-1',
      workflowId: 'wf-1',
      log: vi.fn(),
    })

    await tool.execute({
      workflowId: 'wf-1',
      workflowDocument,
    })

    expect(tool.getState()).toBe(ClientToolCallState.success)
    expect(mockSetWorkflowState).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('auto-applies full-access workflow edits without a live Yjs session', async () => {
    accessLevel = 'full'
    mockGetRegisteredWorkflowSession.mockReturnValueOnce(null)

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url === '/api/copilot/execute-copilot-server-tool') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            result: {
              workflowState: {
                blocks: {
                  'block-1': {
                    id: 'block-1',
                    type: 'trigger',
                    name: 'Saved Trigger',
                    position: { x: 0, y: 0 },
                    subBlocks: {},
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

      if (url === '/api/workflows/wf-1/apply-live-state') {
        expect(init?.body).toContain('"blocks"')
        expect(init?.body).toContain('Saved Trigger')
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        }
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const tool = new EditWorkflowClientTool('tool-auto-apply-without-session')
    tool.setExecutionContext({
      toolCallId: 'tool-auto-apply-without-session',
      toolName: 'edit_workflow',
      channelId: 'pair-1',
      workflowId: 'wf-1',
      log: vi.fn(),
    })

    await tool.execute({
      workflowId: 'wf-1',
      workflowDocument,
    })

    expect(tool.getState()).toBe(ClientToolCallState.success)
    expect(mockSetWorkflowState).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('accepts persisted staged workflow edits after reload through the unified user-action handler', async () => {
    const stagedWorkflowState = {
      blocks: {
        'block-1': {
          id: 'block-1',
          type: 'trigger',
          name: 'Persisted Trigger',
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

    persistedToolCalls = {
      'tool-persisted-review': {
        id: 'tool-persisted-review',
        name: 'edit_workflow',
        state: ClientToolCallState.review,
        result: {
          workflowState: stagedWorkflowState,
        },
      },
    }

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()

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

    const tool = new EditWorkflowClientTool('tool-persisted-review')
    tool.setExecutionContext({
      toolCallId: 'tool-persisted-review',
      toolName: 'edit_workflow',
      channelId: 'pair-1',
      workflowId: 'wf-1',
      log: vi.fn(),
    })
    tool.hydratePersistedToolCall(persistedToolCalls['tool-persisted-review'])

    await tool.handleUserAction()

    expect(tool.getState()).toBe(ClientToolCallState.success)
    expect(mockSetWorkflowState).toHaveBeenCalledWith(
      { id: 'doc-1' },
      stagedWorkflowState,
      YJS_ORIGINS.COPILOT_REVIEW_ACCEPT
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
