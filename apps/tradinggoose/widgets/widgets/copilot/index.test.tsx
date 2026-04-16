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

    expect(container.textContent).toContain('copilot-panel-1')
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
      channelId: 'pair-blue',
      pairColor: 'blue',
    })
    expect(copilotAppPropsSpy.mock.lastCall?.[0]).not.toHaveProperty('reviewTargetMode')
    expect(copilotAppPropsSpy.mock.lastCall?.[0]).not.toHaveProperty('reviewSessionId')
  })

  it('uses the stable pair channel for linked copilot history instead of a panel-specific suffix', async () => {
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
      pairColor: 'red',
    })
  })

  it('keeps the copilot app mounted even when the workspace has no active workflow', async () => {
    const Component = copilotWidget.component

    await act(async () => {
      root.render(
        <>
          {Component?.({
            params: null,
            context: { workspaceId: 'ws-1' },
            pairColor: 'gray',
            panelId: 'panel-1',
            widget: {
              key: 'copilot',
              pairColor: 'gray',
              params: null,
            },
            onWidgetParamsChange: vi.fn(),
          })}
        </>
      )
    })

    expect(copilotAppPropsSpy.mock.lastCall?.[0]).toMatchObject({
      workspaceId: 'ws-1',
      channelId: 'copilot-panel-1',
      pairColor: 'gray',
    })
  })

  it('uses the panel channel when the widget is unpaired', async () => {
    const Component = copilotWidget.component

    await act(async () => {
      root.render(
        <>
          {Component?.({
            params: null,
            context: { workspaceId: 'ws-1' },
            pairColor: 'gray',
            panelId: 'panel-42',
            widget: {
              key: 'copilot',
              pairColor: 'gray',
              params: null,
            },
            onWidgetParamsChange: vi.fn(),
          })}
        </>
      )
    })

    expect(container.querySelector('[data-testid="copilot-app"]')).not.toBeNull()
    expect(copilotAppPropsSpy.mock.lastCall?.[0]).toMatchObject({
      channelId: 'copilot-panel-42',
      pairColor: 'gray',
    })
  })
})
