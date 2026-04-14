/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copilotWidget } from './index'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const copilotAppPropsSpy = vi.fn()
const useWorkflowWidgetStateSpy = vi.fn()
let mockWorkflowWidgetState: any = {
  channelId: 'workflow-copilot-panel-1',
  resolvedPairColor: 'gray',
  resolvedWorkflowId: 'wf-1',
  hasLoadedWorkflows: true,
  loadError: null,
  isLoading: false,
  workflowIds: ['wf-1'],
}

vi.mock('@/components/ui/loading-agent', () => ({
  LoadingAgent: () => <div>loading</div>,
}))

vi.mock('@/widgets/hooks/use-workflow-widget-state', () => ({
  useWorkflowWidgetState: (args: Record<string, unknown>) => {
    useWorkflowWidgetStateSpy(args)
    return mockWorkflowWidgetState
  },
}))

vi.mock('./components/workflow-copilot-app', () => ({
  __esModule: true,
  default: () => <div>workflow-copilot-app</div>,
}))
vi.mock('./components/copilot-app', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    copilotAppPropsSpy(props)
    return <button type='button' data-testid='copilot-app'>copilot-app</button>
  },
}))

vi.mock('./components/copilot/copilot-header', () => ({
  CopilotHeader: ({ channelId }: { channelId: string }) => (
    <div data-testid='copilot-header'>{channelId}</div>
  ),
  CopilotHeaderActions: ({ channelId }: { channelId: string }) => <div>{channelId}</div>,
}))

describe('copilotWidget', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    copilotAppPropsSpy.mockClear()
    useWorkflowWidgetStateSpy.mockClear()
    mockWorkflowWidgetState = {
      channelId: 'workflow-copilot-panel-1',
      resolvedPairColor: 'gray',
      resolvedWorkflowId: 'wf-1',
      hasLoadedWorkflows: true,
      loadError: null,
      isLoading: false,
      workflowIds: ['wf-1'],
    }
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('renders header slots safely when widget is null', async () => {
    const slots = copilotWidget.renderHeader?.({
      widget: null,
      panelId: 'panel-1',
    })

    await act(async () => {
      root.render(
        <>
          {slots?.left}
          {slots?.right}
        </>
      )
    })

    expect(container.textContent).toContain('workflow-copilot-panel-1')
  })

  it('renders the copilot app without passing any review-target props', async () => {
    const Component = copilotWidget.component

    await act(async () => {
      root.render(
        <>
          {Component?.({
            params: {
              workflowId: 'wf-stale',
              reviewSessionId: 'review-stale',
              reviewEntityKind: 'skill',
              reviewEntityId: 'skill-stale',
            },
            context: { workspaceId: 'ws-1' },
            pairColor: 'blue',
            panelId: 'panel-1',
            widget: {
              key: 'copilot',
              pairColor: 'blue',
              params: {
                workflowId: 'wf-stale',
                reviewSessionId: 'review-stale',
              },
            },
            onWidgetParamsChange: vi.fn(),
          })}
        </>
      )
    })

    expect(copilotAppPropsSpy).toHaveBeenCalled()
    expect(copilotAppPropsSpy.mock.lastCall?.[0]).toMatchObject({
      workspaceId: 'ws-1',
      workflowId: 'wf-1',
      channelId: 'workflow-copilot-panel-1',
      copilotChannelId: 'workflow-copilot-panel-1',
      pairColor: 'gray',
    })
    expect(copilotAppPropsSpy.mock.lastCall?.[0]).not.toHaveProperty('reviewTargetMode')
    expect(copilotAppPropsSpy.mock.lastCall?.[0]).not.toHaveProperty('reviewSessionId')
    expect(useWorkflowWidgetStateSpy.mock.lastCall?.[0]).toMatchObject({
      activateWorkflow: true,
      usePairWorkflowContext: true,
    })
  })

  it('uses the stable pair channel for linked copilot history instead of a panel-specific suffix', async () => {
    mockWorkflowWidgetState = {
      channelId: 'pair-red',
      resolvedPairColor: 'red',
      resolvedWorkflowId: 'wf-1',
      hasLoadedWorkflows: true,
      loadError: null,
      isLoading: false,
      workflowIds: ['wf-1'],
    }

    const Component = copilotWidget.component

    await act(async () => {
      root.render(
        <>
          {Component?.({
            params: null,
            context: { workspaceId: 'ws-1' },
            pairColor: 'red',
            panelId: 'panel-1',
            widget: {
              key: 'copilot',
              pairColor: 'red',
              params: null,
            },
            onWidgetParamsChange: vi.fn(),
          })}
        </>
      )
    })

    expect(copilotAppPropsSpy.mock.lastCall?.[0]).toMatchObject({
      channelId: 'pair-red',
      copilotChannelId: 'pair-red',
      pairColor: 'red',
    })
  })

  it('keeps the copilot app mounted while the linked workflow channel is hydrating', async () => {
    mockWorkflowWidgetState = {
      channelId: 'pair-red',
      resolvedPairColor: 'red',
      resolvedWorkflowId: 'wf-2',
      hasLoadedWorkflows: true,
      loadError: null,
      isLoading: true,
      workflowIds: ['wf-1', 'wf-2'],
    }

    const Component = copilotWidget.component

    await act(async () => {
      root.render(
        <>
          {Component?.({
            params: null,
            context: { workspaceId: 'ws-1' },
            pairColor: 'red',
            panelId: 'panel-1',
            widget: {
              key: 'copilot',
              pairColor: 'red',
              params: null,
            },
            onWidgetParamsChange: vi.fn(),
          })}
        </>
      )
    })

    expect(container.textContent).not.toContain('loading')
    expect(container.querySelector('[data-testid="copilot-app"]')).not.toBeNull()
    expect(copilotAppPropsSpy.mock.lastCall?.[0]).toMatchObject({
      workflowId: 'wf-2',
      channelId: 'pair-red',
      pairColor: 'red',
    })
  })
})
