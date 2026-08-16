/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CopilotMessage as CopilotMessageType,
  CopilotSendRuntimeContext,
} from '@/stores/copilot/types'
import { buildCopilotWorkspaceEntityContext } from '../../workspace-entities'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let mockStoreState: any

const runtimeContext: CopilotSendRuntimeContext = {
  workspaceId: 'ws-1',
  implicitContexts: [],
}

const assistantMessage: CopilotMessageType = {
  id: 'assistant-1',
  role: 'assistant',
  content: 'Plan is ready.',
  timestamp: '2026-04-17T00:00:00.000Z',
  contentBlocks: [
    {
      type: 'text' as const,
      content: 'Plan is ready.',
      timestamp: 1,
      itemId: 'text-1',
    },
  ],
  citations: [{ id: 1, title: 'Source A', url: 'https://example.com/source-a' }],
}

const assistantOptionsMessage: CopilotMessageType = {
  ...assistantMessage,
  id: 'assistant-options',
  content: 'Choose next.',
  contentBlocks: [
    {
      type: 'text' as const,
      content: 'Choose next.',
      timestamp: 1,
      itemId: 'text-options',
    },
  ],
}

const userMentionMessage: CopilotMessageType = {
  id: 'user-1',
  role: 'user',
  content: "what's the trigger of this workflow? @default-agent",
  timestamp: '2026-04-17T00:00:00.000Z',
  contentBlocks: [],
  contexts: [
    buildCopilotWorkspaceEntityContext({
      entityKind: 'workflow',
      entityId: 'wf-1',
      workspaceId: 'ws-1',
      label: 'default-agent',
    }),
  ],
}

vi.mock('@/lib/copilot/chat-replay-safety', () => ({
  EDIT_REPLAY_BLOCKED_MESSAGE: 'blocked',
  hasAcceptedLiveMutationAfterMessage: () => false,
}))

vi.mock('@/lib/copilot/inline-tool-call', () => ({
  InlineToolCall: () => <div data-testid='inline-tool-call' />,
}))

vi.mock('@/stores/copilot/store', () => ({
  useCopilotStore: () => mockStoreState,
  useCopilotStoreApi: () => ({
    setState: vi.fn(),
  }),
}))

vi.mock('@/stores/copilot/store-state', () => ({
  hasUiActiveToolCalls: () => false,
}))

vi.mock('../user-input/user-input', () => ({
  UserInput: ({ draft, isLoading, onAbort, onSubmit }: any) => (
    <>
      <button
        type='button'
        data-testid='user-input'
        disabled={isLoading}
        onClick={() => onSubmit(draft.text, undefined, draft.contexts)}
      >
        Submit edit
      </button>
      {isLoading && onAbort ? (
        <button type='button' data-testid='abort-edit' onClick={onAbort}>
          Stop generation
        </button>
      ) : null}
    </>
  ),
}))

vi.mock('./components', () => ({
  buildAssistantMessageSegments: (contentBlocks: any[] = []) =>
    contentBlocks.map((block, index) => ({ type: 'text', key: `text-${index}`, block })),
  FileAttachmentDisplay: () => <div data-testid='file-attachments' />,
  OptionsSelector: ({ onSelect }: { onSelect: (key: string, text: string) => void }) => (
    <button
      type='button'
      data-testid='options-selector'
      onClick={() => onSelect('1', 'Inspect current page')}
    >
      Inspect current page
    </button>
  ),
  parseSpecialTags: (content: string) =>
    content === 'Choose next.'
      ? {
          cleanContent: content,
          options: { '1': 'Inspect current page' },
          optionsComplete: true,
        }
      : { cleanContent: content },
  SmoothStreamingText: ({ content }: { content: string }) => <div>{content}</div>,
  StreamingIndicator: () => <div data-testid='streaming-indicator' />,
  ThinkingGroup: () => <div data-testid='thinking-group' />,
}))

import { CopilotMessage } from './copilot-message'

