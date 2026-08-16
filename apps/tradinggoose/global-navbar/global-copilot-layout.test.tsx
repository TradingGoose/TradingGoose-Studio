/**
 * @vitest-environment jsdom
 */

import {
  act,
  type ComponentProps,
  forwardRef,
  type ReactNode,
  useImperativeHandle,
  useState,
} from 'react'
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

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/global-navbar/global-copilot-panel', () => ({
  GlobalCopilotPanel: () => {
    const [instanceId] = useState(() => ++panelState.nextCopilotInstanceId)
    const [stagedLocalInput, setStagedLocalInput] = useState('')
    return (
      <div
        data-testid='global-copilot-panel'
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
      minSize,
      'aria-hidden': ariaHidden,
    }: {
      children: ReactNode
      defaultSize?: number
      id?: string
      inert?: boolean
      minSize?: number
      'aria-hidden'?: boolean
    },
    ref
  ) {
    useImperativeHandle(ref, () => ({
      collapse: panelState.collapse,
      isCollapsed: () => panelState.collapsed,
      resize: panelState.resize,
    }))
    return (
      <div
        data-testid={id}
        data-default-size={defaultSize}
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
    panelState.nextCopilotInstanceId = 0
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  const renderLayout = async (props: Partial<ComponentProps<typeof GlobalCopilotLayout>> = {}) => {
    await act(async () => {
      root.render(
        <GlobalCopilotLayout
          workspaceId='ws-1'
          ownerUserId='user-1'
          open
          onOpenChange={() => undefined}
          {...props}
        >
          {props.children ?? 'Page'}
        </GlobalCopilotLayout>
      )
    })
  }

  it('keeps stable page and copilot panels', async () => {
    await renderLayout({
      children: <div data-testid='page-content'>Page</div>,
    })

    expect(container.querySelector('[data-testid="workspace-copilot"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="workspace-page"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="page-content"]')).not.toBeNull()
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
    await renderLayout()
    const initialPanel = container.querySelector('[data-testid="global-copilot-panel"]')
    const initialInstanceId = initialPanel?.getAttribute('data-instance-id')
    const stageButton = initialPanel?.querySelector('button')
    if (!(stageButton instanceof HTMLButtonElement)) {
      throw new Error('Expected the local input staging control')
    }

    await act(async () => stageButton.click())
    await renderLayout()
    expect(container.querySelector('[data-testid="global-copilot-panel"]')).toHaveAttribute(
      'data-instance-id',
      initialInstanceId
    )
    expect(container.querySelector('[data-testid="global-copilot-panel"]')).toHaveAttribute(
      'data-staged-local-input',
      'staged-user-input'
    )

    await renderLayout({ ownerUserId: 'user-2' })
    expect(container.querySelector('[data-testid="global-copilot-panel"]')).not.toHaveAttribute(
      'data-instance-id',
      initialInstanceId
    )
    expect(container.querySelector('[data-testid="global-copilot-panel"]')).toHaveAttribute(
      'data-staged-local-input',
      ''
    )
  })

  it('collapses, restores, and removes the closed panel from interaction', async () => {
    await renderLayout({ open: false })
    expect(panelState.collapse).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-testid="global-copilot-panel"]')).toBeNull()

    const panel = container.querySelector('[data-testid="workspace-copilot"]')
    const handle = container.querySelector('[data-testid="copilot-resize-handle"]')
    expect(panel).toHaveAttribute('inert')
    expect(panel).toHaveAttribute('aria-hidden', 'true')
    expect(handle).toHaveAttribute('data-disabled', 'true')
    expect(handle).toHaveAttribute('tabindex', '-1')
    expect(handle).toHaveAttribute('aria-hidden', 'true')

    await renderLayout()

    expect(panelState.resize).toHaveBeenCalledWith(25)
    expect(panel).not.toHaveAttribute('inert')
    expect(panel).not.toHaveAttribute('aria-hidden')
    expect(handle).toHaveAttribute('data-disabled', 'false')
    expect(handle).toHaveAttribute('tabindex', '0')
    expect(handle).not.toHaveAttribute('aria-hidden')

    const mountedPanel = container.querySelector('[data-testid="global-copilot-panel"]')
    const mountedInstanceId = mountedPanel?.getAttribute('data-instance-id')
    expect(mountedPanel).not.toBeNull()

    await renderLayout({ open: false })
    expect(container.querySelector('[data-testid="global-copilot-panel"]')).toHaveAttribute(
      'data-instance-id',
      mountedInstanceId
    )

    await renderLayout({ open: false, workspaceId: 'ws-2' })
    expect(container.querySelector('[data-testid="global-copilot-panel"]')).toBeNull()
  })
})
