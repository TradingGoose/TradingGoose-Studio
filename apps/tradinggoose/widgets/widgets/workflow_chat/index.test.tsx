/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chatWidget } from './index'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const mockChatApp = vi.hoisted(() => vi.fn())

let mockWorkflowWidgetState: any = {
  resolvedPairColor: 'gray',
  resolvedWorkflowId: 'wf-1',
  hasLoadedWorkflows: true,
  loadError: null,
  isLoading: false,
  workflowIds: ['wf-1'],
}

const mockChatStore = {
  selectedWorkflowOutputs: {
    'wf-1': ['output-1'],
  },
  setSelectedWorkflowOutput: vi.fn(),
  clearChat: vi.fn(),
  messages: [],
}

vi.mock('lucide-react', () => ({
  Ban: () => <svg />,
  MessageCircle: () => <svg />,
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/ui/loading-agent', () => ({
  LoadingAgent: () => <div>loading</div>,
}))

vi.mock('@/stores/chat/store', () => ({
  useChatStore: () => mockChatStore,
}))

vi.mock('@/widgets/hooks/use-workflow-widget-state', () => ({
  useWorkflowWidgetState: () => mockWorkflowWidgetState,
}))

vi.mock('@/components/widget-header-control', () => ({
  widgetHeaderButtonGroupClassName: () => 'controls',
  widgetHeaderControlClassName: (className?: string) => className ?? '',
  widgetHeaderIconButtonClassName: () => 'icon-button',
}))

vi.mock('@/widgets/widgets/components/workflow-dropdown', () => ({
  WorkflowDropdown: () => <div data-testid='workflow-dropdown'>workflow-dropdown</div>,
}))

vi.mock('./components', () => ({
  OutputSelect: () => <div data-testid='output-select'>output-select</div>,
}))

vi.mock('./components/workflow-chat-app', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockChatApp(props)
    return <div data-testid='workflow-chat-app'>workflow-chat-app</div>
  },
  WorkflowChatSessionProviders: ({
    workspaceId,
    workflowId,
    accessMode,
    children,
  }: {
    workspaceId: string
    workflowId: string
    accessMode: string
    children: React.ReactNode
  }) => (
    <div
      data-testid='workflow-chat-session-providers'
      data-workspace-id={workspaceId}
      data-workflow-id={workflowId}
      data-access-mode={accessMode}
    >
      {children}
    </div>
  ),
}))

describe('chatWidget header', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockWorkflowWidgetState = {
      resolvedPairColor: 'gray',
      resolvedWorkflowId: 'wf-1',
      hasLoadedWorkflows: true,
      loadError: null,
      isLoading: false,
      workflowIds: ['wf-1'],
    }
    mockChatStore.setSelectedWorkflowOutput.mockClear()
    mockChatStore.clearChat.mockClear()
    mockChatApp.mockClear()
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('wraps the header output selector with the workflow chat session providers', async () => {
    const slots = chatWidget.renderHeader?.({
      widget: {
        key: 'workflow_chat',
        pairColor: 'gray',
        params: {
          workflowId: 'wf-1',
        },
      } as any,
      context: {
        workspaceId: 'ws-1',
        canWrite: false,
      } as any,
      panelId: 'panel-1',
    })

    await act(async () => {
      root.render(<>{slots?.left}</>)
    })

    const provider = container.querySelector('[data-testid="workflow-chat-session-providers"]')
    expect(provider).not.toBeNull()
    expect(provider?.getAttribute('data-workspace-id')).toBe('ws-1')
    expect(provider?.getAttribute('data-workflow-id')).toBe('wf-1')
    expect(provider?.getAttribute('data-access-mode')).toBe('read')
    expect(container.querySelector('[data-testid="output-select"]')).not.toBeNull()
  })

  it('opens the workflow chat body in read mode for workspace readers', async () => {
    await act(async () => {
      root.render(
        <>{chatWidget.component({ context: { workspaceId: 'ws-1', canWrite: false } })}</>
      )
    })

    expect(mockChatApp).toHaveBeenCalledWith(expect.objectContaining({ accessMode: 'read' }))
  })
})
