/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    registryState.componentProps = null
    registryState.headerArgs = null
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('forwards widget runtime context and patch callback to the selected widget', async () => {
    const onWidgetParamsPatch = vi.fn()
    const context = {
      workspaceId: 'workspace-1',
      dashboardLayoutId: 'layout-1',
      dashboardLayoutOwnerUserId: 'user-1',
      dashboardLayoutName: 'Trading Desk',
    }

    await act(async () => {
      root.render(
        <WidgetSurface
          widget={{ key: 'data_chart', pairColor: 'red', params: { data: { provider: 'alpaca' } } }}
          context={context}
          panelId='panel-1'
          onWidgetParamsPatch={onWidgetParamsPatch}
        />
      )
    })

    expect(container.textContent).toContain('registry-header')
    expect(registryState.headerArgs).toMatchObject({ context, panelId: 'panel-1' })
    expect(registryState.componentProps).toMatchObject({
      context,
      panelId: 'panel-1',
      pairColor: 'red',
      onWidgetParamsPatch,
    })
  })
})
