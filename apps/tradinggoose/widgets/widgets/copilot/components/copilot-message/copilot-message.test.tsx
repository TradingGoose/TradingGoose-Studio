/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

let mockStoreState: any

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
    getState: () => mockStoreState,
    setState: vi.fn(),
  }),
}))

vi.mock('@/stores/copilot/store-state', () => ({
  hasUiActiveToolCalls: () => false,
}))

vi.mock('../user-input/user-input', () => ({
  UserInput: () => <div data-testid='user-input' />,
}))

vi.mock('./components', () => ({
  buildAssistantMessageSegments: (contentBlocks: any[] = []) =>
    contentBlocks.map((block, index) => {
      if (block.type === 'thinking') {
        return { type: 'thinking', key: `thinking-${index}`, blocks: [block] }
      }
      if (block.type === 'tool_call') {
        return { type: 'tool_call', key: `tool-${index}`, block }
      }
      return { type: 'text', key: `text-${index}`, block }
    }),
  FileAttachmentDisplay: () => <div data-testid='file-attachments' />,
  OptionsSelector: () => <div data-testid='options-selector' />,
  parseSpecialTags: (content: string) => ({
    cleanContent: content,
  }),
  SmoothStreamingText: ({ content }: { content: string }) => <div>{content}</div>,
  StreamingIndicator: () => <div data-testid='streaming-indicator' />,
  ThinkingGroup: () => <div data-testid='thinking-group' />,
}))

import { CopilotMessage } from './copilot-message'

describe('CopilotMessage', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    const assistantMessage = {
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

    mockStoreState = {
      currentChat: {
        workspaceId: 'ws-1',
        latestTurnStatus: 'completed',
      },
      messages: [assistantMessage],
      sendMessage: vi.fn(),
      isSendingMessage: false,
      isAwaitingContinuation: false,
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

  it('renders assistant content without copy or feedback action buttons', async () => {
    await act(async () => {
      root.render(<CopilotMessage message={mockStoreState.messages[0]} />)
    })

    expect(container.textContent).toContain('Plan is ready.')
    expect(container.textContent).toContain('Source A')
    expect(container.querySelector('[title="Copy"]')).toBeNull()
    expect(container.querySelector('[title="Upvote"]')).toBeNull()
    expect(container.querySelector('[title="Downvote"]')).toBeNull()
  })
})
