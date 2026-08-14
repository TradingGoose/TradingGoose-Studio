/**
 * @vitest-environment jsdom
 */

import { act, forwardRef, type ReactNode, useImperativeHandle, useState } from 'react'
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
  nextCopilotInstanceId: 0,
}))

vi.mock('next/navigation', () => ({
  useSelectedLayoutSegments: () => ['ws-1', 'records'],
}))

vi.mock('@/global-navbar/global-copilot-panel', () => ({
  GlobalCopilotPanel: ({ dashboardMode }: { dashboardMode: boolean }) => {
    const [instanceId] = useState(() => ++panelState.nextCopilotInstanceId)
    const [stagedLocalInput, setStagedLocalInput] = useState('')
    return (
      <div
        data-testid='global-copilot-panel'
        data-dashboard-mode={String(dashboardMode)}
        data-instance-id={instanceId}
        data-staged-local-input={stagedLocalInput}
      >
        <button type='button' onClick={() => setStagedLocalInput('staged-user-input')}>
          Stage local input
        </button>
      </div>
    )
  },
}))

vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => (
    <div data-testid='copilot-split'>{children}</div>
  ),
  ResizablePanel: forwardRef(function MockResizablePanel(
    {
      children,
      id,
      inert,
      ...props
    }: {
      children: ReactNode
      id?: string
      inert?: boolean
      'aria-hidden'?: boolean
    },
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
    return (
      <div data-testid={id} inert={inert} {...props}>
        {children}
      </div>
    )
  }),
  ResizableHandle: ({
    disabled,
    tabIndex,
    'aria-hidden': ariaHidden,
  }: {
    disabled?: boolean
    tabIndex?: number
    'aria-hidden'?: boolean
  }) => (
    <div
      data-testid='copilot-resize-handle'
      data-disabled={String(disabled)}
      tabIndex={tabIndex}
      aria-hidden={ariaHidden}
    />
  ),
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
    panelState.nextCopilotInstanceId = 0
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

  it('remounts user-owned local state only when the authenticated channel changes', async () => {
    const render = (ownerUserId: string, dashboardMode: boolean) =>
      root.render(
        <GlobalCopilotLayout
          workspaceId='ws-1'
          ownerUserId={ownerUserId}
          dashboardMode={dashboardMode}
          open
          onOpenChange={() => undefined}
        >
          Page
        </GlobalCopilotLayout>
      )

    await act(async () => render('user-1', true))
    const initialPanel = container.querySelector('[data-testid="global-copilot-panel"]')
    const initialInstanceId = initialPanel?.getAttribute('data-instance-id')
    const stageButton = initialPanel?.querySelector('button')
    if (!(stageButton instanceof HTMLButtonElement)) {
      throw new Error('Expected the local input staging control')
    }

    await act(async () => stageButton.click())
    await act(async () => render('user-1', false))
    expect(container.querySelector('[data-testid="global-copilot-panel"]')).toHaveAttribute(
      'data-instance-id',
      initialInstanceId
    )
    expect(container.querySelector('[data-testid="global-copilot-panel"]')).toHaveAttribute(
      'data-staged-local-input',
      'staged-user-input'
    )

    await act(async () => render('user-2', false))
    expect(container.querySelector('[data-testid="global-copilot-panel"]')).not.toHaveAttribute(
      'data-instance-id',
      initialInstanceId
    )
    expect(container.querySelector('[data-testid="global-copilot-panel"]')).toHaveAttribute(
      'data-staged-local-input',
      ''
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

  it('removes the closed panel and resize handle from interaction', async () => {
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

    await act(async () => render(false))

    const panel = container.querySelector('[data-testid="workspace-copilot"]')
    const handle = container.querySelector('[data-testid="copilot-resize-handle"]')
    expect(panel).toHaveAttribute('inert')
    expect(panel).toHaveAttribute('aria-hidden', 'true')
    expect(handle).toHaveAttribute('data-disabled', 'true')
    expect(handle).toHaveAttribute('tabindex', '-1')
    expect(handle).toHaveAttribute('aria-hidden', 'true')

    await act(async () => render(true))

    expect(panel).not.toHaveAttribute('inert')
    expect(panel).not.toHaveAttribute('aria-hidden')
    expect(handle).toHaveAttribute('data-disabled', 'false')
    expect(handle).toHaveAttribute('tabindex', '0')
    expect(handle).not.toHaveAttribute('aria-hidden')
  })
})
