/**
 * @vitest-environment jsdom
 */

import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { seedDashboardColorPairSession } from '@/lib/yjs/dashboard-layout-session'
import { GlobalCopilotPanel as GlobalCopilotPanelComponent } from '@/global-navbar/global-copilot-panel'

const GlobalCopilotPanel = (
  props: Omit<ComponentProps<typeof GlobalCopilotPanelComponent>, 'channelId'>
) => <GlobalCopilotPanelComponent channelId='copilot:user:user-1:workspace:ws-1' {...props} />

const mocks = vi.hoisted(() => ({
  targetSession: vi.fn(),
  copilotProps: null as Record<string, unknown> | null,
  currentContext: null as Record<string, unknown> | null,
  activeLayout: null as {
    id: string
    name: string
    sortOrder: number
    isActive: boolean
    updatedAt: string
  } | null,
  pairSession: {
    doc: null as Y.Doc | null,
    isLoading: false,
    isRetrying: false,
    error: null as string | null,
    retry: vi.fn(),
  },
}))

vi.mock('@/global-navbar/copilot-context', () => ({
  useGlobalCopilotCurrentContext: () => mocks.currentContext,
  useGlobalCopilotActiveDashboardLayout: () => mocks.activeLayout,
}))

vi.mock('@/lib/yjs/use-entity-fields', () => ({
  useYjsTargetSession: (...args: unknown[]) => {
    mocks.targetSession(...args)
    return mocks.pairSession
  },
}))

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/widgets/widgets/components/pair-color-dropdown', () => ({
  PairColorDropdown: ({
    color,
    onChange,
  }: {
    color: string
    onChange?: (color: string) => void
  }) => (
    <button
      type='button'
      data-testid='pair-color'
      data-color={color}
      disabled={!onChange}
      onClick={() => onChange?.('blue')}
    >
      Pair color
    </button>
  ),
}))

vi.mock('@/widgets/widgets/copilot/components/copilot-app', () => ({
  CopilotApp: (props: Record<string, unknown>) => {
    mocks.copilotProps = props
    return <div data-testid='copilot-app' />
  },
}))

vi.mock('@/widgets/widgets/copilot/components/copilot/copilot-header', () => ({
  CopilotHeader: () => <div data-testid='copilot-header' />,
  CopilotHeaderActions: () => <div data-testid='copilot-actions' />,
}))

