/**
 * @vitest-environment jsdom
 */

import { act, Profiler } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CopilotModelOption } from '@/lib/copilot/settings'
import { getReasoningOptions } from '@/lib/mastra/native-reasoning'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
  ResizeObserver?: typeof ResizeObserver
}

let mockStoreState: any
let mockUserInputProps: any
let mockModels: CopilotModelOption[]
const scrollToMock = vi.fn()

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}))

vi.mock('@/components/ui/loading-agent', () => ({
  LoadingAgent: () => <div data-testid='loading-agent' />,
}))

vi.mock('@/components/ui/scroll-area', async () => {
  const React = await import('react')

  const ScrollArea = React.forwardRef<HTMLDivElement, any>(
    ({ children, className, viewportClassName }, ref) => (
      <div ref={ref} className={className}>
        <div data-slot='scroll-area-viewport' className={viewportClassName}>
          {children}
        </div>
      </div>
    )
  )

  ScrollArea.displayName = 'ScrollArea'

  return { ScrollArea }
})

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('@/hooks/queries/copilot-models', () => ({
  useCopilotModels: () => ({ data: { models: mockModels } }),
}))

vi.mock('@/stores/copilot/store', () => ({
  useCopilotStore: (selector = (state: any) => state) => selector(mockStoreState),
  useCopilotStoreApi: () => ({ getState: () => mockStoreState }),
}))

vi.mock('../copilot-message/copilot-message', () => ({
  CopilotMessage: ({ message, runtimeContext: _runtimeContext }: any) => (
    <div data-testid={`message-${message.id}`}>{message.id}</div>
  ),
}))

vi.mock('../todo-list/todo-list', () => ({
  TodoList: () => <div data-testid='todo-list'>todos</div>,
}))

vi.mock('../welcome/welcome', () => ({
  CopilotWelcome: () => <div data-testid='copilot-welcome'>welcome</div>,
}))

vi.mock('../user-input/user-input', async () => {
  const React = await import('react')

  const UserInput = React.forwardRef((props: any, _ref: any) => {
    mockUserInputProps = props
    return <div data-testid='user-input' />
  })
  UserInput.displayName = 'UserInput'

  return {
    UserInput,
  }
})

import { Copilot, shouldMarkUserScrolledDuringStream } from './copilot'
import { CopilotHeader } from './copilot-header'

function createAssistantMessage(overrides?: Partial<any>) {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    timestamp: '2026-04-17T00:00:00.000Z',
    contentBlocks: [
      {
        type: 'text' as const,
        content: 'Working through the request.',
        timestamp: 1,
      },
    ],
    ...overrides,
  }
}

function configureViewportScrollMetrics(viewport: Element, scrollTop = 450) {
  let scrollTopValue = scrollTop

  Object.defineProperty(viewport, 'scrollTop', {
    configurable: true,
    get: () => scrollTopValue,
    set: (value) => {
      scrollTopValue = value
    },
  })
  Object.defineProperty(viewport, 'scrollHeight', {
    configurable: true,
    get: () => 800,
  })
  Object.defineProperty(viewport, 'clientHeight', {
    configurable: true,
    get: () => 200,
  })
}

