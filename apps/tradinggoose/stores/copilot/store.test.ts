import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { registerClientTool, unregisterClientTool } from '@/lib/copilot/tools/client/manager'
import { encodeSSE } from '@/lib/utils'
import { getCopilotStore, getCopilotStoreForToolCall } from '@/stores/copilot/store'
import { createExecutionContext } from '@/stores/copilot/tool-registry'

function createSseStream(events: unknown[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encodeSSE(event))
      }
      controller.close()
    },
  })
}

// TODO: move to shared vitest setup (e.g. vitest.setup.ts) if other test files need this
function ensureRequestAnimationFrame() {
  if (typeof globalThis.requestAnimationFrame !== 'function') {
    ;(globalThis as any).requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0)
      return 0
    }
  }
  if (typeof globalThis.cancelAnimationFrame !== 'function') {
    ;(globalThis as any).cancelAnimationFrame = () => {}
  }
}

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
      provenance: { channelId, workflowId: 'wf-origin-a' },
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

describe('copilot streaming regressions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    ensureRequestAnimationFrame()
  })

  it('updates the active chat title when a title_updated SSE event arrives', async () => {
    const channelId = 'copilot-stream-title-updated'
    const store = getCopilotStore(channelId)
    const updateMessages = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    }))

    vi.stubGlobal('fetch', updateMessages)

    store.setState({
      workflowId: 'wf-stream-title',
      currentChat: null,
      chats: [],
      messages: [
        {
          id: 'user-message',
          role: 'user',
          content: 'Build a screener',
          timestamp: '2026-03-30T00:00:00.000Z',
        },
        {
          id: 'assistant-message',
          role: 'assistant',
          content: '',
          timestamp: '2026-03-30T00:00:01.000Z',
        },
      ],
      isSendingMessage: true,
      abortController: null,
    })

    await store.getState().handleStreamingResponse(
      createSseStream([
        { type: 'review_session_id', reviewSessionId: 'review-stream-title' },
        { type: 'content', data: 'Done.' },
        { type: 'title_updated', title: 'Momentum Screener' },
        { type: 'done' },
      ]),
      'assistant-message'
    )

    expect(store.getState().currentChat?.title).toBe('Momentum Screener')
    expect(store.getState().chats[0]?.title).toBe('Momentum Screener')
  })

  it('preserves pending and executing tool states when reloading chats', async () => {
    const channelId = 'copilot-tool-state-reload'
    const store = getCopilotStore(channelId)

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (!url.includes('/api/copilot/chat?workflowId=wf-reload')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true }),
          }
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            chats: [
              {
                reviewSessionId: 'review-reload',
                workspaceId: null,
                entityKind: 'workflow',
                entityId: 'wf-reload',
                draftSessionId: null,
                title: 'Reloaded chat',
                reviewModel: 'claude-4.5-sonnet',
                conversationId: null,
                messages: [
                  {
                    id: 'assistant-message',
                    role: 'assistant',
                    content: '',
                    timestamp: '2026-03-30T00:00:00.000Z',
                    contentBlocks: [
                      {
                        type: 'tool_call',
                        timestamp: 1,
                        toolCall: {
                          id: 'pending-tool',
                          name: 'manage_skill',
                          state: ClientToolCallState.pending,
                          params: { operation: 'edit' },
                        },
                      },
                      {
                        type: 'tool_call',
                        timestamp: 2,
                        toolCall: {
                          id: 'executing-tool',
                          name: 'manage_indicator',
                          state: ClientToolCallState.executing,
                          params: { operation: 'edit' },
                        },
                      },
                    ],
                  },
                ],
                messageCount: 1,
                createdAt: '2026-03-30T00:00:00.000Z',
                updatedAt: '2026-03-30T00:00:00.000Z',
              },
            ],
          }),
        }
      })
    )

    store.setState({
      workflowId: 'wf-reload',
      currentChat: null,
      chats: [],
      messages: [],
      toolCallsById: {},
      isLoadingChats: false,
      isSendingMessage: false,
      abortController: null,
      chatsLoadedForWorkflow: null,
      chatsLastLoadedAt: null,
      suppressAutoSelect: false,
    })

    await store.getState().loadChats(true)

    const pendingBlock = store.getState().messages[0]?.contentBlocks?.[0] as any
    const executingBlock = store.getState().messages[0]?.contentBlocks?.[1] as any

    expect(pendingBlock?.toolCall?.state).toBe(ClientToolCallState.pending)
    expect(executingBlock?.toolCall?.state).toBe(ClientToolCallState.executing)
    expect(store.getState().toolCallsById['pending-tool']?.state).toBe(
      ClientToolCallState.pending
    )
    expect(store.getState().toolCallsById['executing-tool']?.state).toBe(
      ClientToolCallState.executing
    )
  })
})

