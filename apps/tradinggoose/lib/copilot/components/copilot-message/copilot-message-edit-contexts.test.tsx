/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ChatContext, CopilotMessage as Message } from '@/stores/copilot/types'

let store: any
vi.mock('@/stores/copilot/store', () => ({
  useCopilotStore: (selector = (state: any) => state) => selector(store),
  useCopilotStoreApi: () => ({ getState: () => store }),
}))
vi.mock('@/lib/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'actor' } } }) }))
vi.mock('@/components/ui', async () => {
  const React = await import('react')
  return {
    Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
    Textarea: React.forwardRef<HTMLTextAreaElement, any>((props, ref) => (
      <textarea {...props} ref={ref} />
    )),
    Tooltip: ({ children }: any) => children,
    TooltipContent: () => null,
    TooltipTrigger: ({ render }: any) => render,
  }
})
vi.mock('../user-input/hooks/use-user-input-mention-sources', () => ({
  useUserInputMentionSources: () => ({
    mentionSources: { pastChats: [], workspaceEntities: {}, blocksList: [], logsList: [] },
    mentionFailed: {},
    mentionLoading: {},
    ensureSubmenuLoaded: vi.fn(),
  }),
}))
vi.mock('../user-input/components/mention-menu', () => ({ MentionMenu: () => null }))
vi.mock('../user-input/components/access-level-selector', () => ({
  AccessLevelSelector: () => null,
}))
vi.mock('../user-input/components/model-selector', () => ({ ModelSelector: () => null }))
vi.mock('@/lib/copilot/inline-tool-call', () => ({ InlineToolCall: () => null }))
vi.mock('./components/smooth-streaming', () => ({
  SmoothStreamingText: () => null,
  StreamingIndicator: () => null,
}))
vi.mock('./components/thinking-group', () => ({ ThinkingGroup: () => null }))

import { CopilotMessage } from './copilot-message'

const implicitContexts: ChatContext[] = [
  { kind: 'current_monitor', monitorId: 'monitor', workspaceId: 'workspace', label: 'Monitor' },
  { kind: 'current_logs', logId: 'log', workspaceId: 'workspace', label: 'Log' },
  {
    kind: 'current_knowledge_base',
    knowledgeBaseId: 'knowledge',
    workspaceId: 'workspace',
    label: 'Knowledge',
  },
  {
    kind: 'current_dashboard_layout',
    dashboardLayoutId: 'layout',
    ownerUserId: 'actor',
    workspaceId: 'workspace',
    label: 'Dashboard',
  },
]
const runtimeContext = {
  workspaceId: 'different-workspace',
  implicitContexts: [
    {
      kind: 'current_monitor' as const,
      monitorId: 'different-monitor',
      workspaceId: 'different-workspace',
      label: 'Current page after navigation',
    },
  ],
}
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  store = {
    currentChat: { workspaceId: 'workspace' },
    currentRunId: null,
    messages: [],
    sendMessage: vi.fn().mockResolvedValue(true),
    isSendingMessage: false,
    isAwaitingContinuation: false,
    isAborting: false,
    abortMessage: vi.fn().mockResolvedValue(true),
    accessLevel: 'limited',
    toolCallsById: {},
  }
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function edit(message: Message, text: string) {
  store.messages = [message]
  await act(async () =>
    root.render(
      <CopilotMessage
        message={message}
        runtimeContext={runtimeContext}
        isStreaming={false}
        panelWidth={375}
        isDimmed={false}
        onEditModeChange={vi.fn()}
      />
    )
  )
  await act(async () => (container.querySelector('[data-message-box]') as HTMLElement).click())
  const textarea = container.querySelector('textarea')!
  expect(textarea).toHaveValue(message.content)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      textarea,
      text
    )
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(textarea).toHaveValue(text)
  await act(async () => {
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    )
  })
}

it.each(implicitContexts)(
  'edits text from $kind with the saved page context through the real input',
  async (context) => {
    const message: Message = {
      id: 'message',
      role: 'user',
      content: 'Explain this page',
      timestamp: '2026-11-12T00:00:00Z',
      contexts: [context],
    }
    const text = `${message.content}?`
    await edit(message, text)
    expect(store.sendMessage).toHaveBeenCalledExactlyOnceWith(text, {
      messageId: message.id,
      contexts: message.contexts,
      runtimeContext,
    })
    expect(container.querySelector('[role="alert"]')).toBeNull()
  }
)

it('still refuses changed explicit context bindings after a mention is removed', async () => {
  const message: Message = {
    id: 'message',
    role: 'user',
    content: 'Explain @Docs for this page',
    timestamp: '2026-11-12T00:00:00Z',
    contexts: [implicitContexts[0], { kind: 'docs', label: 'Docs' }],
  }
  await edit(message, 'Explain this page')
  expect(store.sendMessage).not.toHaveBeenCalled()
  expect(container.querySelector('[role="alert"]')).toHaveTextContent('contexts were retained')
  expect(container.querySelector('textarea')).toHaveValue('Explain this page')
})
