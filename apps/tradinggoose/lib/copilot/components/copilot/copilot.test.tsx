/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
  ResizeObserver?: typeof ResizeObserver
}

let mockStoreState: any
let mockUserInputProps: any
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

vi.mock('@/stores/copilot/store', () => ({
  useCopilotStore: () => mockStoreState,
  useCopilotStoreApi: () => ({
    getState: () => mockStoreState,
    setState: (partial: any) => {
      const nextState = typeof partial === 'function' ? partial(mockStoreState) : partial
      mockStoreState = {
        ...mockStoreState,
        ...nextState,
      }
    },
  }),
}))

vi.mock('@/stores/copilot/store-state', () => ({
  hasUiActiveToolCalls: () => false,
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
      messages: [createAssistantMessage()],
      chats: [],
      isLoadingChats: false,
      isSendingMessage: true,
      isAwaitingContinuation: false,
      abortController: null,
      isAborting: false,
      accessLevel: 'full',
      draft: { text: '', contexts: [] },
      planTodos: [],
      sendMessage: vi.fn(),
      abortMessage: vi.fn(),
      setAccessLevel: vi.fn(),
      setDraft: vi.fn(),
      loadChats: vi.fn(async () => {}),
      selectedModel: 'openai/gpt-5.6-sol',
      setSelectedModel: vi.fn(),
      currentChat: {
        threadId: 'chat-1',
      },
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

  it('shows an optional history refresh error separately from the known completed message', async () => {
    mockStoreState = {
      ...mockStoreState,
      isSendingMessage: false,
      currentChat: { threadId: 'owned-thread' },
      historyRefreshError: 'History read unavailable',
      isRefreshingHistory: false,
      refreshCurrentHistory: vi.fn(async () => {}),
      messages: [createAssistantMessage({ content: 'Known completed answer' })],
    }
    await renderCopilot()
    expect(container.querySelector('[data-testid="message-assistant-1"]')).not.toBeNull()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'History read unavailable'
    )
    const button = Array.from(container.querySelectorAll('button')).find((x) =>
      x.textContent?.includes('Refresh history')
    )!
    expect(button).toBeDefined()
    await act(async () => button.click())
    expect(mockStoreState.refreshCurrentHistory).toHaveBeenCalledOnce()
    expect(mockStoreState.sendMessage).not.toHaveBeenCalled()
    expect(mockStoreState.abortMessage).not.toHaveBeenCalled()
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

  it('hides unfinished todos when no turn is active', async () => {
    mockStoreState = {
      ...mockStoreState,
      isSendingMessage: false,
      currentChat: { ...mockStoreState.currentChat },
      planTodos: [{ id: 'old-todo', content: 'Previous turn', completed: false }],
    }

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
