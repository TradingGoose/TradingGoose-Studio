import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { CreateWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/create-workflow'
import { RenameWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/rename-workflow'

const mockCopilotState = {
  toolCallsById: {} as Record<string, { params?: Record<string, unknown> }>,
}

const mockRegistryState = {
  workflows: {} as Record<string, any>,
  createWorkflow: vi.fn(),
}

const originalFetch = globalThis.fetch

vi.mock('@/stores/copilot/store-access', () => ({
  getCopilotStoreForToolCall: () => ({
    getState: () => mockCopilotState,
  }),
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: {
    getState: () => mockRegistryState,
    setState: (updater: any) => {
      const nextState = typeof updater === 'function' ? updater(mockRegistryState) : updater

      if (nextState && typeof nextState === 'object') {
        Object.assign(mockRegistryState, nextState)
      }
    },
  },
}))

describe('workflow metadata tools', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals?.()
    globalThis.fetch = originalFetch
    mockCopilotState.toolCallsById = {}
    mockRegistryState.workflows = {}
    mockRegistryState.createWorkflow = vi.fn()
  })

  it('create_workflow creates a workflow in the current workspace and marks completion', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method || 'GET'

      if (url === '/api/copilot/tools/mark-complete' && method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        }
      }

      throw new Error(`Unexpected fetch URL: ${url} (${method})`)
    })
    vi.stubGlobal('fetch', fetchMock)

    mockRegistryState.createWorkflow = vi.fn(async (options: Record<string, unknown>) => {
      mockRegistryState.workflows['wf-2'] = {
        id: 'wf-2',
        name: String(options.name ?? 'Created Workflow'),
        workspaceId: String(options.workspaceId),
      }
      return 'wf-2'
    })

    const toolCallId = 'create-workflow'
    const tool = new CreateWorkflowClientTool(toolCallId)
    tool.setExecutionContext({
      toolCallId,
      toolName: 'create_workflow',
      channelId: 'pair-blue',
      workspaceId: 'ws-1',
      log: vi.fn(),
    })

    await tool.execute({
      name: 'Created Workflow',
      description: 'Created from copilot',
    })
    await tool.handleAccept()

    expect(tool.getState()).toBe(ClientToolCallState.success)
    expect(mockRegistryState.createWorkflow).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      name: 'Created Workflow',
      description: 'Created from copilot',
    })

    const markCompleteCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/tools/mark-complete' && (init?.method || 'GET') === 'POST'
    })
    const markCompleteBody = JSON.parse(String(markCompleteCall?.[1]?.body))
    expect(markCompleteBody.name).toBe('create_workflow')
    expect(markCompleteBody.data).toMatchObject({
      success: true,
      entityKind: 'workflow',
      entityId: 'wf-2',
      entityName: 'Created Workflow',
      workflowId: 'wf-2',
      workflowName: 'Created Workflow',
      workspaceId: 'ws-1',
    })
  })

  it('rename_workflow renames the target workflow and syncs the local registry', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method || 'GET'

      if (url === '/api/workflows/wf-1' && method === 'PUT') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            workflow: {
              id: 'wf-1',
              name: 'Renamed Workflow',
              workspaceId: 'ws-1',
              updatedAt: '2026-04-18T00:00:00.000Z',
            },
          }),
        }
      }

      if (url === '/api/copilot/tools/mark-complete' && method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        }
      }

      throw new Error(`Unexpected fetch URL: ${url} (${method})`)
    })
    vi.stubGlobal('fetch', fetchMock)

    mockRegistryState.workflows = {
      'wf-1': {
        id: 'wf-1',
        name: 'Old Workflow',
        workspaceId: 'ws-1',
        lastModified: new Date('2026-04-17T00:00:00.000Z'),
      },
    }

    const toolCallId = 'rename-workflow'
    const tool = new RenameWorkflowClientTool(toolCallId)
    tool.setExecutionContext({
      toolCallId,
      toolName: 'rename_workflow',
      channelId: 'pair-blue',
      log: vi.fn(),
    })

    await tool.execute({
      workflowId: 'wf-1',
      name: 'Renamed Workflow',
    })
    await tool.handleAccept()

    expect(tool.getState()).toBe(ClientToolCallState.success)
    expect(mockRegistryState.workflows['wf-1'].name).toBe('Renamed Workflow')

    const markCompleteCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/tools/mark-complete' && (init?.method || 'GET') === 'POST'
    })
    const markCompleteBody = JSON.parse(String(markCompleteCall?.[1]?.body))
    expect(markCompleteBody.name).toBe('rename_workflow')
    expect(markCompleteBody.data).toMatchObject({
      success: true,
      entityKind: 'workflow',
      entityId: 'wf-1',
      entityName: 'Renamed Workflow',
      workflowId: 'wf-1',
      workflowName: 'Renamed Workflow',
      workspaceId: 'ws-1',
    })
  })
})
