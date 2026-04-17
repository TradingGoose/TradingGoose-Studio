import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { registerClientTool, unregisterClientTool } from '@/lib/copilot/tools/client/manager'
import { encodeSSE } from '@/lib/utils'
import { getCopilotStore } from '@/stores/copilot/store'
import { getCopilotStoreForToolCall } from '@/stores/copilot/store-access'
import { createExecutionContext } from '@/stores/copilot/tool-registry'
import { useEnvironmentStore } from '@/stores/settings/environment/store'

type FetchCall = readonly [input: RequestInfo | URL, init?: RequestInit]

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

function createDeferredSseStream() {
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null
  let resolveReady: (() => void) | null = null
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller
      resolveReady?.()
    },
  })

  return {
    stream,
    ready,
    push(event: unknown) {
      controllerRef?.enqueue(encodeSSE(event))
    },
    close() {
      controllerRef?.close()
    },
  }
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

function parseJsonRequestBody(request: FetchCall | undefined): Record<string, unknown> {
  expect(request).toBeDefined()
  if (!request) {
    throw new Error('Expected fetch request')
  }

  const [, init] = request
  expect(init).toBeDefined()
  if (!init || typeof init.body !== 'string') {
    throw new Error('Expected JSON request body')
  }

  return JSON.parse(init.body) as Record<string, unknown>
}

describe('copilot tool execution provenance', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    ensureRequestAnimationFrame()
  })

  it('createExecutionContext uses explicit pinned provenance', () => {
    const channelId = 'copilot-provenance-channel-a'
    const toolCallId = 'copilot-provenance-tool-a'

    const context = createExecutionContext({
      toolCallId,
      toolName: 'edit_workflow',
      provenance: {
        channelId,
        workflowId: 'wf-origin-a',
        contextWorkflowId: 'wf-current-a',
      },
    })

    expect(context.channelId).toBe(channelId)
    expect(context.workflowId).toBe('wf-origin-a')
    expect(context.contextWorkflowId).toBe('wf-current-a')
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
      liveContext: {
        workflowId: 'wf-current-e',
        workspaceId: 'workspace-1',
      },
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
    const body = parseJsonRequestBody(executeRequest)
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

  it('parses JSON-string function call arguments before storing tool params', async () => {
    const channelId = 'copilot-stringified-tool-args'
    const toolCallId = 'copilot-stringified-tool-call'
    const store = getCopilotStore(channelId)

    store.setState({
      liveContext: {
        workflowId: 'wf-stringified-live',
        workspaceId: 'workspace-1',
      },
      currentChat: null,
      chats: [],
      messages: [
        {
          id: 'assistant-message-stringified',
          role: 'assistant',
          content: '',
          timestamp: '2026-04-13T00:00:00.000Z',
        },
      ],
      isSendingMessage: true,
      abortController: null,
      toolCallsById: {},
    })

    await store.getState().handleStreamingResponse(
      createSseStream([
        {
          type: 'response.output_item.done',
          item: {
            type: 'function_call',
            call_id: toolCallId,
            name: 'get_user_workflow',
            arguments: JSON.stringify({
              workflowId: 'wf-stringified-explicit',
              entityId: 'entity-stringified-explicit',
            }),
          },
        },
        {
          type: 'response.completed',
          response: { id: 'response-stringified-args' },
        },
      ]),
      'assistant-message-stringified'
    )

    expect(store.getState().toolCallsById[toolCallId]).toMatchObject({
      params: {
        workflowId: 'wf-stringified-explicit',
        entityId: 'entity-stringified-explicit',
      },
      provenance: {
        channelId,
        workflowId: 'wf-stringified-explicit',
        entityId: 'entity-stringified-explicit',
      },
    })
  })

  it('does not pin ambient message contexts as tool targets when the tool omits a target id', async () => {
    const channelId = 'copilot-mid-stream-target-switch'
    const toolCallId = 'copilot-mid-stream-target-tool'
    const store = getCopilotStore(channelId)
    const deferredStream = createDeferredSseStream()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/copilot/chat') {
        return {
          ok: true,
          status: 200,
          body: deferredStream.stream,
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
      liveContext: {
        workflowId: 'wf-live-at-send',
        workspaceId: 'workspace-1',
      },
      currentChat: {
        reviewSessionId: 'review-panel-chat-mid-stream',
        workspaceId: 'workspace-1',
        channelId,
        entityKind: 'copilot',
        entityId: null,
        draftSessionId: null,
        title: 'Generic panel chat',
        messages: [],
        messageCount: 0,
        conversationId: 'conversation-mid-stream',
        createdAt: new Date('2026-04-13T00:00:00.000Z'),
        updatedAt: new Date('2026-04-13T00:00:00.000Z'),
      },
      chats: [],
      implicitContexts: [
        {
          kind: 'current_workflow',
          workflowId: 'wf-live-at-send',
          label: 'Current Workflow',
        },
      ],
    })

    const sendPromise = store.getState().sendMessage('Inspect the attached workflow', {
      contexts: [{ kind: 'workflow', workflowId: 'wf-message-context', label: 'Attached Workflow' }],
    })
    await deferredStream.ready

    const sendRequest = fetchMock.mock.calls.find(([input]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/chat'
    })
    const requestBody = parseJsonRequestBody(sendRequest)
    expect(requestBody.workflowId).toBeUndefined()

    store.setState({
      liveContext: {
        workflowId: 'wf-message-b',
        workspaceId: 'workspace-1',
      },
    })

    deferredStream.push({
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        call_id: toolCallId,
        name: 'get_user_workflow',
        arguments: {},
      },
    })
    deferredStream.push({
      type: 'response.completed',
      response: { id: 'response-mid-stream-target' },
    })
    deferredStream.close()

    await sendPromise

    expect(store.getState().toolCallsById[toolCallId]).toMatchObject({
      provenance: {
        channelId,
        contextWorkflowId: 'wf-live-at-send',
        workspaceId: 'workspace-1',
      },
    })
    expect(store.getState().toolCallsById[toolCallId].provenance).not.toHaveProperty('workflowId')
    expect(store.getState().toolCallsById[toolCallId].provenance).not.toHaveProperty('entityId')

    const usageRequest = fetchMock.mock.calls.find(([input]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/usage'
    })
    expect(parseJsonRequestBody(usageRequest)).not.toHaveProperty('workflowId')
  })

  it('does not pin current or attached entity contexts as edit targets', async () => {
    const channelId = 'copilot-workflow-plus-draft-entity'
    const toolCallId = 'copilot-draft-entity-tool'
    const store = getCopilotStore(channelId)
    const deferredStream = createDeferredSseStream()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/copilot/chat') {
        return {
          ok: true,
          status: 200,
          body: deferredStream.stream,
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
      liveContext: {
        workflowId: 'wf-current',
        workspaceId: 'workspace-1',
      },
      currentChat: {
        reviewSessionId: 'review-panel-chat-draft-entity',
        workspaceId: 'workspace-1',
        channelId,
        entityKind: 'copilot',
        entityId: null,
        draftSessionId: null,
        title: 'Generic panel chat',
        messages: [],
        messageCount: 0,
        conversationId: 'conversation-draft-entity',
        createdAt: new Date('2026-04-13T00:00:00.000Z'),
        updatedAt: new Date('2026-04-13T00:00:00.000Z'),
      },
      chats: [],
      implicitContexts: [
        {
          kind: 'current_workflow',
          workflowId: 'wf-current',
          label: 'Current Workflow',
        },
        {
          kind: 'current_skill',
          skillId: 'skill-draft',
          workspaceId: 'workspace-1',
          label: 'Current Skill',
        },
      ],
    })

    const sendPromise = store.getState().sendMessage('Edit the draft skill using this workflow', {
      contexts: [{ kind: 'workflow', workflowId: 'wf-explicit', label: 'Attached Workflow' }],
    })
    await deferredStream.ready

    deferredStream.push({
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        call_id: toolCallId,
        name: 'edit_skill',
        arguments: {},
      },
    })
    deferredStream.push({
      type: 'response.completed',
      response: { id: 'response-draft-entity' },
    })
    deferredStream.close()

    await sendPromise

    expect(store.getState().toolCallsById[toolCallId]).toMatchObject({
      provenance: {
        channelId,
        contextWorkflowId: 'wf-current',
        workspaceId: 'workspace-1',
      },
    })
    expect(store.getState().toolCallsById[toolCallId].provenance).not.toHaveProperty('workflowId')
    expect(store.getState().toolCallsById[toolCallId].provenance).not.toHaveProperty('entityId')
  })

  it('pins the explicit unsaved review target session for draft entity tools', async () => {
    const channelId = 'copilot-unsaved-review-target'
    const toolCallId = 'copilot-unsaved-review-target-tool'
    const store = getCopilotStore(channelId)
    const deferredStream = createDeferredSseStream()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/copilot/chat') {
        return {
          ok: true,
          status: 200,
          body: deferredStream.stream,
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
      liveContext: {
        workflowId: 'wf-current',
        workspaceId: 'workspace-1',
        reviewTarget: {
          entityKind: 'skill',
          entityId: null,
          reviewSessionId: 'review-draft',
          draftSessionId: 'draft-1',
        },
      },
      currentChat: {
        reviewSessionId: 'review-panel-chat-draft-entity',
        workspaceId: 'workspace-1',
        channelId,
        entityKind: 'copilot',
        entityId: null,
        draftSessionId: null,
        title: 'Generic panel chat',
        messages: [],
        messageCount: 0,
        conversationId: 'conversation-draft-entity',
        createdAt: new Date('2026-04-13T00:00:00.000Z'),
        updatedAt: new Date('2026-04-13T00:00:00.000Z'),
      },
      chats: [],
      implicitContexts: [
        {
          kind: 'current_skill',
          skillId: 'skill-viewing',
          workspaceId: 'workspace-1',
          label: 'Current Skill',
        },
      ],
    })

    const sendPromise = store.getState().sendMessage('Fix this draft skill')
    await deferredStream.ready

    deferredStream.push({
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        call_id: toolCallId,
        name: 'edit_skill',
        arguments: { entityDocument: '{}' },
      },
    })
    deferredStream.push({
      type: 'response.completed',
      response: { id: 'response-draft-review-target' },
    })
    deferredStream.close()

    await sendPromise

    expect(store.getState().toolCallsById[toolCallId]).toMatchObject({
      provenance: {
        channelId,
        contextWorkflowId: 'wf-current',
        workspaceId: 'workspace-1',
        entityKind: 'skill',
        reviewSessionId: 'review-draft',
        draftSessionId: 'draft-1',
      },
    })
    expect(store.getState().toolCallsById[toolCallId].provenance).not.toHaveProperty('entityId')
    expect(store.getState().toolCallsById[toolCallId].provenance).not.toHaveProperty('workflowId')
  })
})

