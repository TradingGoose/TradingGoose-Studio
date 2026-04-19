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
        <div data-radix-scroll-area-viewport className={viewportClassName}>
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

vi.mock('@/stores/dashboard/pair-store', () => ({
  usePairColorContext: () => null,
}))

vi.mock('@/widgets/widgets/copilot/live-contexts', () => ({
  buildCopilotEditableReviewTargets: () => [],
  buildImplicitCopilotContexts: () => [],
  resolveCopilotWorkflowId: () => null,
}))

vi.mock('..', async () => {
  const React = await import('react')

  const UserInput = React.forwardRef((_props: any, _ref: any) => <div data-testid='user-input' />)
  UserInput.displayName = 'UserInput'

  return {
    CopilotMessage: ({ message }: any) => (
      <div data-testid={`message-${message.id}`}>{message.id}</div>
    ),
    CopilotWelcome: () => <div data-testid='copilot-welcome'>welcome</div>,
    TodoList: () => <div data-testid='todo-list'>todos</div>,
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
        itemId: 'text-1',
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
      root.render(<Copilot workspaceId='ws-1' panelWidth={360} />)
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    scrollToMock.mockReset()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: scrollToMock,
    })
    reactActEnvironment.ResizeObserver = class {
      observe() {}
      disconnect() {}
    } as typeof ResizeObserver

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
      inputValue: '',
      planTodos: [],
      showPlanTodos: false,
      sendMessage: vi.fn(),
      abortMessage: vi.fn(),
      createNewChat: vi.fn(),
      setAccessLevel: vi.fn(),
      setInputValue: vi.fn(),
      loadChats: vi.fn(async () => {}),
      selectedModel: 'gpt-5.4-mini',
      setSelectedModel: vi.fn(),
      currentChat: {
        reviewSessionId: 'chat-1',
        latestTurnStatus: 'in_progress',
      },
      toolCallsById: {},
      fetchContextUsage: vi.fn(async () => {}),
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

  it('keeps auto-scroll active when an in-flight programmatic scroll emits scroll events', async () => {
    await renderCopilot()

    const viewport = container.querySelector('[data-radix-scroll-area-viewport]')
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

  it('still distinguishes real user scroll-up from programmatic auto-scroll', () => {
    expect(
      shouldMarkUserScrolledDuringStream({
        isTurnInProgress: true,
        nearBottom: false,
        scrollSource: 'user',
      })
    ).toBe(true)

    expect(
      shouldMarkUserScrolledDuringStream({
        isTurnInProgress: true,
        nearBottom: false,
        scrollSource: 'programmatic',
      })
    ).toBe(false)

    expect(
      shouldMarkUserScrolledDuringStream({
        isTurnInProgress: true,
        nearBottom: true,
        scrollSource: 'user',
      })
    ).toBe(false)

    expect(
      shouldMarkUserScrolledDuringStream({
        isTurnInProgress: false,
        nearBottom: false,
        scrollSource: 'user',
      })
    ).toBe(false)
  })
})
