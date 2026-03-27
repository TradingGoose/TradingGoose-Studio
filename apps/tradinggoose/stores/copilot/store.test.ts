import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { getCopilotStore, getCopilotStoreForToolCall } from '@/stores/copilot/store'
import { createExecutionContext } from '@/stores/copilot/tool-registry'

describe('copilot tool execution provenance', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('createExecutionContext uses explicit pinned provenance', () => {
    const channelId = 'copilot-provenance-channel-a'
    const toolCallId = 'copilot-provenance-tool-a'

    const context = createExecutionContext({
      toolCallId,
      toolName: 'edit_workflow',
      channelId,
      workflowId: 'wf-origin-a',
    })

    expect(context.channelId).toBe(channelId)
    expect(context.workflowId).toBe('wf-origin-a')
  })

  it('executeIntegrationTool sends pinned workflow id', async () => {
    const channelId = 'copilot-provenance-channel-b'
    const toolCallId = 'copilot-provenance-tool-b'
    const store = getCopilotStore(channelId)

    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/copilot/execute-tool')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            result: {
              success: true,
              output: { content: 'ok' },
            },
          }),
        }
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    store.setState({
      workflowId: 'wf-current-e',
      toolCallsById: {
        [toolCallId]: {
          id: toolCallId,
          name: 'some_integration_tool',
          state: ClientToolCallState.pending,
          params: { foo: 'bar' },
          provenance: {
            channelId,
            workflowId: 'wf-origin-b',
          },
        },
      },
    })

    await store.getState().executeIntegrationTool(toolCallId)

    const executeRequest = fetchMock.mock.calls.find(([input]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url.includes('/api/copilot/execute-tool')
    })
    expect(executeRequest).toBeDefined()

    const body = JSON.parse((executeRequest?.[1] as RequestInit).body as string)
    expect(body.workflowId).toBe('wf-origin-b')
  })

  it('prefers provenance-matched channel when duplicate toolCallId exists', () => {
    const toolCallId = 'copilot-provenance-duplicate'
    const channelA = 'copilot-provenance-channel-c'
    const channelB = 'copilot-provenance-channel-d'

    const storeA = getCopilotStore(channelA)
    const storeB = getCopilotStore(channelB)

    storeA.setState({
      toolCallsById: {
        [toolCallId]: {
          id: toolCallId,
          name: 'edit_workflow',
          state: ClientToolCallState.pending,
        },
      },
    })

    storeB.setState({
      toolCallsById: {
        [toolCallId]: {
          id: toolCallId,
          name: 'edit_workflow',
          state: ClientToolCallState.pending,
          provenance: {
            channelId: channelB,
            workflowId: 'wf-origin-c',
          },
        },
      },
    })

    expect(getCopilotStoreForToolCall(toolCallId)).toBe(storeB)
  })
})
