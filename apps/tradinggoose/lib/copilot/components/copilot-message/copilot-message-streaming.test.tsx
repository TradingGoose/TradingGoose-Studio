/** @vitest-environment jsdom */
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CopilotThreadEvent, HistoryResponse } from '@/lib/copilot/native/contract'
import { buildCopilotWorkspaceChannelId } from '@/stores/copilot/channel-id'
import { projectNativeHistory } from '@/stores/copilot/history'
import {
  CopilotStoreProvider,
  getCopilotStore,
  resetCopilotStoreRegistry,
  useCopilotStore,
} from '@/stores/copilot/store'
import { createStreamingMessage } from '@/stores/copilot/store-messages'
import { appendNativeText } from '@/stores/copilot/streaming'
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
      isLastMessage={message.id === messages.at(-1)?.id}
      isLastUserMessage={message.id === messages.filter((item) => item.role === 'user').at(-1)?.id}
      isTurnInProgress={isSendingMessage}
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
    const history: HistoryResponse = {
      status: 'history',
      pending: [],
      threadId,
      items: [
        {
          id: 'saved-answer',
          role: 'assistant',
          runId,
          createdAt: new Date().toISOString(),
          parts: [{ type: 'text', text }],
        },
      ],
    }
    const events: CopilotThreadEvent[] = [
      { type: 'thread.history', activeRunId: runId, result: { ...history, items: [] } },
      { type: 'thread.started', runId, messageId: 'saved-answer' },
      ...Array.from(
        { length: 150 },
        (): CopilotThreadEvent => ({ type: 'thread.output', runId, event: { type, text: 'word ' } })
      ),
      { type: 'thread.status', runId, status: 'success', history },
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const command = JSON.parse(String(init?.body))
        expect(['message', 'thread.observe']).toContain(command.command)
        if (command.command === 'message')
          return Response.json(
            { status: 'accepted', threadId, runId, messageId: 'saved-user' },
            { status: 202 }
          )
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
    expect(success).toBe(true)
    await vi.waitFor(() => expect(container.textContent).toContain(text.trim()))
    expect(
      error.mock.calls.filter((args) => String(args).includes('Maximum update depth'))
    ).toEqual([])
  }
)

it('shows the active wait indicator without allocating rows for empty saved replies', () => {
  const store = getCopilotStore(channelId)
  const saved = projectNativeHistory([
    {
      id: 'empty-saved-answer',
      role: 'assistant',
      createdAt: new Date().toISOString(),
      parts: [{ type: 'text', text: '' }],
    },
  ])
  const current = createStreamingMessage()
  flushSync(() => store.setState({ messages: [...saved, current], isSendingMessage: true }))
  expect(container.children).toHaveLength(1)
  expect(container.querySelector('.animate-bounce')).toBeTruthy()

  const answer = appendNativeText(current, 'text', 'Here is the answer.')
  flushSync(() => store.setState({ messages: [...saved, answer], isSendingMessage: false }))
  expect(container.children).toHaveLength(1)
  expect(container).toHaveTextContent('Here is the answer.')
  expect(container.querySelector('.animate-bounce')).toBeNull()
  expect(store.getState().messages.map((item) => item.id)).toEqual([saved[0].id, current.id])

  flushSync(() =>
    store.setState({ messages: [{ ...saved[0], usage: { outputTokens: 0 } }, answer] })
  )
  expect(container.children).toHaveLength(2)
  expect(
    container.firstElementChild?.querySelector('[data-testid="message-usage"]')
  ).toHaveTextContent('0')
})

it('lets Markdown lay out streamed paragraphs and lists while preserving explicit breaks and code', () => {
  const current = createStreamingMessage()
  const text = 'First.  \nNext line.\n\n- One\n- Two\n\n```txt\n  indented\n```'
  flushSync(() =>
    getCopilotStore(channelId).setState({
      messages: [appendNativeText(current, 'text', text)],
      isSendingMessage: true,
    })
  )
  const paragraph = container.querySelector('p')!
  expect(paragraph.querySelector('br')).toBeTruthy()
  expect(container.querySelectorAll('li')).toHaveLength(2)
  expect(container.querySelector('pre')?.textContent).toContain('  indented')
  expect(paragraph.closest('.whitespace-pre-wrap')).toBeNull()
})

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
  replace('', 3)
  expect(container.querySelector('button')).toHaveTextContent('Continue')
})
