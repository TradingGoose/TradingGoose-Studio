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
    },
  ],
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

vi.mock('@/lib/copilot/inline-tool-call', () => ({
  InlineToolCall: ({ toolCall }: any) => (
    <div data-testid='inline-tool-call'>{JSON.stringify(toolCall.result)}</div>
  ),
}))

vi.mock('@/stores/copilot/store', () => ({
  useCopilotStore: () => mockStoreState,
  useCopilotStoreApi: () => ({
    getState: () => mockStoreState,
  }),
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

vi.mock('./components/file-display', () => ({
  NativeFileDisplay: ({ file }: any) => (
    <img data-native-image alt='Conversation image' src={file.data} />
  ),
}))

vi.mock('./components/options-selector', () => ({
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
}))

vi.mock('./components/smooth-streaming', () => ({
  SmoothStreamingText: ({ content }: { content: string }) => <div>{content}</div>,
  StreamingIndicator: () => <div data-testid='streaming-indicator' />,
}))

vi.mock('./components/thinking-group', () => ({
  ThinkingGroup: () => <div data-testid='thinking-group' />,
}))

import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { CopilotMessage } from './copilot-message'

describe('CopilotMessage', () => {
  let container: HTMLDivElement
  let root: Root

  const renderMessage = async (
    message: CopilotMessageType,
    context: CopilotSendRuntimeContext = runtimeContext
  ) => {
    await act(async () =>
      root.render(
        <CopilotMessage
          message={message}
          runtimeContext={context}
          isStreaming={false}
          panelWidth={308}
          isDimmed={false}
          onEditModeChange={vi.fn()}
        />
      )
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
      },
      currentRunId: null,
      messages: [assistantMessage],
      sendMessage: vi.fn().mockResolvedValue(true),
      isSendingMessage: false,
      isAwaitingContinuation: false,
      isAborting: false,
      abortMessage: vi.fn().mockResolvedValue(true),
      toolCallsById: {},
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('shows persisted message tokens and USD provenance and updates metrics on the same message', async () => {
    await renderMessage({
      ...assistantMessage,
      usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 },
      cost: { status: 'estimated', total: 0.002, estimated: true, currency: 'USD' },
    })
    expect(container.querySelector('[data-testid="message-usage"]')?.textContent).toContain(
      '15 tokens'
    )
    expect(container.querySelector('[data-testid="message-usage"]')?.textContent).toContain(
      'Estimated $0.0020 USD'
    )
    await renderMessage({
      ...assistantMessage,
      usage: { totalTokens: 20 },
      cost: { status: 'partial', estimated: true, availableTotal: 0.003, currency: 'USD' },
    })
    expect(container.querySelector('[data-testid="message-usage"]')?.textContent).toContain(
      '20 tokens'
    )
    expect(container.querySelector('[data-testid="message-usage"]')?.textContent).toContain(
      'Unavailable USD (estimated $0.0030 available)'
    )
    expect(container.querySelector('[data-testid="message-usage"]')?.textContent).not.toContain(
      '$0 USD'
    )
  })

  it('renders assistant content', async () => {
    await renderMessage(assistantMessage)

    expect(container.textContent).toContain('Plan is ready.')
  })
  it('renders changed tool results and error state for the same message identity', async () => {
    const resultMessage = (result: string, isError = false): CopilotMessageType => ({
      ...assistantMessage,
      isError,
      contentBlocks: [
        {
          type: 'tool_call',
          timestamp: 1,
          toolCall: { id: 'tool', name: 'plan', state: ClientToolCallState.success, result },
        },
      ],
    })
    await renderMessage(resultMessage('First result'))
    expect(container.querySelector('[data-testid="inline-tool-call"]')?.textContent).toContain(
      'First result'
    )
    expect(container.querySelector('[role="alert"]')).toBeNull()
    await renderMessage(resultMessage('Updated result', true))
    expect(container.querySelector('[data-testid="inline-tool-call"]')?.textContent).toContain(
      'Updated result'
    )
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
  })

  it('renders canonical user images between exact text parts', async () => {
    const data =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg=='
    const message: CopilotMessageType = {
      id: 'native-user',
      role: 'user',
      content: ' before\n\tafter ',
      timestamp: '2026-11-08T00:00:00Z',
      contentBlocks: [
        { type: 'text', content: ' before\n', timestamp: 1 },
        { type: 'file', file: { data, mimeType: 'image/png' }, timestamp: 1 },
        { type: 'text', content: '\tafter ', timestamp: 1 },
      ],
    }
    mockStoreState.messages = [message]
    await renderMessage(message)
    const rendered = container.querySelector('[data-message-box] > div')!
    expect([...rendered.children].map((child) => child.tagName)).toEqual(['SPAN', 'IMG', 'SPAN'])
    expect(rendered.children[0]).toHaveTextContent('before')
    expect(rendered.children[1].getAttribute('src')).toBe(data)
    expect(rendered.children[2]).toHaveTextContent('after')
    expect((rendered as HTMLElement).style.maxHeight).toBe('none')
    await act(async () => (rendered.children[1] as HTMLImageElement).click())
    expect(container.querySelector('[data-testid="user-input"]')).toBeNull()
    await editAndSubmit()
    expect(mockStoreState.sendMessage).not.toHaveBeenCalled()
    expect(container.textContent).toContain('attachments and contexts were retained')
  })
  it('renders native assistant image parts in their canonical text order through the actual segmenter', async () => {
    const data =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg=='
    const message: CopilotMessageType = {
      ...assistantMessage,
      content: 'beforeafter',
      contentBlocks: [
        { type: 'text', content: 'before', timestamp: 1 },
        { type: 'file', file: { data, mimeType: 'image/png' }, timestamp: 2 },
        { type: 'text', content: 'after', timestamp: 3 },
      ],
    }
    mockStoreState.messages = [message]
    await renderMessage(message)
    const image = container.querySelector('img')!
    expect(image.getAttribute('src')).toBe(data)
    const before = [...container.querySelectorAll('div')].find(
      (element) => element.textContent === 'before'
    )!
    const after = [...container.querySelectorAll('div')].find(
      (element) => element.textContent === 'after'
    )!
    expect(before.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(image.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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
      messageId: userMentionMessage.id,
      contexts: userMentionMessage.contexts,
      runtimeContext,
    })
  })

  it('preserves later native tool history when a user tries to edit its prompt', async () => {
    mockStoreState.messages = [
      userMentionMessage,
      {
        ...assistantMessage,
        contentBlocks: [
          {
            type: 'tool_call',
            timestamp: 1,
            toolCall: {
              id: 'read',
              name: 'read_workflow',
              state: ClientToolCallState.success,
            },
          },
        ],
      },
    ]
    await renderMessage(userMentionMessage)
    await click('[data-message-box]')
    expect(container.querySelector('[data-testid="user-input"]')).toBeNull()
    expect(container.textContent).toContain('Start a new message after tool activity')
    expect(mockStoreState.sendMessage).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    'regenerates only after confirmed cancellation (%s)',
    async (cancelled) => {
      let finishCancellation!: (value: boolean) => void
      mockStoreState.abortMessage.mockReturnValue(
        new Promise<boolean>((resolve) => {
          finishCancellation = resolve
        })
      )
      mockStoreState.isSendingMessage = true
      mockStoreState.currentRunId = 'native-run'
      mockStoreState.messages = [userMentionMessage]

      await renderMessage(userMentionMessage)
      await click('[data-message-box]')
      expect(container.querySelector('[data-testid="abort-edit"]')).toBeNull()
      expect(container.querySelector('[data-testid="user-input"]')).not.toBeDisabled()

      await click('[data-testid="user-input"]')

      expect(mockStoreState.abortMessage).toHaveBeenCalledOnce()
      expect(mockStoreState.sendMessage).not.toHaveBeenCalled()
      mockStoreState.error = cancelled ? null : 'The previous response is still stopping'
      await act(async () => finishCancellation(cancelled))
      if (cancelled) expect(mockStoreState.sendMessage).toHaveBeenCalledOnce()
      else {
        expect(mockStoreState.sendMessage).not.toHaveBeenCalled()
        expect(container.textContent).toContain(mockStoreState.error)
        expect(container.querySelector('[data-testid="user-input"]')).not.toBeNull()
      }
    }
  )

  it('waits for native admission before allowing an active prompt to be edited', async () => {
    mockStoreState.isSendingMessage = true
    mockStoreState.messages = [userMentionMessage]
    await renderMessage(userMentionMessage)
    await click('[data-message-box]')
    expect(container.querySelector('[data-testid="user-input"]')).toBeNull()
    expect(container.textContent).toContain('Wait for the response to start')
    expect(mockStoreState.abortMessage).not.toHaveBeenCalled()
    expect(mockStoreState.sendMessage).not.toHaveBeenCalled()
  })

  it('shows a failed regeneration instead of claiming that an edit completed', async () => {
    mockStoreState.messages = [userMentionMessage]
    mockStoreState.error = 'Selected model is unavailable'
    mockStoreState.sendMessage.mockResolvedValue(false)
    await renderMessage(userMentionMessage)
    await editAndSubmit()
    expect(container.textContent).toContain('Selected model is unavailable')
    expect(container.querySelector('[data-testid="user-input"]')).not.toBeNull()
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
      messageId: updatedMessage.id,
      contexts: updatedMessage.contexts,
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
