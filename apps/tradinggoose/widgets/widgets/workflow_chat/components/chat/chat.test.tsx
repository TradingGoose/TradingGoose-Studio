/** @vitest-environment jsdom */

import type React from 'react'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/stores/chat/store'
import { Chat } from './chat'

const mockHandleRunWorkflow = vi.hoisted(() => vi.fn())
const mockExecution = vi.hoisted(() => ({ isWorkflowSessionReady: true }))

vi.mock('@/hooks/workflow/use-workflow-execution', () => ({
  useWorkflowExecution: () => ({
    isWorkflowSessionReady: mockExecution.isWorkflowSessionReady,
    handleRunWorkflow: mockHandleRunWorkflow,
  }),
}))

vi.mock('@/widgets/widgets/editor_workflow/context/workflow-route-context', () => ({
  useWorkflowRoute: () => ({
    workflowId: 'workflow-1',
  }),
}))

vi.mock('@/stores/execution/store', () => ({
  useExecutionStore: () => ({
    isExecuting: false,
  }),
}))

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => (
    <div data-radix-scroll-area-viewport>{children}</div>
  ),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
  }),
}))

describe('Workflow Chat', () => {
  let container: HTMLDivElement
  let root: Root
  const previousActEnvironment = (globalThis as any).IS_REACT_ACT_ENVIRONMENT
  const scrollIntoView = vi.fn()

  beforeAll(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollIntoView = scrollIntoView
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockExecution.isWorkflowSessionReady = true
    window.localStorage.clear()
    useChatStore.setState({
      messages: [],
      selectedWorkflowOutputs: {
        'workflow-1': ['agent-1_content', 'agent-1_summary'],
      },
      conversationIds: {
        'workflow-1': 'conversation-1',
      },
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  afterAll(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  })

  async function renderChat(message = 'hello') {
    function Harness() {
      const [chatMessage, setChatMessage] = useState(message)
      return <Chat chatMessage={chatMessage} setChatMessage={setChatMessage} />
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(<Harness />))
  }

  it('renders queued workflow stream chunks before the final result resolves', async () => {
    let resolveExecution: (value: unknown) => void = () => {}
    mockHandleRunWorkflow.mockImplementationOnce((request) => {
      request.onEvent({
        type: 'stream:chunk',
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        timestamp: new Date().toISOString(),
        data: {
          blockId: 'agent-1',
          chunk: 'streamed content',
        },
      })
      request.onEvent({
        type: 'block:completed',
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        timestamp: new Date().toISOString(),
        data: {
          blockId: 'agent-1',
          output: {
            content: 'streamed content',
            summary: 'completed summary',
          },
        },
      })

      return new Promise((resolve) => {
        resolveExecution = resolve
      })
    })

    await renderChat()

    const sendButton = container.querySelector('button:last-of-type') as HTMLButtonElement
    await act(async () => {
      sendButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(container.textContent).toContain('streamed content')
    expect(container.textContent).toContain('completed summary')

    await act(async () => {
      resolveExecution({
        success: true,
        output: {},
        logs: [
          {
            blockId: 'agent-1',
            output: {
              content: 'streamed content',
              summary: 'completed summary',
            },
          },
        ],
      })
    })

    const workflowMessages = useChatStore
      .getState()
      .messages.filter((message) => message.type === 'workflow')
    expect(workflowMessages).toHaveLength(1)
    expect(workflowMessages[0].content).toBe('streamed content\n\ncompleted summary')
  })

  it('uses the latest selected outputs when sending a chat workflow run', async () => {
    mockHandleRunWorkflow.mockResolvedValueOnce({
      success: true,
      output: {},
      logs: [],
    })

    await renderChat()

    await act(async () => {
      useChatStore.getState().setSelectedWorkflowOutput('workflow-1', ['agent-2_content'])
    })

    const sendButton = container.querySelector('button:last-of-type') as HTMLButtonElement
    await act(async () => {
      sendButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mockHandleRunWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedOutputs: ['agent-2_content'],
      })
    )
  })

  it('keeps reader chat input, attachments, and local messages disabled', async () => {
    mockExecution.isWorkflowSessionReady = false

    await renderChat('blocked message')

    const controls = Array.from(
      container.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')
    )
    expect(controls).toHaveLength(4)
    expect(controls.every((control) => control.disabled)).toBe(true)

    await act(async () => {
      controls.at(-1)?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mockHandleRunWorkflow).not.toHaveBeenCalled()
    expect(useChatStore.getState().messages).toEqual([])
  })
})
