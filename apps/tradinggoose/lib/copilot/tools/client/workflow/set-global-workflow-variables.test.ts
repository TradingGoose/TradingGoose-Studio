import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { SetGlobalWorkflowVariablesClientTool } from '@/lib/copilot/tools/client/workflow/set-global-workflow-variables'

const mockSetVariablesState = vi.fn()

vi.mock('@/stores/variables/store', () => ({
  useVariablesStore: {
    setState: (updater: any) => mockSetVariablesState(updater),
  },
}))

describe('SetGlobalWorkflowVariablesClientTool channel-safe workflow scoping', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    mockSetVariablesState.mockReset()
  })

  it('handleAccept uses execution-context workflow for all API calls when args.workflowId is omitted', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method || 'GET'

      if (url === '/api/workflows/wf-context/variables' && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              'var-1': {
                id: 'var-1',
                workflowId: 'wf-context',
                name: 'existing',
                type: 'plain',
                value: 'value',
              },
            },
          }),
        }
      }

      if (url === '/api/workflows/wf-context/variables' && method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
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

    const toolCallId = 'set-vars-tool-call'
    const tool = new SetGlobalWorkflowVariablesClientTool(toolCallId)
    tool.setExecutionContext({
      toolCallId,
      toolName: 'set_global_workflow_variables',
      channelId: 'pair-purple',
      workflowId: 'wf-context',
      log: vi.fn(),
    })

    await tool.handleAccept({
      operations: [{ operation: 'delete', name: 'missing-variable' }],
    })

    const workflowApiCalls = fetchMock.mock.calls
      .map(([input, init]) => ({
        url: typeof input === 'string' ? input : input.toString(),
        method: init?.method || 'GET',
      }))
      .filter((call) => call.url.includes('/api/workflows/'))

    expect(workflowApiCalls).toEqual([
      { url: '/api/workflows/wf-context/variables', method: 'GET' },
      { url: '/api/workflows/wf-context/variables', method: 'POST' },
      { url: '/api/workflows/wf-context/variables', method: 'GET' },
    ])
    expect(tool.getState()).toBe(ClientToolCallState.success)
  })
})