describe('copilot workflow edit execution order', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('stages a pending edit_workflow tool before entering review', async () => {
    const channelId = 'copilot-edit-workflow-order'
    const toolCallId = 'edit-workflow-order-tool'
    const store = getCopilotStore(channelId)
    const calls: string[] = []
    const fakeTool = {
      setExecutionContext: vi.fn(),
      getInterruptDisplays: () => ({
        accept: { text: 'Accept changes', icon: () => null },
        reject: { text: 'Reject changes', icon: () => null },
      }),
      execute: vi.fn(async () => {
        calls.push('execute')
      }),
      handleAccept: vi.fn(async () => {
        calls.push('accept')
      }),
      handleReject: vi.fn(async () => {
        calls.push('reject')
      }),
    }

    registerClientTool(toolCallId, fakeTool)

    store.setState({
      workflowId: 'wf-edit-workflow-order',
      currentChat: {
        reviewSessionId: 'review-edit-workflow-order',
        workspaceId: null,
        entityKind: 'workflow',
        entityId: 'wf-edit-workflow-order',
        draftSessionId: null,
        title: null,
        reviewModel: 'claude-4.5-sonnet',
        messages: [],
        messageCount: 0,
        conversationId: null,
        createdAt: new Date('2026-03-30T00:00:00.000Z'),
        updatedAt: new Date('2026-03-30T00:00:00.000Z'),
      },
      toolCallsById: {
        [toolCallId]: {
          id: toolCallId,
          name: 'edit_workflow',
          state: ClientToolCallState.pending,
          params: {
            operations: [
              { operation_type: 'edit', block_id: 'block-1', params: { name: 'New name' } },
            ],
            workflowId: 'wf-edit-workflow-order',
          },
          provenance: {
            channelId,
            workflowId: 'wf-edit-workflow-order',
            reviewSessionId: 'review-edit-workflow-order',
            entityKind: 'workflow',
            entityId: 'wf-edit-workflow-order',
            workspaceId: 'workspace-1',
          },
        } as any,
      },
    })

    await store.getState().executeCopilotToolCall(toolCallId)

    expect(calls[0]).toBe('execute')
    expect(calls).not.toContain('accept')

    unregisterClientTool(toolCallId)
  })

  it('accepts a review-state edit_workflow tool without recomputing when a staged result exists', async () => {
    const channelId = 'copilot-edit-workflow-review'
    const toolCallId = 'edit-workflow-review-tool'
    const store = getCopilotStore(channelId)
    const calls: string[] = []
    const fakeTool = {
      setExecutionContext: vi.fn(),
      getInterruptDisplays: () => ({
        accept: { text: 'Accept changes', icon: () => null },
        reject: { text: 'Reject changes', icon: () => null },
      }),
      execute: vi.fn(async () => {
        calls.push('execute')
      }),
      handleAccept: vi.fn(async () => {
        calls.push('accept')
      }),
      handleReject: vi.fn(async () => {
        calls.push('reject')
      }),
    }

    registerClientTool(toolCallId, fakeTool)

    store.setState({
      workflowId: 'wf-edit-workflow-review',
      currentChat: {
        reviewSessionId: 'review-edit-workflow-review',
        workspaceId: null,
        entityKind: 'workflow',
        entityId: 'wf-edit-workflow-review',
        draftSessionId: null,
        title: null,
        reviewModel: 'claude-4.5-sonnet',
        messages: [],
        messageCount: 0,
        conversationId: null,
        createdAt: new Date('2026-03-30T00:00:00.000Z'),
        updatedAt: new Date('2026-03-30T00:00:00.000Z'),
      },
      toolCallsById: {
        [toolCallId]: {
          id: toolCallId,
          name: 'edit_workflow',
          state: ClientToolCallState.review,
          params: {
            operations: [
              { operation_type: 'edit', block_id: 'block-1', params: { name: 'New name' } },
            ],
            workflowId: 'wf-edit-workflow-review',
          },
          result: {
            workflowState: {
              blocks: {},
              edges: [],
              loops: {},
              parallels: {},
            },
          },
          provenance: {
            channelId,
            workflowId: 'wf-edit-workflow-review',
            reviewSessionId: 'review-edit-workflow-review',
            entityKind: 'workflow',
            entityId: 'wf-edit-workflow-review',
            workspaceId: 'workspace-1',
          },
        } as any,
      },
    })

    await store.getState().executeCopilotToolCall(toolCallId)

    expect(calls).toEqual(['accept'])

    unregisterClientTool(toolCallId)
  })
})
