/** @vitest-environment jsdom */
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CopilotEvent } from '@/lib/copilot/native/contract'
import { buildCopilotWorkspaceChannelId } from '@/stores/copilot/channel-id'
import {
  CopilotStoreProvider,
  getCopilotStore,
  resetCopilotStoreRegistry,
  useCopilotStore,
} from '@/stores/copilot/store'
import { CopilotMessage } from './copilot-message'

const runtimeContext = { workspaceId: 'workspace-fixture', implicitContexts: [] }
const channelId = buildCopilotWorkspaceChannelId({
  authenticatedUserId: 'actor-fixture',
  workspaceId: runtimeContext.workspaceId,
})
const onEditModeChange = () => {}
function Messages() {
  const { messages, isSendingMessage } = useCopilotStore()
  return messages.map((message) => (
    <CopilotMessage
      key={message.id}
      message={message}
      runtimeContext={runtimeContext}
      isStreaming={isSendingMessage && message.role === 'assistant'}
      panelWidth={400}
      isDimmed={false}
      onEditModeChange={onEditModeChange}
    />
  ))
}

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  flushSync(() =>
    root.render(
      <CopilotStoreProvider channelId={channelId}>
        <Messages />
      </CopilotStoreProvider>
    )
  )
})
afterEach(() => {
  flushSync(() => root.unmount())
  container.remove()
  resetCopilotStoreRegistry()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it.each(['text.delta', 'reasoning.delta'] as const)(
  'completes buffered %s events without recursive React updates',
  async (type) => {
    const error = vi.spyOn(console, 'error')
    const store = getCopilotStore(channelId)
    const threadId = 'thread-fixture'
    const runId = 'run-fixture'
    store.setState({
      selectedModel: 'openai/test-model',
      currentChat: {
        threadId,
        workspaceId: runtimeContext.workspaceId,
        title: 'Existing',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      conversationWorkspaceId: runtimeContext.workspaceId,
    })
    const text = type === 'text.delta' ? 'word '.repeat(150) : 'Completed answer'
    const result = { status: 'completed' as const, threadId, runId, text }
    const events: CopilotEvent[] = [
      { type: 'response.started', runId, threadId },
      ...Array.from({ length: 150 }, () => ({ type, text: 'word ' })),
      { type: 'response.completed', result },
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const command = JSON.parse(String(init?.body))
        if (command.command === 'history.read')
          return Response.json({
            status: 'history',
            pending: [],
            threadId,
            items: [
              {
                id: 'saved-answer',
                role: 'assistant',
                createdAt: new Date().toISOString(),
                parts: [{ type: 'text', text }],
              },
            ],
          })
        expect(command.command).toBe('message')
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
                )
              )
              controller.close()
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } }
        )
      })
    )

    // Keep native scheduling: act() batches this burst and masks the update-depth failure.
    const success = await store.getState().sendMessage('Hello', { runtimeContext })
    expect(store.getState().error).toBeNull()
    expect(store.getState().historyRefreshError).toBeNull()
    expect(success).toBe(true)
    await vi.waitFor(() => expect(container.textContent).toContain(text.trim()))
    expect(
      error.mock.calls.filter((args) => String(args).includes('Maximum update depth'))
    ).toEqual([])
  }
)

it('restores answer controls when a still-typing text segment is replaced', async () => {
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1)
  )
  const cancel = vi.fn()
  vi.stubGlobal('cancelAnimationFrame', cancel)
  const store = getCopilotStore(channelId)
  const replace = (text: string, timestamp: number) =>
    flushSync(() =>
      store.setState({
        messages: [
          {
            id: 'same-answer',
            role: 'assistant',
            timestamp: new Date().toISOString(),
            content: `${text}<options>{"1":"Continue"}</options>`,
            contentBlocks: [{ type: 'text', content: text, timestamp }],
          },
        ],
      })
    )
  replace('Initial', 1)
  expect(container.querySelector('button')?.textContent).toContain('Continue')
  replace('Initial unfinished text', 1)
  await vi.waitFor(() => expect(container.querySelector('button')).toBeNull())
  replace('Final answer', 2)
  await vi.waitFor(() =>
    expect(container.querySelector('button')?.textContent).toContain('Continue')
  )
  expect(container.textContent).toContain('Final answer')
  expect(cancel).toHaveBeenCalledWith(1)
})
