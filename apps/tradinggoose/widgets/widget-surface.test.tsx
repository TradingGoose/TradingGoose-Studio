/** @vitest-environment jsdom */

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { seedDashboardWidgetSession } from '@/lib/yjs/dashboard-layout-session'
import { LocalWidgetConfigRuntimeProvider } from '@/widgets/widget-config-runtime'
import { WidgetSurface } from '@/widgets/widget-surface'

const registryState = vi.hoisted(() => ({
  componentProps: null as Record<string, unknown> | null,
  headerArgs: null as Record<string, unknown> | null,
}))

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/widgets/widgets/components/pair-color-dropdown', () => ({
  PairColorDropdown: () => null,
}))
vi.mock('@/widgets/widgets/components/widget-selector', () => ({ WidgetSelector: () => null }))
vi.mock('@/widgets/widgets/components/widget-action-menu', () => ({
  WidgetActionMenu: () => null,
}))

vi.mock('@/widgets/registry', () => ({
  getWidgetDefinition: (key: string) => ({
    component: (props: Record<string, unknown>) => {
      registryState.componentProps = props
      return <div data-testid={`widget-${key}`} />
    },
    renderHeader: (args: Record<string, unknown>) => {
      registryState.headerArgs = args
      return { left: <span>registry-header</span> }
    },
  }),
}))

const reactActEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }

describe('WidgetSurface', () => {
  let container: HTMLDivElement
  let root: Root
  let doc: Y.Doc

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    registryState.componentProps = null
    registryState.headerArgs = null
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    doc = new Y.Doc()
    seedDashboardWidgetSession(doc, {
      pairColor: 'red',
      params: { data: { provider: 'alpaca' } },
    })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    doc.destroy()
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('forwards widget runtime context and patch callback to the selected widget', async () => {
    const onWidgetParamsPatch = vi.fn()
    const onWidgetLinkedParamsPatch = vi.fn()
    const context = {
      workspaceId: 'workspace-1',
      dashboardLayoutId: 'layout-1',
      dashboardLayoutOwnerUserId: 'user-1',
      dashboardLayoutName: 'Trading Desk',
    }

    await act(async () => {
      root.render(
        <LocalWidgetConfigRuntimeProvider doc={doc} widgetKey='data_chart'>
          <WidgetSurface
            context={context}
            panelId='panel-1'
            onWidgetParamsPatch={onWidgetParamsPatch}
            onWidgetLinkedParamsPatch={onWidgetLinkedParamsPatch}
          />
        </LocalWidgetConfigRuntimeProvider>
      )
    })

    expect(container.textContent).toContain('registry-header')
    expect(registryState.headerArgs).toMatchObject({
      channelId: 'pair-red',
      context,
      panelId: 'panel-1',
    })
    expect(registryState.componentProps).toMatchObject({
      channelId: 'pair-red',
      context,
      panelId: 'panel-1',
      pairColor: 'red',
      onWidgetParamsPatch,
      onWidgetLinkedParamsPatch,
    })
  })

  it('keeps the empty-widget render fallback and layout selection callback', async () => {
    const onWidgetChange = vi.fn()
    seedDashboardWidgetSession(doc, { pairColor: 'gray', params: null })

    await act(async () => {
      root.render(
        <LocalWidgetConfigRuntimeProvider doc={doc} widgetKey={null}>
          <WidgetSurface panelId='panel-1' onWidgetChange={onWidgetChange} />
        </LocalWidgetConfigRuntimeProvider>
      )
    })

    expect(container.querySelector('[data-testid="widget-empty"]')).toBeTruthy()
    expect(registryState.headerArgs).toMatchObject({ channelId: 'empty-panel-1' })
    expect(registryState.componentProps).toMatchObject({
      channelId: 'empty-panel-1',
      onWidgetChange,
    })
  })
})
