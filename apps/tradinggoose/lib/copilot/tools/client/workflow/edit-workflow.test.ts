import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClientToolCallState,
  REJECTED_TOOL_COMPLETION_STATUS,
} from '@/lib/copilot/tools/client/base-tool'
import { EditWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/edit-workflow'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'

const mockGetReadableWorkflowState = vi.fn()
const mockResolveWorkflowTarget = vi.fn()
const mockSetWorkflowState = vi.fn()
const mockGetRegisteredWorkflowSession = vi.fn()
const mockAcquireSharedWorkflowSessionLease = vi.fn()

const workflowDocument = [
  'flowchart TD',
  '%% TG_WORKFLOW {"version":"tg-mermaid-v1","direction":"TD"}',
  '%% TG_BLOCK {"id":"block-1","type":"trigger","name":"Trigger","position":{"x":0,"y":0},"subBlocks":{},"outputs":{},"enabled":true}',
].join('\n')

let persistedToolCalls: Record<string, any> = {}

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

vi.mock('@/lib/yjs/workflow-shared-session', () => ({
  acquireSharedWorkflowSessionLease: (...args: any[]) =>
    mockAcquireSharedWorkflowSessionLease(...args),
}))

vi.mock('@/lib/yjs/workflow-session', () => ({
  setWorkflowState: (...args: any[]) => mockSetWorkflowState(...args),
}))

vi.mock('@/stores/copilot/store-access', () => ({
  getCopilotStoreForToolCall: () => ({
    getState: () => ({
      toolCallsById: persistedToolCalls,
    }),
  }),
}))

describe('EditWorkflowClientTool approval gating', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals?.()
    persistedToolCalls = {}
    mockGetReadableWorkflowState.mockReset()
    mockResolveWorkflowTarget.mockReset()
    mockSetWorkflowState.mockReset()
    mockGetRegisteredWorkflowSession.mockReset()
    mockAcquireSharedWorkflowSessionLease.mockReset()

    mockResolveWorkflowTarget.mockResolvedValue({
      workflowId: 'wf-1',
      workflowName: 'Workflow 1',
      workspaceId: 'workspace-1',
      folderId: null,
    })

    mockGetReadableWorkflowState.mockResolvedValue({
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
    mockAcquireSharedWorkflowSessionLease.mockImplementation(async ({ workflowId }) => ({
      session: {
        workflowId,
        doc: { id: workflowId === 'wf-target' ? 'doc-target' : 'doc-1' },
      },
      release: vi.fn(),
    }))
  })

  it('stages workflow edits for review through the unified user-action handler', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
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
              workflowDocument,
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
    const rejectRequest = fetchMock.mock.calls.find(([input]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/tools/mark-complete'
    })
    const rejectBody = JSON.parse(String(rejectRequest?.[1]?.body))
    expect(rejectBody.status).toBe(REJECTED_TOOL_COMPLETION_STATUS)
    expect(rejectBody.data).toEqual({ rejected: true })
  })

  it('stages workflow edits from a readable workflow snapshot when no live session is registered yet', async () => {
    mockGetReadableWorkflowState.mockResolvedValueOnce({
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
              workflowDocument,
            },
          }),
        }
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const tool = new EditWorkflowClientTool('tool-readable-state')
    tool.setExecutionContext({
      toolCallId: 'tool-readable-state',
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
              workflowDocument,
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

    const markCompleteRequest = fetchMock.mock.calls.find(([input]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/tools/mark-complete'
    })
    const markCompleteInit = markCompleteRequest
      ? ((markCompleteRequest as unknown as Array<unknown>)[1] as RequestInit | undefined)
      : undefined
    const markCompleteBody = JSON.parse(String(markCompleteInit?.body))
    expect(markCompleteBody.data).toMatchObject({
      entityKind: 'workflow',
      entityId: 'wf-1',
      entityDocument: workflowDocument,
      workflowId: 'wf-1',
      workflowDocument,
      documentFormat: 'tg-mermaid-v1',
    })
  })

  it('rejects edit execution without explicit workflowId even when current workflow context exists', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
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

    const tool = new EditWorkflowClientTool('tool-missing-workflow-id')
    tool.setExecutionContext({
      toolCallId: 'tool-missing-workflow-id',
      toolName: 'edit_workflow',
      channelId: 'pair-1',
      workflowId: 'wf-current',
      log: vi.fn(),
    })

    await tool.execute({
      workflowDocument,
    })

    expect(tool.getState()).toBe(ClientToolCallState.error)
    expect(mockResolveWorkflowTarget).not.toHaveBeenCalled()
    expect(mockSetWorkflowState).not.toHaveBeenCalled()

    const markCompleteRequest = fetchMock.mock.calls.find(([input]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/tools/mark-complete'
    })
    const markCompleteBody = JSON.parse(String(markCompleteRequest?.[1]?.body))
    expect(markCompleteBody.status).toBe(500)
    expect(markCompleteBody.message).toContain('workflowId is required')
  })

  it('accepts persisted staged workflow edits after reload using the persisted workflow target', async () => {
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
        params: {
          workflowId: 'wf-target',
          workflowDocument,
        },
        result: {
          workflowId: 'wf-target',
          workflowState: stagedWorkflowState,
        },
      },
    }

    mockResolveWorkflowTarget.mockImplementation(async (_executionContext, options) => ({
      workflowId: options?.workflowId ?? 'wf-current',
      workflowName: 'Workflow',
    }))
    mockAcquireSharedWorkflowSessionLease.mockImplementation(async ({ workflowId }) => ({
      session: {
        workflowId,
        doc: { id: workflowId === 'wf-target' ? 'doc-target' : 'doc-current' },
      },
      release: vi.fn(),
    }))

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
      workflowId: 'wf-current',
      log: vi.fn(),
    })
    tool.hydratePersistedToolCall(persistedToolCalls['tool-persisted-review'])

    await tool.handleUserAction()

    expect(tool.getState()).toBe(ClientToolCallState.success)
    expect(mockSetWorkflowState).toHaveBeenCalledWith(
      { id: 'doc-target' },
      stagedWorkflowState,
      YJS_ORIGINS.COPILOT_REVIEW_ACCEPT
    )
    expect(mockSetWorkflowState).not.toHaveBeenCalledWith(
      { id: 'doc-current' },
      stagedWorkflowState,
      YJS_ORIGINS.COPILOT_REVIEW_ACCEPT
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
