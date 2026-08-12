/**
 * @vitest-environment jsdom
 */

import { act, forwardRef, type ReactNode, useImperativeHandle } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GlobalCopilotLayout } from '@/global-navbar/global-copilot-layout'

const panelState = vi.hoisted(() => ({
  collapsed: false,
  collapse: vi.fn(() => {
    panelState.collapsed = true
  }),
  resize: vi.fn(() => {
    panelState.collapsed = false
  }),
}))

vi.mock('@/global-navbar/global-copilot-panel', () => ({
  GlobalCopilotPanel: ({ dashboardMode }: { dashboardMode: boolean }) => (
    <div data-testid='global-copilot-panel' data-dashboard-mode={String(dashboardMode)} />
  ),
}))

vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => (
    <div data-testid='copilot-split'>{children}</div>
  ),
  ResizablePanel: forwardRef(function MockResizablePanel(
    { children, id }: { children: ReactNode; id?: string },
    ref
  ) {
    useImperativeHandle(ref, () => ({
      collapse: panelState.collapse,
      expand: () => undefined,
      getId: () => id ?? '',
      getSize: () => 25,
      isCollapsed: () => panelState.collapsed,
      isExpanded: () => !panelState.collapsed,
      resize: panelState.resize,
    }))
    return <div data-testid={id}>{children}</div>
  }),
  ResizableHandle: () => <div data-testid='copilot-resize-handle' />,
}))

describe('GlobalCopilotLayout', () => {
  let container: HTMLDivElement
  let root: Root
  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    panelState.collapsed = false
    panelState.collapse.mockClear()
    panelState.resize.mockClear()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('keeps stable page and copilot panels while forwarding dashboard mode', async () => {
    await act(async () => {
      root.render(
        <GlobalCopilotLayout
          workspaceId='ws-1'
          ownerUserId='user-1'
          dashboardMode={true}
          open
          onOpenChange={() => undefined}
        >
          <div data-testid='page-content'>Page</div>
        </GlobalCopilotLayout>
      )
    })

    expect(container.querySelector('[data-testid="workspace-copilot"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="workspace-page"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="page-content"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="global-copilot-panel"]')).toHaveAttribute(
      'data-dashboard-mode',
      'true'
    )
  })

  it('collapses and restores the mounted panel from controlled visibility', async () => {
    const render = (open: boolean) =>
      root.render(
        <GlobalCopilotLayout
          workspaceId='ws-1'
          ownerUserId='user-1'
          dashboardMode={false}
          open={open}
          onOpenChange={() => undefined}
        >
          Page
        </GlobalCopilotLayout>
      )

    await act(async () => {
      render(true)
    })

    await act(async () => render(false))
    expect(panelState.collapse).toHaveBeenCalledTimes(1)

    await act(async () => render(true))
    expect(panelState.resize).toHaveBeenCalledWith(25)
  })
})
