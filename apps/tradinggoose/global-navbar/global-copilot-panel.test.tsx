/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { seedDashboardColorPairSession } from '@/lib/yjs/dashboard-layout-session'
import { GlobalCopilotPanel } from '@/global-navbar/global-copilot-panel'

const mocks = vi.hoisted(() => ({
  activeLayout: vi.fn(),
  targetSession: vi.fn(),
  copilotProps: null as Record<string, unknown> | null,
  currentContext: null as Record<string, unknown> | null,
}))

vi.mock('@/global-navbar/copilot-context', () => ({
  useGlobalCopilotCurrentContext: () => mocks.currentContext,
}))

vi.mock('@/app/workspace/[workspaceId]/dashboard/use-dashboard-layout-doc', () => ({
  useActiveDashboardLayout: mocks.activeLayout,
}))

vi.mock('@/lib/yjs/use-entity-fields', () => ({
  useYjsTargetSession: mocks.targetSession,
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
    onChange: (color: string) => void
  }) => (
    <button
      type='button'
      data-testid='pair-color'
      data-color={color}
      onClick={() => onChange('blue')}
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
    mocks.activeLayout.mockImplementation((workspaceId: string | null) =>
      workspaceId
        ? {
            id: 'layout-1',
            name: 'Main Dashboard',
            sortOrder: 0,
            isActive: true,
            updatedAt: '2026-01-01T00:00:00.000Z',
          }
        : null
    )
    mocks.targetSession.mockImplementation((descriptor: unknown) => ({
      doc: descriptor ? pairDoc : null,
    }))
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
    mocks.activeLayout.mockReset()
    mocks.targetSession.mockReset()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('opens the dashboard color session only on the dashboard route', async () => {
    await act(async () => {
      root.render(
        <GlobalCopilotPanel workspaceId='ws-1' ownerUserId='user-1' dashboardMode={false} />
      )
    })

    expect(mocks.activeLayout).toHaveBeenLastCalledWith(null, null)
    expect(mocks.targetSession).toHaveBeenLastCalledWith(
      null,
      'read',
      'Failed to open dashboard color pair'
    )
    expect(container.querySelector('[data-testid="pair-color"]')).toBeNull()
    expect(mocks.copilotProps).toMatchObject({
      channelId: 'copilot-ws-1',
      effectiveParams: null,
      layoutId: null,
      ownerUserId: null,
      currentContext: mocks.currentContext,
    })

    await act(async () => {
      root.render(
        <GlobalCopilotPanel workspaceId='ws-1' ownerUserId='user-1' dashboardMode={true} />
      )
    })

    expect(mocks.activeLayout).toHaveBeenLastCalledWith('ws-1', 'user-1')
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
      channelId: 'copilot-ws-1',
      effectiveParams: { workflowId: 'workflow-blue' },
      layoutId: 'layout-1',
      ownerUserId: 'user-1',
      layoutName: 'Main Dashboard',
      currentContext: mocks.currentContext,
    })

    await act(async () => {
      root.render(
        <GlobalCopilotPanel workspaceId='ws-1' ownerUserId='user-1' dashboardMode={false} />
      )
    })

    expect(mocks.activeLayout).toHaveBeenLastCalledWith(null, null)
    expect(mocks.targetSession.mock.lastCall?.[0]).toBeNull()
    expect(container.querySelector('[data-testid="pair-color"]')).toBeNull()
    expect(mocks.copilotProps).toMatchObject({
      effectiveParams: null,
      layoutId: null,
      ownerUserId: null,
      layoutName: null,
    })
  })
})