describe('Copilot auto-scroll', () => {
  let container: HTMLDivElement
  let root: Root
  const originalScrollTo = HTMLElement.prototype.scrollTo

  const renderCopilot = async () => {
    await act(async () => {
      root.render(<Copilot workspaceId='ws-1' panelWidth={360} currentContext={null} />)
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    scrollToMock.mockReset()
    mockUserInputProps = null
    mockModels = [{ id: 'openai/gpt-4o', label: 'openai/gpt-4o' }]
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: scrollToMock,
    })
    reactActEnvironment.ResizeObserver = class {
      observe() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    mockStoreState = {
      conversationWorkspaceId: 'ws-1',
      chatsWorkspaceId: 'ws-1',
      chats: [],
      messages: [createAssistantMessage()],
      isSendingMessage: true,
      isAwaitingContinuation: false,
      isAborting: false,
      accessLevel: 'full',
      draft: { text: '', contexts: [] },
      sendMessage: vi.fn(),
      abortMessage: vi.fn(),
      setDraft: vi.fn(),
      loadChats: vi.fn(async () => {}),
      selectedModel: mockModels[0].id,
      toolCallsById: {},
    }
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: originalScrollTo,
    })
    vi.useRealTimers()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('keeps saved messages visible during refresh and offers a scoped history retry', async () => {
    let finish!: () => void
    mockStoreState.loadChats.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve
      })
    )
    await renderCopilot()
    expect(container.querySelector('[data-testid="message-assistant-1"]')).toBeInTheDocument()
    mockStoreState.historyError = 'HTTP 503'
    await act(async () => finish())
    await renderCopilot()
    expect(container.querySelector('[role="alert"]')).toHaveTextContent('HTTP 503')
    expect(container.querySelector('[data-testid="message-assistant-1"]')).toBeInTheDocument()
    act(() => container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click())
    expect(mockStoreState.loadChats).toHaveBeenLastCalledWith({ workspaceId: 'ws-1' })
    mockStoreState.messages = []
    mockStoreState.isSendingMessage = false
    await renderCopilot()
    expect(container.querySelector('[data-testid="copilot-welcome"]')).toBeNull()
    mockStoreState.historyError = null
    await renderCopilot()
    expect(container.querySelector('[data-testid="copilot-welcome"]')).toBeInTheDocument()
  })

  it('distinguishes an unsuccessful list from empty history and keeps scoped rows through retry', async () => {
    const renderHeader = async () => {
      await act(async () => root.render(<CopilotHeader workspaceId='ws-1' />))
    }
    const chat = {
      threadId: 'thread',
      title: 'Existing chat',
      updatedAt: new Date(),
      workspaceId: 'ws-1',
    }
    mockStoreState.chatsError = 'HTTP 500'
    await renderHeader()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Open chat history"]')!.click()
    )
    const menu = () => document.querySelector('[role="menu"]')!
    expect(menu()).toHaveTextContent('HTTP 500')
    expect(menu()).not.toHaveTextContent('No chats yet')
    mockStoreState.chats = [chat]
    await renderHeader()
    expect(menu()).toHaveTextContent('Existing chat')
    const retry = [...menu().querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === 'Retry'
    )!
    await act(async () => retry.click())
    expect(mockStoreState.loadChats).toHaveBeenLastCalledWith({ workspaceId: 'ws-1' })
    mockStoreState.isLoadingChats = true
    mockStoreState.chatsError = null
    await renderHeader()
    expect(menu()).toHaveTextContent('Existing chat')
    mockStoreState.isLoadingChats = false
    mockStoreState.chats = []
    await renderHeader()
    expect(menu()).toHaveTextContent('No chats yet')
  })

  it('shows recent chat titles and opens an older conversation only after selection', async () => {
    const chats = Array.from({ length: 45 }, (_, i) => ({
      threadId: String(i),
      title: `Chat ${i}`,
      workspaceId: 'ws-1',
      updatedAt: new Date(i * 1000),
    }))
    mockStoreState.chats = chats
    mockStoreState.selectChat = vi.fn()
    await act(async () => root.render(<CopilotHeader workspaceId='ws-1' />))
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Open chat history"]')!.click()
    )
    const items = () => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    expect(items()).toHaveLength(41)
    expect(items()[0]).toHaveTextContent('Chat 44')
    expect(items().at(-1)).toHaveTextContent('Show older chats')
    await act(async () => items().at(-1)!.click())
    expect(items()).toHaveLength(45)
    expect(mockStoreState.selectChat).not.toHaveBeenCalled()
    await act(async () => items().at(-1)!.click())
    expect(mockStoreState.selectChat).toHaveBeenCalledExactlyOnceWith(chats[0])
  })

  it('does not render previous workspace messages, history rows, titles or errors on a scope change', async () => {
    const chat = {
      threadId: 'a',
      title: 'Workspace A chat',
      updatedAt: new Date(),
      workspaceId: 'ws-1',
    }
    Object.assign(mockStoreState, {
      currentChat: chat,
      chats: [chat],
      historyError: 'Workspace A failure',
    })
    const commits: string[] = []
    const renderWorkspace = async (workspaceId: string) => {
      await act(async () =>
        root.render(
          <Profiler
            id='copilot'
            onRender={() => {
              commits.push(document.body.textContent ?? '')
            }}
          >
            <CopilotHeader workspaceId={workspaceId} />
            <Copilot workspaceId={workspaceId} panelWidth={360} currentContext={null} />
          </Profiler>
        )
      )
    }
    await renderWorkspace('ws-1')
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Open chat history"]')!.click()
    )
    expect(document.querySelector('[role="menu"]')).toHaveTextContent('Workspace A chat')
    expect(container).toHaveTextContent('assistant-1')
    commits.length = 0
    await renderWorkspace('ws-2')
    expect(commits.length).toBeGreaterThan(0)
    for (const text of commits) expect(text).not.toMatch(/Workspace A|assistant-1/)
    expect(mockStoreState.loadChats).toHaveBeenLastCalledWith({ workspaceId: 'ws-2' })
  })

  it.each([
    ['openai/gpt-5', undefined, true],
    ['openai/gpt-5', { type: 'effort', value: 'invented' }, true],
    ['openai/gpt-5', { type: 'effort', value: 'high' }, false],
    ['google/gemini-2.5-pro', undefined, true],
    ['google/gemini-2.5-flash', undefined, true],
    ['google/gemini-2.5-flash', { type: 'effort', value: 'low' }, false],
    ['openai/gpt-4o', undefined, false],
    ['openai/gpt-4o', { type: 'effort', value: 'high' }, true],
  ] as const)(
    'validates the published controls for %s with %j',
    async (id, reasoning, disabled) => {
      mockModels = [
        {
          id,
          label: id,
          reasoningOptions: getReasoningOptions(id),
        },
      ]
      mockStoreState.selectedModel = id
      mockStoreState.reasoning = reasoning
      mockStoreState.isSendingMessage = false
      await renderCopilot()
      expect(mockUserInputProps.submitDisabled).toBe(disabled)
      await mockUserInputProps.onSubmit('Hello')
      expect(mockStoreState.sendMessage).toHaveBeenCalledTimes(disabled ? 0 : 1)
    }
  )

  it('forwards submission acceptance without waiting for the streaming response to finish', async () => {
    mockStoreState.isSendingMessage = false
    let finish!: (completed: boolean) => void
    mockStoreState.sendMessage.mockReturnValue(
      new Promise<boolean>((resolve) => {
        finish = resolve
      })
    )
    await renderCopilot()
    const onAccepted = vi.fn()
    const onCompleted = vi.fn()
    const sending = mockUserInputProps.onSubmit('Hello', [], [], onAccepted).then(onCompleted)

    mockStoreState.sendMessage.mock.calls[0][1].onAccepted()
    expect(onAccepted).toHaveBeenCalledOnce()
    expect(onCompleted).not.toHaveBeenCalled()

    finish(true)
    await sending
    expect(onCompleted).toHaveBeenCalledWith(true)
  })

  it('keeps Stop available while an unacknowledged text-only run awaits cancellation', async () => {
    mockStoreState = {
      ...mockStoreState,
      isSendingMessage: false,
      isAwaitingContinuation: true,
      error: 'Try Stop again',
    }
    await renderCopilot()
    expect(mockUserInputProps.isLoading).toBe(true)
    expect(mockUserInputProps.isAborting).toBe(false)
    expect(mockUserInputProps.onAbort).toBe(mockStoreState.abortMessage)
  })

  it('keeps auto-scroll active when an in-flight programmatic scroll emits scroll events', async () => {
    await renderCopilot()

    const viewport = container.querySelector('[data-slot="scroll-area-viewport"]')
    expect(viewport).not.toBeNull()

    configureViewportScrollMetrics(viewport!)
    scrollToMock.mockClear()

    await act(async () => {
      viewport!.dispatchEvent(new Event('scroll'))
      await Promise.resolve()
    })

    mockStoreState = {
      ...mockStoreState,
      messages: [
        createAssistantMessage({
          contentBlocks: [
            ...mockStoreState.messages[0].contentBlocks,
            {
              type: 'tool_call' as const,
              toolCall: {
                id: 'tool-1',
                name: 'search_online',
                state: 'pending',
              },
              timestamp: 2,
            },
          ],
        }),
      ],
    }

    await renderCopilot()

    expect(scrollToMock).toHaveBeenCalled()
  })

  it('shows acknowledged plan results during a turn and hides them when the turn ends', async () => {
    mockStoreState = {
      ...mockStoreState,
      messages: [
        createAssistantMessage({
          contentBlocks: [
            {
              type: 'tool_call',
              timestamp: 1,
              toolCall: {
                id: 'plan',
                name: 'plan',
                state: 'success',
                result: { todoList: ['Inspect'] },
              },
            },
          ],
        }),
      ],
    }
    await renderCopilot()
    expect(container.querySelector('[data-testid="todo-list"]')).not.toBeNull()

    mockStoreState = { ...mockStoreState, isSendingMessage: false }
    await renderCopilot()
    expect(container.querySelector('[data-testid="todo-list"]')).toBeNull()
  })

  it.each([
    ['real user scroll-up', true, false, 'user', true],
    ['programmatic scroll', true, false, 'programmatic', false],
    ['user scroll near the bottom', true, true, 'user', false],
    ['user scroll after the turn', false, false, 'user', false],
  ] as const)(
    'marks user-scrolled for %s: %s',
    (_case, isTurnInProgress, nearBottom, scrollSource, expected) => {
      expect(
        shouldMarkUserScrolledDuringStream({ isTurnInProgress, nearBottom, scrollSource })
      ).toBe(expected)
    }
  )
})