describe('GlobalCopilotPanel dashboard color boundary', () => {
  let container: HTMLDivElement
  let root: Root
  let pairDoc: Y.Doc
  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    pairDoc = new Y.Doc()
    seedDashboardColorPairSession(pairDoc, { workflowId: 'workflow-blue' })
    mocks.activeLayout = {
      id: 'layout-1',
      name: 'Main Dashboard',
      sortOrder: 0,
      isActive: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    mocks.pairSession = {
      doc: pairDoc,
      isLoading: false,
      isRetrying: false,
      error: null,
      retry: vi.fn(),
    }
    mocks.copilotProps = null
    mocks.currentContext = {
      kind: 'current_monitor',
      monitorId: 'monitor-1',
      workspaceId: 'ws-1',
      label: 'Current monitor',
    }
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    pairDoc.destroy()
    mocks.targetSession.mockReset()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('opens the dashboard color session only on the dashboard route', async () => {
    await act(async () => {
      root.render(
        <GlobalCopilotPanel workspaceId='ws-1' ownerUserId='user-1' dashboardMode={false} />
      )
    })

    expect(mocks.targetSession).toHaveBeenLastCalledWith(
      null,
      'read',
      'Failed to open dashboard color pair'
    )
    expect(container.querySelector('[data-testid="pair-color"]')).toBeNull()
    expect(mocks.copilotProps).toMatchObject({
      channelId: 'copilot:user:user-1:workspace:ws-1',
      effectiveParams: null,
      layoutId: null,
      ownerUserId: null,
      currentContext: mocks.currentContext,
      inputDisabled: false,
    })

    await act(async () => {
      root.render(
        <GlobalCopilotPanel workspaceId='ws-1' ownerUserId='user-1' dashboardMode={true} />
      )
    })

    const pairColor = container.querySelector('[data-testid="pair-color"]')
    if (!(pairColor instanceof HTMLButtonElement)) throw new Error('Expected dashboard pair color')
    await act(async () => pairColor.click())

    expect(mocks.targetSession.mock.lastCall?.[1]).toBe('read')
    expect(mocks.targetSession.mock.lastCall?.[0]).toMatchObject({
      entityKind: 'dashboard_color_pair',
      entityId: 'blue',
    })
    expect(pairColor).toHaveAttribute('data-color', 'blue')
    expect(mocks.copilotProps).toMatchObject({
      channelId: 'copilot:user:user-1:workspace:ws-1',
      effectiveParams: { workflowId: 'workflow-blue' },
      layoutId: 'layout-1',
      ownerUserId: 'user-1',
      layoutName: 'Main Dashboard',
      currentContext: mocks.currentContext,
      inputDisabled: false,
    })

    await act(async () => {
      root.render(
        <GlobalCopilotPanel workspaceId='ws-1' ownerUserId='user-1' dashboardMode={false} />
      )
    })

    expect(mocks.targetSession.mock.lastCall?.[0]).toBeNull()
    expect(container.querySelector('[data-testid="pair-color"]')).toBeNull()
    expect(mocks.copilotProps).toMatchObject({
      effectiveParams: null,
      layoutId: null,
      ownerUserId: null,
      layoutName: null,
      inputDisabled: false,
    })
  })

  it('blocks a selected pair until its document is ready and exposes failure retry', async () => {
    await act(async () => {
      root.render(
        <GlobalCopilotPanel workspaceId='ws-1' ownerUserId='user-1' dashboardMode={true} />
      )
    })
    const pairColor = container.querySelector('[data-testid="pair-color"]')
    if (!(pairColor instanceof HTMLButtonElement)) throw new Error('Expected dashboard pair color')

    mocks.pairSession = { ...mocks.pairSession, doc: null, isLoading: true }
    await act(async () => pairColor.click())
    expect(mocks.copilotProps).toMatchObject({ effectiveParams: null, inputDisabled: true })
    expect(container.querySelector('[role="status"]')).not.toBeNull()

    const retry = vi.fn()
    mocks.pairSession = {
      ...mocks.pairSession,
      doc: null,
      isLoading: false,
      error: 'Pair unavailable',
      retry,
    }
    await act(async () => {
      root.render(
        <GlobalCopilotPanel workspaceId='ws-1' ownerUserId='user-1' dashboardMode={true} />
      )
    })
    expect(container.querySelector('[role="alert"]')).toHaveTextContent(
      'The shared color settings could not be loaded.'
    )
    const retryButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Retry'
    )
    if (!retryButton) throw new Error('Expected pair retry button')
    await act(async () => retryButton.click())
    expect(retry).toHaveBeenCalledOnce()

    mocks.pairSession = { ...mocks.pairSession, doc: pairDoc, error: null }
    await act(async () => {
      root.render(
        <GlobalCopilotPanel workspaceId='ws-1' ownerUserId='user-1' dashboardMode={true} />
      )
    })
    expect(mocks.copilotProps).toMatchObject({
      effectiveParams: { workflowId: 'workflow-blue' },
      inputDisabled: false,
    })
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('drops dashboard pairing when no layout is active', async () => {
    await act(async () => {
      root.render(
        <GlobalCopilotPanel workspaceId='ws-1' ownerUserId='user-1' dashboardMode={true} />
      )
    })
    const pairColor = container.querySelector('[data-testid="pair-color"]')
    if (!(pairColor instanceof HTMLButtonElement)) throw new Error('Expected dashboard pair color')
    await act(async () => pairColor.click())

    mocks.activeLayout = null
    await act(async () => {
      root.render(
        <GlobalCopilotPanel workspaceId='ws-1' ownerUserId='user-1' dashboardMode={true} />
      )
    })

    expect(container.querySelector('[data-testid="pair-color"]')).toHaveAttribute(
      'data-color',
      'gray'
    )
    expect(mocks.targetSession.mock.lastCall?.[0]).toBeNull()
    expect(mocks.copilotProps).toMatchObject({
      effectiveParams: null,
      layoutId: null,
      inputDisabled: false,
    })
  })
})