describe('copilot streaming regressions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    ensureRequestAnimationFrame()
  })

  it('preserves thinking, text, tool, and continuation text ordering within one streamed assistant message', async () => {
    const channelId = 'copilot-streaming-progress-order'
    const store = getCopilotStore(channelId)

    store.setState({
      liveContext: {
        workflowId: 'wf-stream-order',
        workspaceId: 'workspace-1',
      },
      currentChat: null,
      chats: [],
      messages: [
        {
          id: 'assistant-message',
          role: 'assistant',
          content: '',
          timestamp: '2026-04-13T00:00:00.000Z',
        },
      ],
      isSendingMessage: true,
      abortController: null,
      toolCallsById: {},
    })

    await store.getState().handleStreamingResponse(
      createSseStream([
        {
          type: 'response.output_item.added',
          item: {
            id: 'reasoning-1',
            type: 'reasoning',
            content: [{ type: 'reasoning_text', text: '' }],
          },
        },
        {
          type: 'response.reasoning_text.delta',
          item_id: 'reasoning-1',
          delta: 'Inspecting the current workflow and tool options.',
        },
        {
          type: 'response.output_item.done',
          item: {
            id: 'reasoning-1',
            type: 'reasoning',
            content: [
              {
                type: 'reasoning_text',
                text: 'Inspecting the current workflow and tool options.',
              },
            ],
          },
        },
        {
          type: 'response.output_item.added',
          item: {
            id: 'assistant-item-1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '' }],
          },
        },
        {
          type: 'response.output_text.delta',
          item_id: 'assistant-item-1',
          delta: "I'm checking the current workflow before I edit it.",
        },
        {
          type: 'response.output_item.done',
          item: {
            id: 'assistant-item-1',
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: "I'm checking the current workflow before I edit it.",
              },
            ],
          },
        },
        {
          type: 'response.output_item.done',
          item: {
            type: 'function_call',
            call_id: 'tool-1',
            name: 'get_user_workflow',
            arguments: { workflowId: 'wf-stream-order' },
          },
        },
        {
          type: 'tool_result',
          toolCallId: 'tool-1',
          success: true,
          failedDependency: false,
          result: { workflowDocument: 'flowchart TD' },
        },
        {
          type: 'response.output_item.added',
          item: {
            id: 'assistant-item-2',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '' }],
          },
        },
        {
          type: 'response.output_text.delta',
          item_id: 'assistant-item-2',
          delta: "I found the current workflow and I'm preparing the edit now.",
        },
        {
          type: 'response.output_item.done',
          item: {
            id: 'assistant-item-2',
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: "I found the current workflow and I'm preparing the edit now.",
              },
            ],
          },
        },
        { type: 'response.completed', response: { id: 'response-ordering' } },
      ]),
      'assistant-message'
    )

    const blocks = store.getState().messages[0]?.contentBlocks as any[]

    expect(blocks.map((block) => block.type)).toEqual([
      'thinking',
      'text',
      'tool_call',
      'text',
    ])
    expect(blocks[0]?.content).toContain('Inspecting the current workflow')
    expect(blocks[1]?.content).toContain('checking the current workflow')
    expect(blocks[2]?.toolCall?.id).toBe('tool-1')
    expect(blocks[2]?.toolCall?.state).toBe(ClientToolCallState.success)
    expect(blocks[3]?.content).toContain('preparing the edit now')
  })

  it('uses the final output item text when it differs from streamed deltas', async () => {
    const channelId = 'copilot-streaming-final-item-authority'
    const store = getCopilotStore(channelId)

    store.setState({
      liveContext: {
        workflowId: 'wf-final-authority',
        workspaceId: 'workspace-1',
      },
      currentChat: null,
      chats: [],
      messages: [
        {
          id: 'assistant-message-final',
          role: 'assistant',
          content: '',
          timestamp: '2026-04-13T00:00:00.000Z',
        },
      ],
      isSendingMessage: true,
      abortController: null,
      toolCallsById: {},
    })

    await store.getState().handleStreamingResponse(
      createSseStream([
        {
          type: 'response.output_item.added',
          item: {
            id: 'assistant-item-final',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '' }],
          },
        },
        {
          type: 'response.output_text.delta',
          item_id: 'assistant-item-final',
          delta: 'Draft reply that should be replaced.',
        },
        {
          type: 'response.output_item.done',
          item: {
            id: 'assistant-item-final',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Final corrected reply.' }],
          },
        },
        { type: 'response.completed', response: { id: 'response-final-authority' } },
      ]),
      'assistant-message-final'
    )

    const message = store.getState().messages[0]
    expect(message?.content).toBe('Final corrected reply.')
    expect((message?.contentBlocks as any[])?.[0]?.content).toBe('Final corrected reply.')
  })

  it('treats awaiting_tools as a pause and skips terminal billing fetch', async () => {
    const channelId = 'copilot-awaiting-tools-pause'
    const store = getCopilotStore(channelId)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/copilot/chat/update-messages') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        }
      }

      if (url === '/api/copilot/usage') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ tokensUsed: 10, percentage: 1 }),
        }
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)

    store.setState({
      liveContext: {
        workflowId: 'wf-awaiting-tools',
        workspaceId: 'workspace-1',
      },
      currentChat: {
        reviewSessionId: 'review-awaiting-tools',
        workspaceId: 'workspace-1',
        channelId,
        entityKind: 'copilot',
        entityId: null,
        draftSessionId: null,
        title: 'Awaiting tools',
        messages: [],
        messageCount: 0,
        conversationId: 'conversation-awaiting-tools',
        createdAt: new Date('2026-04-14T00:00:00.000Z'),
        updatedAt: new Date('2026-04-14T00:00:00.000Z'),
      },
      chats: [],
      messages: [
        {
          id: 'assistant-message-awaiting-tools',
          role: 'assistant',
          content: '',
          timestamp: '2026-04-14T00:00:00.000Z',
        },
      ],
      isSendingMessage: true,
      abortController: null,
      toolCallsById: {},
    })

    await store.getState().handleStreamingResponse(
      createSseStream([
        {
          type: 'response.output_item.added',
          item: {
            id: 'assistant-awaiting-tools',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '' }],
          },
        },
        {
          type: 'response.output_text.delta',
          item_id: 'assistant-awaiting-tools',
          delta: 'Checking the workflow before continuing.',
        },
        { type: 'awaiting_tools', data: { pendingToolCallIds: ['tool-await-1'] } },
      ]),
      'assistant-message-awaiting-tools'
    )

    expect(
      fetchMock.mock.calls.some(([input]) => {
        const url = typeof input === 'string' ? input : input.toString()
        return url === '/api/copilot/usage'
      })
    ).toBe(false)
    expect(store.getState().isSendingMessage).toBe(true)
    expect(store.getState().messages[0]?.contentBlocks?.[0]?.type).toBe('text')
  })

  it('keeps limited-access pending approval tools active after awaiting_tools', async () => {
    const channelId = 'copilot-awaiting-tools-pending-approval'
    const assistantMessageId = 'assistant-message-awaiting-pending'
    const reviewSessionId = 'review-awaiting-pending'
    const store = getCopilotStore(channelId)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/copilot/chat/update-messages') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        }
      }

      if (url === '/api/copilot/usage') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ tokensUsed: 10, percentage: 1 }),
        }
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)

    store.setState({
      accessLevel: 'limited',
      liveContext: {
        workflowId: 'wf-awaiting-pending',
        workspaceId: 'workspace-1',
      },
      currentChat: {
        reviewSessionId,
        workspaceId: 'workspace-1',
        channelId,
        entityKind: 'copilot',
        entityId: null,
        draftSessionId: null,
        title: 'Awaiting pending approval',
        messages: [],
        messageCount: 0,
        conversationId: 'conversation-awaiting-pending',
        latestTurnStatus: 'in_progress',
        createdAt: new Date('2026-04-17T00:00:00.000Z'),
        updatedAt: new Date('2026-04-17T00:00:00.000Z'),
      } as any,
      chats: [],
      messages: [
        {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          timestamp: '2026-04-17T00:00:00.000Z',
        },
      ],
      isSendingMessage: true,
      abortController: null,
      toolCallsById: {},
    })

    await store.getState().handleStreamingResponse(
      createSseStream([
        {
          type: 'response.output_item.done',
          item: {
            type: 'function_call',
            call_id: 'pending-approval-tool',
            name: 'make_api_request',
            arguments: {
              url: 'https://example.com/data',
              method: 'GET',
            },
          },
        },
        { type: 'awaiting_tools', data: { pendingToolCallIds: ['pending-approval-tool'] } },
      ]),
      assistantMessageId
    )

    const updateMessageCalls = fetchMock.mock.calls.filter(([input]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/chat/update-messages'
    })
    const updateMessagesBody = parseJsonRequestBody(updateMessageCalls.at(-1))
    expect(updateMessagesBody.latestTurnStatus).toBe('in_progress')
    expect(store.getState().currentChat?.latestTurnStatus).toBe('in_progress')
    expect(store.getState().toolCallsById['pending-approval-tool']?.state).toBe(
      ClientToolCallState.pending
    )
    expect(store.getState().isSendingMessage).toBe(true)
  })

  it('starts queued tool execution before chat persistence finishes', async () => {
    vi.useFakeTimers()
    const channelId = 'copilot-deferred-tool-auto-exec'
    const toolCallId = 'copilot-deferred-mark-todo'
    const store = getCopilotStore(channelId)
    const deferredStream = createDeferredSseStream()
    const fakeTool = {
      execute: vi.fn(async () => {}),
    }
    let resolveSaveMessages: ((value: { ok: boolean; status: number }) => void) | null = null

    registerClientTool(toolCallId, fakeTool)

    try {
      store.setState({
        accessLevel: 'full',
        liveContext: {
          workflowId: null,
          workspaceId: 'workspace-1',
        },
        currentChat: null,
        chats: [],
        messages: [
          {
            id: 'assistant-message-deferred-tool',
            role: 'assistant',
            content: '',
            timestamp: '2026-04-17T00:00:00.000Z',
          },
        ],
        isSendingMessage: true,
        abortController: null,
        toolCallsById: {},
      })

      const saveMessagesResponse = new Promise<{ ok: boolean; status: number }>((resolve) => {
        resolveSaveMessages = resolve
      })

      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.toString()
          if (url === '/api/copilot/chat/update-messages') {
            return saveMessagesResponse
          }

          if (url === '/api/copilot/usage') {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                usage: { usage: 0, percentage: 0, contextWindow: 0, model: 'claude-sonnet-4.6' },
              }),
            }
          }

          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true }),
          }
        })
      )

      const responsePromise = store
        .getState()
        .handleStreamingResponse(deferredStream.stream, 'assistant-message-deferred-tool')

      await deferredStream.ready
      deferredStream.push({
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: toolCallId,
          name: 'mark_todo_in_progress',
          arguments: { id: 'todo-1' },
        },
      })

      await Promise.resolve()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(0)

      expect(fakeTool.execute).not.toHaveBeenCalled()
      deferredStream.push({ type: 'response.completed', response: { id: 'response-deferred-tool' } })
      deferredStream.close()

      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(0)

      expect(fakeTool.execute).toHaveBeenCalledTimes(1)
      resolveSaveMessages?.({ ok: true, status: 200 })
      await responsePromise
    } finally {
      unregisterClientTool(toolCallId)
      vi.useRealTimers()
    }
  })

  it('persists limited-access review tools after awaiting_tools stages review', async () => {
    const channelId = 'copilot-limited-access-edit-workflow'
    const assistantMessageId = 'assistant-message-limited-edit'
    const reviewSessionId = 'review-limited-edit'
    const store = getCopilotStore(channelId)
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/workflows/wf-limited-edit') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              id: 'wf-limited-edit',
              name: 'Limited edit workflow',
              workspaceId: 'workspace-1',
              state: {
                blocks: {},
                edges: [],
                loops: {},
                parallels: {},
                variables: {},
              },
            },
          }),
        }
      }

      if (url === '/api/copilot/execute-copilot-server-tool') {
        const body = JSON.parse(String(init?.body))
        expect(body.toolName).toBe('edit_workflow')
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
              workflowDocument:
                'flowchart TD\n%% TG_WORKFLOW {"version":"tg-mermaid-v1","direction":"TD"}',
              preview: {
                warnings: [],
              },
            },
          }),
        }
      }

      if (url === '/api/copilot/chat/update-messages') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        }
      }

      if (url === '/api/copilot/usage') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            usage: { usage: 0, percentage: 0, contextWindow: 0, model: 'claude-sonnet-4.6' },
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
      accessLevel: 'limited',
      liveContext: {
        workflowId: 'wf-limited-edit',
        workspaceId: 'workspace-1',
      },
      currentChat: {
        reviewSessionId,
        workspaceId: 'workspace-1',
        channelId,
        entityKind: 'workflow',
        entityId: 'wf-limited-edit',
        draftSessionId: null,
        title: 'Limited edit',
        messages: [],
        messageCount: 0,
        conversationId: 'conversation-limited-edit',
        latestTurnStatus: 'in_progress',
        createdAt: new Date('2026-04-17T00:00:00.000Z'),
        updatedAt: new Date('2026-04-17T00:00:00.000Z'),
      } as any,
      chats: [],
      messages: [
        {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          timestamp: '2026-04-17T00:00:00.000Z',
        },
      ],
      isSendingMessage: true,
      abortController: null,
      toolCallsById: {},
    })

    await store.getState().handleStreamingResponse(
      createSseStream([
        {
          type: 'response.output_item.done',
          item: {
            type: 'function_call',
            call_id: 'edit-workflow-limited-tool',
            name: 'edit_workflow',
            arguments: {
              workflowId: 'wf-limited-edit',
              workflowDocument: 'workflow: {}',
              documentFormat: 'tg-mermaid-v1',
            },
          },
        },
        { type: 'awaiting_tools', data: { pendingToolCallIds: ['edit-workflow-limited-tool'] } },
      ]),
      assistantMessageId
    )

    const updateMessageCalls = fetchMock.mock.calls.filter(([input]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/chat/update-messages'
    })
    const updateMessagesBody = parseJsonRequestBody(updateMessageCalls.at(-1))
    expect(updateMessagesBody.latestTurnStatus).toBe('completed')
    expect((updateMessagesBody.messages as any[])?.[0]?.contentBlocks?.[0]?.toolCall?.state).toBe(
      ClientToolCallState.review
    )
    expect(store.getState().currentChat?.latestTurnStatus).toBe('completed')
    expect(store.getState().toolCallsById['edit-workflow-limited-tool']?.state).toBe(
      ClientToolCallState.review
    )
    expect(store.getState().isSendingMessage).toBe(false)
  })

  it('starts a new generic copilot chat without deleting prior panel history', async () => {
    const channelId = 'copilot-new-chat-scope'
    const store = getCopilotStore(channelId)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/copilot/chat/update-messages') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        }
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      }
    })

    vi.stubGlobal('fetch', fetchMock)

    const scopedChat = {
      reviewSessionId: 'review-scoped-chat',
      workspaceId: 'workspace-1',
      channelId,
      entityKind: 'copilot',
      entityId: null,
      draftSessionId: null,
      title: 'Existing panel-scoped generic copilot chat',
      messages: [],
      messageCount: 0,
      conversationId: null,
      createdAt: new Date('2026-03-30T00:00:00.000Z'),
      updatedAt: new Date('2026-03-30T00:00:00.000Z'),
    }

    store.setState({
      liveContext: {
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      currentChat: scopedChat,
      chats: [scopedChat],
      messages: [
        {
          id: 'user-message',
          role: 'user',
          content: 'Hello',
          timestamp: '2026-03-30T00:00:00.000Z',
        },
      ],
    })

    await store.getState().createNewChat()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/copilot/chat/update-messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          reviewSessionId: 'review-scoped-chat',
          messages: [
            {
              id: 'user-message',
              role: 'user',
              content: 'Hello',
              timestamp: '2026-03-30T00:00:00.000Z',
            },
          ],
          latestTurnStatus: 'completed',
        }),
      })
    )
    expect(store.getState().currentChat).toBeNull()
    expect(store.getState().messages).toEqual([])
    expect(store.getState().chats).toEqual([scopedChat])
    expect(store.getState().suppressAutoSelect).toBe(true)
  })

  it('persists a completed turn when selecting another chat after locally aborting active tools', async () => {
    const channelId = 'copilot-select-chat-aborted-tools'
    const store = getCopilotStore(channelId)
    const nextChat = {
      reviewSessionId: 'review-next-chat',
      workspaceId: 'workspace-1',
      channelId,
      entityKind: 'copilot',
      entityId: null,
      draftSessionId: null,
      latestTurnStatus: 'completed' as const,
      title: 'Next chat',
      messages: [],
      messageCount: 0,
      conversationId: 'conversation-next-chat',
      createdAt: new Date('2026-03-30T00:05:00.000Z'),
      updatedAt: new Date('2026-03-30T00:05:00.000Z'),
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/copilot/chat/update-messages') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        }
      }

      if (url === `/api/copilot/chat?reviewSessionId=${encodeURIComponent(nextChat.reviewSessionId)}`) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, chats: [nextChat] }),
        }
      }

      if (url === '/api/copilot/usage') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ tokensUsed: 10, percentage: 1 }),
        }
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)

    const currentChat = {
      reviewSessionId: 'review-active-chat',
      workspaceId: 'workspace-1',
      channelId,
      entityKind: 'copilot',
      entityId: null,
      draftSessionId: null,
      latestTurnStatus: 'in_progress' as const,
      title: 'Active chat',
      messages: [],
      messageCount: 1,
      conversationId: 'conversation-active-chat',
      createdAt: new Date('2026-03-30T00:00:00.000Z'),
      updatedAt: new Date('2026-03-30T00:00:00.000Z'),
    }

    store.setState({
      liveContext: {
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      currentChat,
      chats: [currentChat, nextChat],
      messages: [
        {
          id: 'assistant-message-active-chat',
          role: 'assistant',
          content: '',
          timestamp: '2026-03-30T00:00:00.000Z',
          toolCalls: [
            {
              id: 'tool-active-chat',
              name: 'edit_indicator',
              state: ClientToolCallState.executing,
              params: { entityDocument: '{}' },
            },
          ],
          contentBlocks: [
            {
              type: 'tool_call',
              timestamp: 1,
              toolCall: {
                id: 'tool-active-chat',
                name: 'edit_indicator',
                state: ClientToolCallState.executing,
                params: { entityDocument: '{}' },
              },
            },
          ],
        },
      ],
      toolCallsById: {
        'tool-active-chat': {
          id: 'tool-active-chat',
          name: 'edit_indicator',
          state: ClientToolCallState.executing,
          params: { entityDocument: '{}' },
        },
      },
    })

    await store.getState().selectChat(nextChat)

    const updateRequest = fetchMock.mock.calls.find(([input]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/chat/update-messages'
    })

    const requestBody = parseJsonRequestBody(updateRequest)
    expect(requestBody).toMatchObject({
      reviewSessionId: 'review-active-chat',
      latestTurnStatus: 'completed',
    })
    expect((requestBody.messages as any[])?.[0]?.toolCalls?.[0]?.state).toBe(
      ClientToolCallState.aborted
    )
    expect((requestBody.messages as any[])?.[0]?.contentBlocks?.[0]?.toolCall?.state).toBe(
      ClientToolCallState.aborted
    )
    expect(
      store.getState().chats.find((chat) => chat.reviewSessionId === 'review-active-chat')
        ?.latestTurnStatus
    ).toBe('completed')
  })

  it('preserves review-state workflow edits when selecting another chat', async () => {
    const channelId = 'copilot-select-chat-review-tools'
    const store = getCopilotStore(channelId)
    const nextChat = {
      reviewSessionId: 'review-next-chat-review-tools',
      workspaceId: 'workspace-1',
      channelId,
      entityKind: 'copilot',
      entityId: null,
      draftSessionId: null,
      latestTurnStatus: 'completed' as const,
      title: 'Next chat',
      messages: [],
      messageCount: 0,
      conversationId: 'conversation-next-chat-review-tools',
      createdAt: new Date('2026-03-30T00:05:00.000Z'),
      updatedAt: new Date('2026-03-30T00:05:00.000Z'),
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/copilot/chat/update-messages') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        }
      }

      if (
        url ===
        `/api/copilot/chat?reviewSessionId=${encodeURIComponent(nextChat.reviewSessionId)}`
      ) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, chats: [nextChat] }),
        }
      }

      if (url === '/api/copilot/usage') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ tokensUsed: 10, percentage: 1 }),
        }
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)

    const currentChat = {
      reviewSessionId: 'review-active-chat-review-tools',
      workspaceId: 'workspace-1',
      channelId,
      entityKind: 'workflow',
      entityId: 'wf-active-chat-review-tools',
      draftSessionId: null,
      latestTurnStatus: 'completed' as const,
      title: 'Workflow edit review chat',
      messages: [],
      messageCount: 1,
      conversationId: 'conversation-active-chat-review-tools',
      createdAt: new Date('2026-03-30T00:00:00.000Z'),
      updatedAt: new Date('2026-03-30T00:00:00.000Z'),
    }

    store.setState({
      accessLevel: 'limited',
      liveContext: {
        workflowId: 'wf-active-chat-review-tools',
        workspaceId: 'workspace-1',
      },
      currentChat,
      chats: [currentChat, nextChat],
      messages: [
        {
          id: 'assistant-message-review-chat',
          role: 'assistant',
          content: '',
          timestamp: '2026-03-30T00:00:00.000Z',
          toolCalls: [
            {
              id: 'tool-review-chat',
              name: 'edit_workflow',
              state: ClientToolCallState.review,
              params: {
                workflowDocument: 'workflow: {}',
                workflowId: 'wf-active-chat-review-tools',
              },
            },
          ],
          contentBlocks: [
            {
              type: 'tool_call',
              timestamp: 1,
              toolCall: {
                id: 'tool-review-chat',
                name: 'edit_workflow',
                state: ClientToolCallState.review,
                params: {
                  workflowDocument: 'workflow: {}',
                  workflowId: 'wf-active-chat-review-tools',
                },
              },
            },
          ],
        },
      ],
      toolCallsById: {
        'tool-review-chat': {
          id: 'tool-review-chat',
          name: 'edit_workflow',
          state: ClientToolCallState.review,
          params: {
            workflowDocument: 'workflow: {}',
            workflowId: 'wf-active-chat-review-tools',
          },
        },
      },
    })

    await store.getState().selectChat(nextChat)

    const updateRequest = fetchMock.mock.calls.find(([input]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/chat/update-messages'
    })

    const requestBody = parseJsonRequestBody(updateRequest)
    expect(requestBody).toMatchObject({
      reviewSessionId: 'review-active-chat-review-tools',
      latestTurnStatus: 'completed',
    })
    expect((requestBody.messages as any[])?.[0]?.toolCalls?.[0]?.state).toBe(
      ClientToolCallState.review
    )
    expect((requestBody.messages as any[])?.[0]?.contentBlocks?.[0]?.toolCall?.state).toBe(
      ClientToolCallState.review
    )
    expect(
      store.getState().chats.find((chat) => chat.reviewSessionId === 'review-active-chat-review-tools')
        ?.latestTurnStatus
    ).toBe('completed')
  })

  it('persists a completed turn when creating a new chat after locally aborting active tools', async () => {
    const channelId = 'copilot-new-chat-aborted-tools'
    const store = getCopilotStore(channelId)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/copilot/chat/update-messages') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        }
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)

    const currentChat = {
      reviewSessionId: 'review-new-chat-abort',
      workspaceId: 'workspace-1',
      channelId,
      entityKind: 'copilot',
      entityId: null,
      draftSessionId: null,
      latestTurnStatus: 'in_progress' as const,
      title: 'Abort before new chat',
      messages: [],
      messageCount: 1,
      conversationId: 'conversation-new-chat-abort',
      createdAt: new Date('2026-03-30T00:00:00.000Z'),
      updatedAt: new Date('2026-03-30T00:00:00.000Z'),
    }

    store.setState({
      liveContext: {
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      currentChat,
      chats: [currentChat],
      messages: [
        {
          id: 'assistant-message-new-chat-abort',
          role: 'assistant',
          content: '',
          timestamp: '2026-03-30T00:00:00.000Z',
          toolCalls: [
            {
              id: 'tool-new-chat-abort',
              name: 'edit_indicator',
              state: ClientToolCallState.pending,
              params: { entityDocument: '{}' },
            },
          ],
          contentBlocks: [
            {
              type: 'tool_call',
              timestamp: 1,
              toolCall: {
                id: 'tool-new-chat-abort',
                name: 'edit_indicator',
                state: ClientToolCallState.pending,
                params: { entityDocument: '{}' },
              },
            },
          ],
        },
      ],
      toolCallsById: {
        'tool-new-chat-abort': {
          id: 'tool-new-chat-abort',
          name: 'edit_indicator',
          state: ClientToolCallState.pending,
          params: { entityDocument: '{}' },
        },
      },
    })

    await store.getState().createNewChat()

    const updateRequest = fetchMock.mock.calls.find(([input]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/chat/update-messages'
    })

    const requestBody = parseJsonRequestBody(updateRequest)
    expect(requestBody).toMatchObject({
      reviewSessionId: 'review-new-chat-abort',
      latestTurnStatus: 'completed',
    })
    expect((requestBody.messages as any[])?.[0]?.toolCalls?.[0]?.state).toBe(
      ClientToolCallState.aborted
    )
    expect((requestBody.messages as any[])?.[0]?.contentBlocks?.[0]?.toolCall?.state).toBe(
      ClientToolCallState.aborted
    )
    expect(store.getState().currentChat).toBeNull()
    expect(store.getState().messages).toEqual([])
    expect(store.getState().toolCallsById).toEqual({})
    expect(store.getState().chats[0]?.latestTurnStatus).toBe('completed')
  })

  it('merges explicit and live implicit contexts before sending a message', async () => {
    const channelId = 'copilot-implicit-contexts'
    const store = getCopilotStore(channelId)
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/copilot/chat') {
        return {
          ok: true,
          status: 200,
          body: createSseStream([{ type: 'response.completed', response: { id: 'response-1' } }]),
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
      liveContext: {
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
      implicitContexts: [
        {
          kind: 'current_workflow',
          workflowId: 'workflow-1',
          label: 'Current Workflow',
        },
        {
          kind: 'current_skill',
          skillId: 'skill-1',
          workspaceId: 'workspace-1',
          label: 'Current Skill',
        },
      ],
    })

    await store.getState().sendMessage('Update the current setup', {
      contexts: [
        {
          kind: 'workflow',
          workflowId: 'workflow-1',
          label: 'Quarterly Review',
        },
      ],
    })

    const sendRequest = fetchMock.mock.calls.find(([input]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/chat'
    })

    const requestBody = parseJsonRequestBody(sendRequest)
    expect(requestBody.provider).toBe('anthropic')
    expect(requestBody.contexts).toEqual([
      {
        kind: 'workflow',
        workflowId: 'workflow-1',
        label: 'Quarterly Review',
      },
      {
        kind: 'current_skill',
        skillId: 'skill-1',
        workspaceId: 'workspace-1',
        label: 'Current Skill',
      },
    ])
  })

  it('keeps the same panel chat while sending the currently viewed workflow as live context', async () => {
    const channelId = 'copilot-panel-switch-context'
    const store = getCopilotStore(channelId)
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/copilot/chat') {
        return {
          ok: true,
          status: 200,
          body: createSseStream([{ type: 'response.completed', response: { id: 'response-2' } }]),
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
      liveContext: {
        workflowId: 'workflow-b',
        workspaceId: 'workspace-1',
      },
      implicitContexts: [
        {
          kind: 'current_workflow',
          workflowId: 'workflow-b',
          label: 'Current Workflow',
        },
      ],
      currentChat: {
        reviewSessionId: 'review-panel-chat-1',
        workspaceId: 'workspace-1',
        channelId,
        entityKind: 'copilot',
        entityId: null,
        draftSessionId: null,
        title: 'Panel chat started on workflow A',
        messages: [],
        messageCount: 0,
        conversationId: 'conversation-panel-chat-1',
        createdAt: new Date('2026-03-30T00:00:00.000Z'),
        updatedAt: new Date('2026-03-30T00:00:00.000Z'),
      },
    })

    await store.getState().sendMessage('Now help me with workflow B')

    const sendRequest = fetchMock.mock.calls.find(([input]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/chat'
    })

    const requestBody = parseJsonRequestBody(sendRequest)
    expect(requestBody.reviewSessionId).toBe('review-panel-chat-1')
    expect(requestBody.channelId).toBe(channelId)
    expect(requestBody.workflowId).toBeUndefined()
    expect(requestBody.provider).toBe('anthropic')
    expect(requestBody.contexts).toEqual([
      {
        kind: 'current_workflow',
        workflowId: 'workflow-b',
        label: 'Current Workflow',
      },
    ])
  })

  it('does not send workflowId when only non-workflow live context is present', async () => {
    const channelId = 'copilot-no-workflow-fallback'
    const store = getCopilotStore(channelId)
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/copilot/chat') {
        return {
          ok: true,
          status: 200,
          body: createSseStream([{ type: 'response.completed', response: { id: 'response-3' } }]),
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
      liveContext: {
        workflowId: null,
        workspaceId: 'workspace-1',
      },
      implicitContexts: [
        {
          kind: 'current_indicator',
          indicatorId: 'indicator-1',
          workspaceId: 'workspace-1',
          label: 'Current Indicator',
        },
      ],
      currentChat: {
        reviewSessionId: 'review-panel-chat-2',
        workspaceId: 'workspace-1',
        channelId,
        entityKind: 'copilot',
        entityId: null,
        draftSessionId: null,
        title: 'Indicator-first chat',
        messages: [],
        messageCount: 0,
        conversationId: 'conversation-panel-chat-2',
        createdAt: new Date('2026-03-30T00:00:00.000Z'),
        updatedAt: new Date('2026-03-30T00:00:00.000Z'),
      },
    })

    await store.getState().sendMessage('Help me inspect this indicator')

    const sendRequest = fetchMock.mock.calls.find(([input]) => {
      const url = typeof input === 'string' ? input : input.toString()
      return url === '/api/copilot/chat'
    })

    const requestBody = parseJsonRequestBody(sendRequest)
    expect(requestBody.workflowId).toBeUndefined()
    expect(requestBody.contexts).toEqual([
      {
        kind: 'current_indicator',
        indicatorId: 'indicator-1',
        workspaceId: 'workspace-1',
        label: 'Current Indicator',
      },
    ])
  })

  it('pins workspace provenance for workspace-only turns', async () => {
    const channelId = 'copilot-workspace-only-provenance'
    const toolCallId = 'copilot-workspace-only-tool'
    const store = getCopilotStore(channelId)
    const deferredStream = createDeferredSseStream()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/copilot/chat') {
        return {
          ok: true,
          status: 200,
          body: deferredStream.stream,
        }
      }

      if (url === '/api/workflows?workspaceId=workspace-1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [] }),
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
      liveContext: {
        workflowId: null,
        workspaceId: 'workspace-1',
      },
      implicitContexts: [],
      currentChat: {
        reviewSessionId: 'review-workspace-only-chat',
        workspaceId: 'workspace-1',
        channelId,
        entityKind: 'copilot',
        entityId: null,
        draftSessionId: null,
        title: 'Workspace-only chat',
        messages: [],
        messageCount: 0,
        conversationId: 'conversation-workspace-only',
        createdAt: new Date('2026-03-30T00:00:00.000Z'),
        updatedAt: new Date('2026-03-30T00:00:00.000Z'),
      },
    })

    const sendPromise = store.getState().sendMessage('List workflows in this workspace')
    await deferredStream.ready

    deferredStream.push({
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        call_id: toolCallId,
        name: 'list_user_workflows',
        arguments: {},
      },
    })
    deferredStream.push({
      type: 'response.completed',
      response: { id: 'response-workspace-only' },
    })
    deferredStream.close()

    await sendPromise

    expect(store.getState().toolCallsById[toolCallId]).toMatchObject({
      provenance: {
        channelId,
        workspaceId: 'workspace-1',
      },
    })
    expect(store.getState().toolCallsById[toolCallId]?.provenance).not.toHaveProperty(
      'workflowId'
    )

    await store.getState().executeCopilotToolCall(toolCallId)

    expect(fetchMock).toHaveBeenCalledWith('/api/workflows?workspaceId=workspace-1', {
      method: 'GET',
    })
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
      liveContext: {
        workflowId: 'wf-stream-title',
        workspaceId: 'workspace-1',
      },
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
        {
          type: 'response.output_item.added',
          item: {
            id: 'assistant-title-item',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '' }],
          },
        },
        {
          type: 'response.output_text.delta',
          item_id: 'assistant-title-item',
          delta: 'Done.',
        },
        { type: 'title_updated', title: 'Momentum Screener' },
        {
          type: 'response.output_item.done',
          item: {
            id: 'assistant-title-item',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Done.' }],
          },
        },
        { type: 'response.completed', response: { id: 'response-title' } },
      ]),
      'assistant-message'
    )

    expect(store.getState().currentChat?.title).toBe('Momentum Screener')
    expect(store.getState().chats[0]?.title).toBe('Momentum Screener')
  })

  it('preserves pending tool states but aborts stale in-flight tool states when reloading chats', async () => {
    const channelId = 'copilot-tool-state-reload'
    const store = getCopilotStore(channelId)

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (!url.includes(`/api/copilot/chat?channelId=${channelId}`)) {
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
                latestTurnStatus: 'completed',
                title: 'Reloaded chat',
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
                          name: 'edit_skill',
                          state: ClientToolCallState.pending,
                          params: { entityDocument: '{}' },
                        },
                      },
                      {
                        type: 'tool_call',
                        timestamp: 2,
                        toolCall: {
                          id: 'executing-tool',
                          name: 'edit_indicator',
                          state: ClientToolCallState.executing,
                          params: { entityDocument: '{}' },
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
      liveContext: {
        workflowId: 'wf-reload',
        workspaceId: 'workspace-1',
      },
      currentChat: null,
      chats: [],
      messages: [],
      toolCallsById: {},
      isLoadingChats: false,
      isSendingMessage: false,
      abortController: null,
      chatsLoadedForScope: null,
      chatsLastLoadedAt: null,
      suppressAutoSelect: false,
    })

    await store.getState().loadChats(true)

    const pendingBlock = store.getState().messages[0]?.contentBlocks?.[0] as any
    const executingBlock = store.getState().messages[0]?.contentBlocks?.[1] as any

    expect(pendingBlock?.toolCall?.state).toBe(ClientToolCallState.pending)
    expect(executingBlock?.toolCall?.state).toBe(ClientToolCallState.aborted)
    expect(store.getState().toolCallsById['pending-tool']?.state).toBe(
      ClientToolCallState.pending
    )
    expect(store.getState().toolCallsById['executing-tool']?.state).toBe(
      ClientToolCallState.aborted
    )
  })

  it('preserves running tool state and rehydrates the chat as active when the latest turn is still in progress', async () => {
    const channelId = 'copilot-tool-state-reload-active-turn'
    const store = getCopilotStore(channelId)

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (!url.includes(`/api/copilot/chat?channelId=${channelId}`)) {
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
                reviewSessionId: 'review-reload-active',
                workspaceId: 'workspace-1',
                channelId,
                entityKind: 'copilot',
                entityId: null,
                draftSessionId: null,
                latestTurnStatus: 'in_progress',
                title: 'Reloaded active chat',
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
                          id: 'executing-tool',
                          name: 'edit_indicator',
                          state: ClientToolCallState.executing,
                          params: { entityDocument: '{}' },
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
      liveContext: {
        workflowId: 'wf-reload',
        workspaceId: 'workspace-1',
      },
      currentChat: null,
      chats: [],
      messages: [],
      toolCallsById: {},
      isLoadingChats: false,
      isSendingMessage: false,
      abortController: null,
      chatsLoadedForScope: null,
      chatsLastLoadedAt: null,
      suppressAutoSelect: false,
    })

    await store.getState().loadChats(true, { workspaceId: 'workspace-1' })

    const executingBlock = store.getState().messages[0]?.contentBlocks?.[0] as any

    expect(executingBlock?.toolCall?.state).toBe(ClientToolCallState.executing)
    expect(store.getState().toolCallsById['executing-tool']?.state).toBe(
      ClientToolCallState.executing
    )
    expect(store.getState().isSendingMessage).toBe(true)
  })

  it('restores stale limited-access workflow edits as review on reload', async () => {
    const channelId = 'copilot-tool-state-reload-edit-workflow-review'
    const store = getCopilotStore(channelId)

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (!url.includes(`/api/copilot/chat?channelId=${channelId}`)) {
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
                reviewSessionId: 'review-reload-edit-workflow',
                workspaceId: 'workspace-1',
                channelId,
                entityKind: 'workflow',
                entityId: 'wf-reload-edit-workflow',
                draftSessionId: null,
                latestTurnStatus: 'completed',
                title: 'Reloaded workflow edit',
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
                          id: 'edit-workflow-tool',
                          name: 'edit_workflow',
                          state: ClientToolCallState.executing,
                          params: {
                            workflowDocument: 'workflow: {}',
                            workflowId: 'wf-reload-edit-workflow',
                          },
                          result: {
                            workflowId: 'wf-reload-edit-workflow',
                            workflowState: {
                              blocks: {},
                              edges: [],
                              loops: {},
                              parallels: {},
                            },
                          },
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
      accessLevel: 'limited',
      liveContext: {
        workflowId: 'wf-reload-edit-workflow',
        workspaceId: 'workspace-1',
      },
      currentChat: null,
      chats: [],
      messages: [],
      toolCallsById: {},
      isLoadingChats: false,
      isSendingMessage: false,
      abortController: null,
      chatsLoadedForScope: null,
      chatsLastLoadedAt: null,
      suppressAutoSelect: false,
    })

    await store.getState().loadChats(true)

    const toolBlock = store.getState().messages[0]?.contentBlocks?.[0] as any

    expect(toolBlock?.toolCall?.state).toBe(ClientToolCallState.review)
    expect(store.getState().toolCallsById['edit-workflow-tool']?.state).toBe(
      ClientToolCallState.review
    )
    expect(store.getState().isSendingMessage).toBe(false)
  })

  it('loads generic chats with an explicit workspace scope even before live context is hydrated', async () => {
    const channelId = 'copilot-workspace-scoped-history'
    const store = getCopilotStore(channelId)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (!url.startsWith('/api/copilot/chat?')) {
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
          chats: [],
        }),
      }
    })

    vi.stubGlobal('fetch', fetchMock)

    store.setState({
      liveContext: {
        workflowId: 'wf-scoped-history',
        workspaceId: null,
      },
      currentChat: null,
      chats: [],
      messages: [],
      toolCallsById: {},
      isLoadingChats: false,
      isSendingMessage: false,
      abortController: null,
      chatsLoadedForScope: null,
      chatsLastLoadedAt: null,
      suppressAutoSelect: false,
    })

    await store.getState().loadChats(true, { workspaceId: 'workspace-1' })

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/copilot/chat?channelId=${encodeURIComponent(channelId)}&workspaceId=${encodeURIComponent(
        'workspace-1'
      )}`
    )
    expect(store.getState().chatsLoadedForScope).toBe(`workspace-1:${channelId}`)
  })
})

describe('copilot context usage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches context usage for a generic chat without workflow context', async () => {
    const channelId = 'copilot-context-usage-generic'
    const store = getCopilotStore(channelId)
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/copilot/usage') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tokensUsed: 1234,
            percentage: 0.96,
            model: 'claude-sonnet-4.6',
            contextWindow: 128000,
            when: 'end',
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
      currentChat: {
        reviewSessionId: 'review-context-usage-generic',
        workspaceId: null,
        channelId,
        entityKind: 'copilot',
        entityId: null,
        draftSessionId: null,
        title: 'Generic chat',
        messages: [],
        messageCount: 0,
        conversationId: 'conversation-context-usage-generic',
        createdAt: new Date('2026-04-05T00:00:00.000Z'),
        updatedAt: new Date('2026-04-05T00:00:00.000Z'),
      },
      liveContext: {
        workflowId: null,
        workspaceId: null,
      },
      selectedModel: 'claude-sonnet-4.6',
      contextUsage: null,
    })

    await store.getState().fetchContextUsage()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/copilot/usage',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const requestBody = parseJsonRequestBody(fetchMock.mock.calls[0])
    expect(requestBody).toEqual({
      kind: 'context',
      conversationId: 'conversation-context-usage-generic',
      model: 'claude-sonnet-4.6',
      provider: 'anthropic',
    })
    expect(store.getState().contextUsage).toEqual({
      usage: 1234,
      percentage: 0.96,
      model: 'claude-sonnet-4.6',
      contextWindow: 128000,
      when: 'end',
      estimatedTokens: 1234,
    })
  })
})

describe('copilot tool user action delegation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('delegates pending tool execution to the client tool user-action handler', async () => {
    const channelId = 'copilot-edit-workflow-order'
    const toolCallId = 'edit-workflow-order-tool'
    const store = getCopilotStore(channelId)
    const calls: string[] = []
    const fakeTool = {
      setExecutionContext: vi.fn(),
      handleUserAction: vi.fn(async () => {
        calls.push('userAction')
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
      liveContext: {
        workflowId: 'wf-edit-workflow-order',
        workspaceId: 'workspace-1',
      },
      currentChat: {
        reviewSessionId: 'review-edit-workflow-order',
        workspaceId: null,
        channelId: null,
        entityKind: 'workflow',
        entityId: 'wf-edit-workflow-order',
        draftSessionId: null,
        title: null,
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
            workflowDocument:
              'flowchart TD\n%% TG_WORKFLOW {"version":"tg-mermaid-v1","direction":"TD"}',
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

    expect(calls).toEqual(['userAction'])
    expect(store.getState().isSendingMessage).toBe(true)

    unregisterClientTool(toolCallId)
  })

  it('delegates review-state tool execution to the same client tool user-action handler', async () => {
    const channelId = 'copilot-edit-workflow-review'
    const toolCallId = 'edit-workflow-review-tool'
    const store = getCopilotStore(channelId)
    const calls: string[] = []
    const fakeTool = {
      setExecutionContext: vi.fn(),
      handleUserAction: vi.fn(async () => {
        calls.push('userAction')
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
      liveContext: {
        workflowId: 'wf-edit-workflow-review',
        workspaceId: 'workspace-1',
      },
      currentChat: {
        reviewSessionId: 'review-edit-workflow-review',
        workspaceId: null,
        channelId: null,
        entityKind: 'workflow',
        entityId: 'wf-edit-workflow-review',
        draftSessionId: null,
        title: null,
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
            workflowDocument:
              'flowchart TD\n%% TG_WORKFLOW {"version":"tg-mermaid-v1","direction":"TD"}',
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

    expect(calls).toEqual(['userAction'])

    unregisterClientTool(toolCallId)
  })

  it('auto-executes pending reviewed API tools when access switches to full', async () => {
    vi.useFakeTimers()
    try {
      const channelId = 'copilot-api-request-access-switch'
      const toolCallId = 'make-api-request-pending-tool'
      const store = getCopilotStore(channelId)
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url === '/api/copilot/execute-copilot-server-tool') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              result: {
                data: 'ok',
                status: 200,
                headers: {},
              },
            }),
          }
        }

        if (url === '/api/copilot/tools/mark-complete') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, continued: true }),
          }
        }

        throw new Error(`Unexpected fetch: ${url} ${init?.method || 'GET'}`)
      })

      vi.stubGlobal('fetch', fetchMock)

      store.setState({
        accessLevel: 'limited',
        liveContext: {
          workflowId: 'wf-api-request-access-switch',
          workspaceId: 'workspace-1',
        },
        toolCallsById: {
          [toolCallId]: {
            id: toolCallId,
            name: 'make_api_request',
            state: ClientToolCallState.pending,
            params: {
              url: 'https://example.com/data',
              method: 'GET',
            },
            provenance: {
              channelId,
              contextWorkflowId: 'wf-api-request-access-switch',
              workspaceId: 'workspace-1',
            },
          } as any,
        },
      })

      store.getState().setAccessLevel('full')
      await vi.runAllTimersAsync()

      const executeRequest = fetchMock.mock.calls.find(([input]) => {
        const url = typeof input === 'string' ? input : input.toString()
        return url === '/api/copilot/execute-copilot-server-tool'
      })
      expect(parseJsonRequestBody(executeRequest)).toEqual({
        toolName: 'make_api_request',
        payload: {
          url: 'https://example.com/data',
          method: 'GET',
        },
        context: {
          contextWorkflowId: 'wf-api-request-access-switch',
        },
      })
      expect(store.getState().toolCallsById[toolCallId]?.state).toBe(
        ClientToolCallState.success
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('refreshes environment variables after server-managed environment updates', async () => {
    const channelId = 'copilot-env-refresh'
    const toolCallId = 'set-env-tool'
    const store = getCopilotStore(channelId)
    const originalLoadEnvironmentVariables =
      useEnvironmentStore.getState().loadEnvironmentVariables
    const loadEnvironmentVariables = vi.fn(async () => {})
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/copilot/execute-copilot-server-tool') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            result: { message: 'ok' },
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

      throw new Error(`Unexpected fetch: ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)
    useEnvironmentStore.setState({ loadEnvironmentVariables } as any)

    try {
      store.setState({
        accessLevel: 'full',
        toolCallsById: {
          [toolCallId]: {
            id: toolCallId,
            name: 'set_environment_variables',
            state: ClientToolCallState.pending,
            params: { variables: { API_KEY: 'secret' } },
            provenance: {
              channelId,
              workflowId: 'workflow-1',
              workspaceId: 'workspace-1',
            },
          } as any,
        },
      })

      await store.getState().executeCopilotToolCall(toolCallId)

      expect(loadEnvironmentVariables).toHaveBeenCalledTimes(1)
      expect(store.getState().toolCallsById[toolCallId]?.state).toBe(ClientToolCallState.success)
    } finally {
      useEnvironmentStore.setState({
        loadEnvironmentVariables: originalLoadEnvironmentVariables,
      } as any)
    }
  })

  it('auto-executes review-state client tools when access switches to full', async () => {
    vi.useFakeTimers()
    try {
      const channelId = 'copilot-review-access-switch'
      const toolCallId = 'edit-workflow-access-switch-tool'
      const store = getCopilotStore(channelId)
      const calls: string[] = []
      const fakeTool = {
        setExecutionContext: vi.fn(),
        handleUserAction: vi.fn(async () => {
          calls.push('userAction')
        }),
        execute: vi.fn(async () => {
          calls.push('execute')
        }),
        handleAccept: vi.fn(async () => {
          calls.push('accept')
        }),
      }

      registerClientTool(toolCallId, fakeTool)

      store.setState({
        accessLevel: 'limited',
        liveContext: {
          workflowId: 'wf-review-access-switch',
          workspaceId: 'workspace-1',
        },
        currentChat: {
          reviewSessionId: 'review-access-switch',
          workspaceId: null,
          channelId: null,
          entityKind: 'workflow',
          entityId: 'wf-review-access-switch',
          draftSessionId: null,
          title: null,
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
              workflowDocument:
                'flowchart TD\n%% TG_WORKFLOW {"version":"tg-mermaid-v1","direction":"TD"}',
              workflowId: 'wf-review-access-switch',
            },
            provenance: {
              channelId,
              workflowId: 'wf-review-access-switch',
              reviewSessionId: 'review-access-switch',
              entityKind: 'workflow',
              entityId: 'wf-review-access-switch',
              workspaceId: 'workspace-1',
            },
          } as any,
        },
      })

      store.getState().setAccessLevel('full')
      await vi.runAllTimersAsync()

      expect(calls).toEqual(['userAction'])

      unregisterClientTool(toolCallId)
    } finally {
      vi.useRealTimers()
    }
  })
})
