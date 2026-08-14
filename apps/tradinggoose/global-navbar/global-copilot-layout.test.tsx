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
  compactLayout: false,
  compactLayoutBreakpoint: null as number | null,
  nextCopilotInstanceId: 0,
}))

vi.mock('next/navigation', () => ({
  useSelectedLayoutSegments: () => ['ws-1', 'records'],
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: (breakpoint: number) => {
    panelState.compactLayoutBreakpoint = breakpoint
    return panelState.compactLayout
  },
}))

vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({
    children,
    disablePointerDismissal,
    modal,
    onOpenChange,
    open,
  }: {
    children: ReactNode
    disablePointerDismissal?: boolean
    modal?: boolean
    onOpenChange: (open: boolean) => void
    open: boolean
  }) => (
    <div
      data-testid='copilot-sheet'
      data-disable-pointer-dismissal={String(disablePointerDismissal)}
      data-modal={String(modal)}
      data-open={String(open)}
    >
      <button type='button' onClick={() => onOpenChange(false)}>
        Close sheet
      </button>
      {children}
    </div>
  ),
  SheetContent: ({
    backdropClassName,
    children,
    className,
    closeClassName,
    keepMounted,
    role,
    side,
    viewportClassName,
  }: {
    backdropClassName?: string
    children: ReactNode
    className?: string
    closeClassName?: string
    keepMounted?: boolean
    role?: string
    side?: string
    viewportClassName?: string
  }) => (
    <div
      data-testid='copilot-sheet-content'
      data-backdrop-class={backdropClassName}
      data-close-class={closeClassName}
      data-keep-mounted={String(keepMounted)}
      data-role={role}
      data-side={side}
      data-viewport-class={viewportClassName}
      className={className}
    >
      {children}
    </div>
  ),
  SheetTitle: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid='copilot-sheet-title' className={className}>
      {children}
    </div>
  ),
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
      defaultSize,
      id,
      inert,
      maxSize,
      minSize,
      'aria-hidden': ariaHidden,
    }: {
      children: ReactNode
      defaultSize?: number
      id?: string
      inert?: boolean
      maxSize?: number
      minSize?: number
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
      <div
        data-testid={id}
        data-default-size={defaultSize}
        data-max-size={maxSize}
        data-min-size={minSize}
        inert={inert}
        aria-hidden={ariaHidden}
      >
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
    panelState.compactLayout = false
    panelState.compactLayoutBreakpoint = null
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
    expect(container.querySelector('[data-testid="workspace-copilot"]')).toHaveAttribute(
      'data-min-size',
      '25'
    )
    expect(container.querySelector('[data-testid="workspace-copilot"]')).toHaveAttribute(
      'data-default-size',
      '25'
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

  it('switches to a retained modal sheet without remounting the page or Copilot', async () => {
    const onOpenChange = vi.fn()
    const render = (open: boolean) =>
      root.render(
        <GlobalCopilotLayout
          workspaceId='ws-1'
          ownerUserId='user-1'
          dashboardMode={false}
          open={open}
          onOpenChange={onOpenChange}
        >
          <div data-testid='page-content'>Page</div>
        </GlobalCopilotLayout>
      )

    await act(async () => render(true))
    const initialPage = container.querySelector('[data-testid="page-content"]')
    const instanceId = container
      .querySelector('[data-testid="global-copilot-panel"]')
      ?.getAttribute('data-instance-id')
    if (!initialPage || !instanceId) throw new Error('Expected initial page and Copilot instances')

    panelState.compactLayout = true
    await act(async () => render(true))

    expect(panelState.compactLayoutBreakpoint).toBe(1536)
    expect(container.querySelector('[data-testid="copilot-split"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-testid="global-copilot-panel"]')).toHaveLength(1)
    expect(container.querySelector('[data-testid="page-content"]')).toBe(initialPage)
    expect(container.querySelector('[data-testid="global-copilot-panel"]')).toHaveAttribute(
      'data-instance-id',
      instanceId
    )
    expect(panelState.collapse).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-testid="copilot-sheet"]')).toHaveAttribute(
      'data-open',
      'true'
    )
    expect(container.querySelector('[data-testid="copilot-sheet"]')).toHaveAttribute(
      'data-modal',
      'true'
    )
    expect(container.querySelector('[data-testid="copilot-sheet"]')).toHaveAttribute(
      'data-disable-pointer-dismissal',
      'false'
    )
    expect(container.querySelector('[data-testid="copilot-sheet-content"]')).toHaveAttribute(
      'data-keep-mounted',
      'true'
    )
    expect(container.querySelector('[data-testid="copilot-sheet-content"]')).toHaveAttribute(
      'data-side',
      'left'
    )
    expect(container.querySelector('[data-testid="copilot-sheet-content"]')).toHaveAttribute(
      'data-role',
      'dialog'
    )
    expect(container.querySelector('[data-testid="copilot-sheet-content"]')).toHaveAttribute(
      'data-backdrop-class',
      '2xl:hidden'
    )
    expect(container.querySelector('[data-testid="copilot-sheet-content"]')).toHaveClass('w-full')
    expect(container.querySelector('[data-testid="copilot-sheet-title"]')).toHaveTextContent(
      'label'
    )

    const closeButton = container.querySelector('[data-testid="copilot-sheet"] button')
    if (!(closeButton instanceof HTMLButtonElement)) throw new Error('Expected sheet close button')
    await act(async () => closeButton.click())
    expect(onOpenChange).toHaveBeenCalledWith(false)

    await act(async () => render(false))
    expect(container.querySelector('[data-testid="page-content"]')).toBe(initialPage)
    expect(container.querySelector('[data-testid="global-copilot-panel"]')).toHaveAttribute(
      'data-instance-id',
      instanceId
    )
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