describe('CopilotMessage', () => {
  let container: HTMLDivElement
  let root: Root

  const renderMessage = async (
    message: CopilotMessageType,
    context: CopilotSendRuntimeContext = runtimeContext
  ) => {
    await act(async () =>
      root.render(<CopilotMessage message={message} runtimeContext={context} />)
    )
  }

  const click = async (selector: string) => {
    const element = container.querySelector(selector)
    if (!(element instanceof HTMLElement)) throw new Error(`Expected ${selector}`)
    await act(async () => element.click())
  }

  const editAndSubmit = async () => {
    await click('[data-message-box]')
    await click('[data-testid="user-input"]')
  }

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    mockStoreState = {
      currentChat: {
        workspaceId: 'ws-1',
        latestTurnStatus: 'completed',
      },
      messages: [assistantMessage],
      sendMessage: vi.fn(),
      isSendingMessage: false,
      isAwaitingContinuation: false,
      isAborting: false,
      abortMessage: vi.fn(),
      accessLevel: 'full',
      setAccessLevel: vi.fn(),
      toolCallsById: {},
    }
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('renders assistant content and citations', async () => {
    await renderMessage(assistantMessage)

    expect(container.textContent).toContain('Plan is ready.')
    expect(container.textContent).toContain('Source A')
  })

  it('renders mentions inline and preserves their contexts when editing', async () => {
    mockStoreState.messages = [userMentionMessage]

    await renderMessage(userMentionMessage)
    expect(container.querySelector('[data-message-box] span.rounded-xs')).toHaveTextContent(
      '@default-agent'
    )
    expect(container.textContent).toContain("what's the trigger of this workflow?")
    await editAndSubmit()

    expect(mockStoreState.sendMessage).toHaveBeenCalledWith(userMentionMessage.content, {
      fileAttachments: undefined,
      contexts: userMentionMessage.contexts,
      messageId: userMentionMessage.id,
      runtimeContext,
    })
  })

  it('keeps stop out of the edit composer and aborts before resending', async () => {
    vi.useFakeTimers()
    mockStoreState.currentChat.latestTurnStatus = 'in_progress'
    mockStoreState.messages = [userMentionMessage]

    await renderMessage(userMentionMessage)
    await click('[data-message-box]')
    expect(container.querySelector('[data-testid="abort-edit"]')).toBeNull()
    expect(container.querySelector('[data-testid="user-input"]')).not.toBeDisabled()

    await click('[data-testid="user-input"]')

    expect(mockStoreState.abortMessage).toHaveBeenCalledOnce()
    await act(async () => vi.advanceTimersByTimeAsync(100))
    expect(mockStoreState.sendMessage).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('uses updated context identity when same-text mention props change', async () => {
    const updatedMessage: CopilotMessageType = {
      ...userMentionMessage,
      contexts: [
        buildCopilotWorkspaceEntityContext({
          entityKind: 'workflow',
          entityId: 'wf-2',
          workspaceId: 'ws-1',
          label: 'default-agent',
        }),
      ],
    }
    mockStoreState.messages = [userMentionMessage]

    await renderMessage(userMentionMessage)

    mockStoreState.messages = [updatedMessage]
    await renderMessage(updatedMessage)
    await editAndSubmit()

    expect(mockStoreState.sendMessage).toHaveBeenCalledWith(updatedMessage.content, {
      fileAttachments: undefined,
      contexts: updatedMessage.contexts,
      messageId: updatedMessage.id,
      runtimeContext,
    })
  })

  it('uses the current page context when selecting an option after navigation', async () => {
    const updatedRuntimeContext: CopilotSendRuntimeContext = {
      ...runtimeContext,
      implicitContexts: [
        {
          kind: 'current_monitor',
          monitorId: 'monitor-2',
          workspaceId: 'ws-1',
          label: 'Current monitor',
        },
      ],
    }
    mockStoreState.messages = [assistantOptionsMessage]

    await renderMessage(assistantOptionsMessage)
    await renderMessage(assistantOptionsMessage, updatedRuntimeContext)
    await click('[data-testid="options-selector"]')

    expect(mockStoreState.sendMessage).toHaveBeenCalledWith('Inspect current page', {
      runtimeContext: updatedRuntimeContext,
    })
  })
})
