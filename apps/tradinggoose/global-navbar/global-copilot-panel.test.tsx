/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GlobalCopilotPanel } from '@/global-navbar/global-copilot-panel'

const mocks = vi.hoisted(() => ({
  pairInput: vi.fn(),
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
    doc: {} as object | null,
    context: { workflowId: 'workflow-blue' },
    isRetrying: false,
    error: null as string | null,
    retry: vi.fn(),
  },
}))

vi.mock('@/global-navbar/copilot-context', () => ({
  useGlobalCopilotCurrentContext: () => mocks.currentContext,
  useGlobalCopilotActiveDashboardLayout: () => mocks.activeLayout,
}))

vi.mock('@/lib/yjs/use-dashboard-color-pair', () => ({
  useDashboardColorPair: (input: Record<string, unknown>) => {
    mocks.pairInput(input)
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

vi.mock('@/lib/copilot/components/copilot-app', () => ({
  CopilotApp: (props: Record<string, unknown>) => {
    mocks.copilotProps = props
    return <div data-testid='copilot-app' />
  },
}))

vi.mock('@/lib/copilot/components/copilot/copilot-header', () => ({
  CopilotHeader: () => <div data-testid='copilot-header' />,
  CopilotHeaderActions: () => <div data-testid='copilot-actions' />,
}))

describe('GlobalCopilotPanel dashboard color boundary', () => {
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
    mocks.activeLayout = {
      id: 'layout-1',
      name: 'Main Dashboard',
      sortOrder: 0,
      isActive: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    mocks.pairSession = {
      doc: {},
      context: { workflowId: 'workflow-blue' },
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
    mocks.pairInput.mockReset()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  const renderPanel = async (dashboardMode: boolean) => {
    await act(async () => {
      root.render(
        <GlobalCopilotPanel workspaceId='ws-1' ownerUserId='user-1' dashboardMode={dashboardMode} />
      )
    })
  }

  it('keeps the color session within the active dashboard route and layout', async () => {
    await renderPanel(true)

    const pairColor = container.querySelector('[data-testid="pair-color"]')
    if (!(pairColor instanceof HTMLButtonElement)) throw new Error('Expected dashboard pair color')
    await act(async () => pairColor.click())

    expect(mocks.pairInput).toHaveBeenLastCalledWith(
      expect.objectContaining({ layoutId: 'layout-1', pairColor: 'blue' })
    )
    expect(mocks.copilotProps).toMatchObject({
      effectiveParams: { workflowId: 'workflow-blue' },
      layoutId: 'layout-1',
      ownerUserId: 'user-1',
      layoutName: 'Main Dashboard',
      currentContext: mocks.currentContext,
      inputDisabled: false,
    })

    await renderPanel(false)

    expect(mocks.pairInput).toHaveBeenLastCalledWith(
      expect.objectContaining({ layoutId: null, pairColor: 'gray' })
    )
    expect(container.querySelector('[data-testid="pair-color"]')).toBeNull()
    expect(mocks.copilotProps).toMatchObject({
      effectiveParams: null,
      layoutId: null,
      ownerUserId: null,
      inputDisabled: false,
    })

    mocks.activeLayout = null
    await renderPanel(true)
    expect(container.querySelector('[data-testid="pair-color"]')).toHaveAttribute(
      'data-color',
      'gray'
    )
    expect(mocks.pairInput).toHaveBeenLastCalledWith(
      expect.objectContaining({ layoutId: null, pairColor: 'gray' })
    )
    expect(mocks.copilotProps).toMatchObject({
      effectiveParams: null,
      layoutId: null,
    })
  })

  it('blocks a selected pair until its document is ready and exposes failure retry', async () => {
    await renderPanel(true)
    const pairColor = container.querySelector('[data-testid="pair-color"]')
    if (!(pairColor instanceof HTMLButtonElement)) throw new Error('Expected dashboard pair color')

    mocks.pairSession = { ...mocks.pairSession, doc: null }
    await act(async () => pairColor.click())
    expect(mocks.copilotProps).toMatchObject({ effectiveParams: null, inputDisabled: true })
    expect(container.querySelector('[role="status"]')).not.toBeNull()

    const retry = vi.fn()
    mocks.pairSession = {
      ...mocks.pairSession,
      doc: null,
      error: 'Pair unavailable',
      retry,
    }
    await renderPanel(true)
    expect(container.querySelector('[role="alert"]')).toHaveTextContent(
      'The shared color settings could not be loaded.'
    )
    const retryButton = container.querySelector('[role="alert"] + button')
    if (!(retryButton instanceof HTMLButtonElement)) throw new Error('Expected retry button')
    await act(async () => retryButton.click())
    expect(retry).toHaveBeenCalledOnce()

    mocks.pairSession = { ...mocks.pairSession, doc: {}, error: null }
    await renderPanel(true)
    expect(mocks.copilotProps).toMatchObject({
      effectiveParams: { workflowId: 'workflow-blue' },
      inputDisabled: false,
    })
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
})
