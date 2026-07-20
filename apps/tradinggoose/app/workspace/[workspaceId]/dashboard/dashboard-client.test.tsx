/**
 * @vitest-environment jsdom
 */

import {
  act,
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  useImperativeHandle,
} from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import {
  seedDashboardColorPairSession,
  seedDashboardLayoutSession,
  seedDashboardWidgetSession,
} from '@/lib/yjs/dashboard-layout-session'
import { DashboardClient } from '@/app/workspace/[workspaceId]/dashboard/dashboard-client'
import type { LayoutTab } from '@/app/workspace/[workspaceId]/dashboard/layout-tabs'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { DashboardLayoutTopologyNode } from '@/widgets/layout-document'
import type { PairColor } from '@/widgets/pair-colors'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const mockPush = vi.fn()
const dashboardClientMocks = vi.hoisted(() => ({
  activateDashboardLayoutAction: vi.fn(() => Promise.resolve()),
  createDashboardLayoutAction: vi.fn(() => Promise.resolve({ layoutId: 'layout-new' })),
  deleteDashboardLayoutAction: vi.fn(() => Promise.resolve()),
  renameSavedEntityAction: vi.fn(() => Promise.resolve()),
  reorderDashboardLayoutsAction: vi.fn(() => Promise.resolve()),
}))
let mockSelectLayout: ((layoutId: string) => void) | null = null
let mockLayoutTabsLayouts: LayoutTab[] = []
let mockLayoutTabsIsBusy = false
let mockLayoutTabsCanMutate = true
let mockDashboardLayoutList: {
  layouts: LayoutTab[]
  isLoading: boolean
  error: unknown
} | null = null
let mockLayoutDocumentLayoutId: string | null = null
let mockTopologyDocuments = new WeakMap<DashboardLayoutTopologyNode, Y.Doc>()
let mockDocuments = new Set<Y.Doc>()
let mockWidgetDocuments = new Map<string, Y.Doc>()
let mockPairDocuments = new Map<string, Y.Doc>()
const mockLayoutMutation = vi.fn(() => Promise.resolve())
const mockSetPanelGroupLayout = vi.fn((sizes: number[]) => {
  mockPanelGroupLayout = sizes
})
let mockPanelGroupLayout: number[] = []
type MockResizeHandleProps = {
  onDragging?: (isDragging: boolean) => void
  onKeyUp?: () => void
}
let mockResizeHandleProps: MockResizeHandleProps | undefined

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('@/lib/branding/branding', () => ({
  useBrandConfig: () => ({
    documentationUrl: 'https://docs.tradinggoose.ai/',
  }),
}))

vi.mock('@/hooks/use-knowledge', () => ({
  useKnowledgeBasesList: () => ({
    knowledgeBases: [],
  }),
}))

vi.mock('@/lib/yjs/use-entity-fields', () => ({
  useEntityList: (kind: string) => ({
    members:
      kind === 'workflow'
        ? ['wf-a', 'wf-b', 'wf-red', 'wf-local', 'wf-current'].map((entityId) => ({
            entityId,
            entityName: entityId,
            createdAt: '2026-01-01T00:00:00.000Z',
          }))
        : [],
    isLoading: false,
    error: null,
  }),
  useYjsTargetSession: (descriptor: { entityKind: string; entityId: string } | null) => ({
    result: null,
    doc:
      descriptor?.entityKind === 'dashboard_widget'
        ? (mockWidgetDocuments.get(descriptor.entityId) ?? null)
        : descriptor?.entityKind === 'dashboard_color_pair'
          ? (mockPairDocuments.get(descriptor.entityId) ?? null)
          : null,
    isLoading: false,
    error: null,
  }),
}))

vi.mock('@/app/workspace/[workspaceId]/dashboard/actions', () => ({
  activateDashboardLayoutAction: dashboardClientMocks.activateDashboardLayoutAction,
  createDashboardLayoutAction: dashboardClientMocks.createDashboardLayoutAction,
  deleteDashboardLayoutAction: dashboardClientMocks.deleteDashboardLayoutAction,
  reorderDashboardLayoutsAction: dashboardClientMocks.reorderDashboardLayoutsAction,
}))
vi.mock('@/lib/saved-entities/actions', () => ({
  renameSavedEntityAction: dashboardClientMocks.renameSavedEntityAction,
}))

vi.mock('@/widgets/utils/watchlist-yjs', () => ({
  useWatchlistYjsDocument: () => ({
    items: [],
    record: {
      id: 'ws-a',
      workspaceId: 'ws-a',
      name: 'Watchlist',
      items: [],
      settings: { showLogo: true, showTicker: true, showDescription: true },
      createdAt: '',
      updatedAt: '',
    },
    isLoading: false,
    error: null,
  }),
}))

vi.mock('@/app/workspace/[workspaceId]/dashboard/use-dashboard-layout-doc', async () => {
  return {
    useDashboardLayoutList: (workspaceId: string) =>
      mockDashboardLayoutList ?? {
        layouts: createLayouts(workspaceId === 'ws-b' ? 'layout-b' : 'layout-a'),
        isLoading: false,
        error: null,
      },
    useDashboardLayoutDocument: ({
      layoutId,
      initialTopology,
    }: {
      layoutId?: string | null
      initialTopology?: DashboardLayoutTopologyNode | null
    }) => {
      mockLayoutDocumentLayoutId = layoutId ?? null
      const doc = initialTopology ? (mockTopologyDocuments.get(initialTopology) ?? null) : null
      return {
        doc,
        topology: initialTopology ?? null,
        isLoading: false,
        error: null,
        mutateStructure: mockLayoutMutation,
      }
    },
  }
})

vi.mock('@/global-navbar', () => ({
  GlobalNavbarHeader: ({ center }: { center?: ReactNode }) => <>{center}</>,
}))

vi.mock('@/app/workspace/[workspaceId]/dashboard/layout-tabs', () => ({
  LayoutTabs: ({
    layouts,
    onSelect,
    isBusy,
    canMutate,
  }: {
    layouts: LayoutTab[]
    onSelect: (layoutId: string) => void
    isBusy: boolean
    canMutate: boolean
  }) => {
    mockLayoutTabsLayouts = layouts
    mockLayoutTabsIsBusy = isBusy
    mockLayoutTabsCanMutate = canMutate
    mockSelectLayout = onSelect
    return <div data-testid='layout-tabs' />
  },
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: forwardRef(function MockResizablePanelGroup(
    { children }: { children: ReactNode },
    ref
  ) {
    useImperativeHandle(ref, () => ({
      getLayout: () => mockPanelGroupLayout,
      setLayout: mockSetPanelGroupLayout,
    }))
    return <div>{children}</div>
  }),
  ResizablePanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizableHandle: (props: MockResizeHandleProps) => {
    mockResizeHandleProps = props
    return null
  },
}))

vi.mock('@/widgets/widget-surface', async () => {
  const { useDashboardWidgetRenderState } = await import('@/widgets/widget-config-runtime')

  return {
    WidgetSurface: ({
      context,
      panelId,
      onPairColorChange,
      onPanelClose,
      onWidgetChange,
    }: {
      context?: {
        workspaceId?: string
        dashboardLayoutId?: string
        dashboardLayoutName?: string
        dashboardLayoutOwnerUserId?: string
      }
      panelId?: string
      onPairColorChange?: (color: PairColor) => void
      onPanelClose?: () => void
      onWidgetChange?: (widgetKey: string) => void
    }) => {
      const { renderWidget } = useDashboardWidgetRenderState()
      const pairColor = (renderWidget?.pairColor ?? 'gray') as PairColor

      return (
        <div>
          <div
            data-testid={`widget-surface-${panelId ?? 'panel'}`}
            data-pair-color={pairColor}
            data-workflow-id={String(renderWidget?.params?.workflowId ?? '')}
            data-watchlist-id={String(renderWidget?.params?.watchlistId ?? '')}
            data-workspace-id={context?.workspaceId ?? ''}
            data-dashboard-layout-id={context?.dashboardLayoutId ?? ''}
            data-dashboard-layout-name={context?.dashboardLayoutName ?? ''}
            data-dashboard-layout-owner-user-id={context?.dashboardLayoutOwnerUserId ?? ''}
          />
          <button
            type='button'
            data-testid={`pair-color-red-${panelId ?? 'panel'}`}
            disabled={!onPairColorChange}
            onClick={() => onPairColorChange?.('red')}
          />
          <button
            type='button'
            data-testid={`pair-color-blue-${panelId ?? 'panel'}`}
            disabled={!onPairColorChange}
            onClick={() => onPairColorChange?.('blue')}
          />
          <button
            type='button'
            data-testid={`close-panel-${panelId ?? 'panel'}`}
            disabled={!onPanelClose}
            onClick={() => onPanelClose?.()}
          />
          <button
            type='button'
            data-testid={`widget-watchlist-${panelId ?? 'panel'}`}
            disabled={!onWidgetChange}
            onClick={() => onWidgetChange?.('watchlist')}
          />
        </div>
      )
    },
  }
})

describe('DashboardClient', () => {
  let container: HTMLDivElement
  let root: Root

  function renderDashboard({
    topology,
    workspaceId = 'ws-a',
    ownerUserId = 'user-a',
    layoutId = 'layout-a',
  }: {
    topology: DashboardLayoutTopologyNode
    workspaceId?: string
    ownerUserId?: string
    layoutId?: string
  }) {
    root.render(
      <DashboardClient
        initialTopology={topology}
        workspaceId={workspaceId}
        ownerUserId={ownerUserId}
        layoutId={layoutId}
        initialLayouts={createLayouts(layoutId)}
      />
    )
  }

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockPush.mockReset()
    mockSelectLayout = null
    mockLayoutTabsLayouts = []
    mockLayoutTabsIsBusy = false
    mockLayoutTabsCanMutate = true
    mockDashboardLayoutList = null
    mockLayoutDocumentLayoutId = null
    mockTopologyDocuments = new WeakMap()
    mockDocuments = new Set()
    mockWidgetDocuments = new Map()
    mockPairDocuments = new Map()
    for (const color of ['red', 'blue']) {
      const pairDoc = new Y.Doc()
      seedDashboardColorPairSession(pairDoc, {})
      mockPairDocuments.set(color, pairDoc)
      mockDocuments.add(pairDoc)
    }
    mockLayoutMutation.mockClear()
    mockSetPanelGroupLayout.mockClear()
    mockPanelGroupLayout = []
    mockResizeHandleProps = undefined
    dashboardClientMocks.activateDashboardLayoutAction.mockReset()
    dashboardClientMocks.activateDashboardLayoutAction.mockResolvedValue(undefined)
    dashboardClientMocks.createDashboardLayoutAction.mockClear()
    dashboardClientMocks.deleteDashboardLayoutAction.mockClear()
    resetDashboardStores()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ workspaces: [] }),
      }))
    )
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    for (const doc of mockDocuments) doc.destroy()
    container.remove()
    vi.unstubAllGlobals()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('rebinds widget data and runtime context when the dashboard identity changes', async () => {
    await act(async () => {
      renderDashboard({ topology: createPanelLayout('panel-a', 'wf-a') })
    })

    expect(readWidgetSurface(container)).toEqual({
      workflowId: 'wf-a',
      watchlistId: '',
      workspaceId: 'ws-a',
      pairColor: 'gray',
    })
    expect(readWidgetRuntimeContext(container)).toEqual({
      dashboardLayoutId: 'layout-a',
      dashboardLayoutName: 'Layout A',
      dashboardLayoutOwnerUserId: 'user-a',
    })

    await act(async () => {
      renderDashboard({
        topology: createPanelLayout('panel-b', 'wf-b'),
        workspaceId: 'ws-b',
        ownerUserId: 'user-b',
        layoutId: 'layout-b',
      })
    })

    expect(readWidgetSurface(container)).toEqual({
      workflowId: 'wf-b',
      watchlistId: '',
      workspaceId: 'ws-b',
      pairColor: 'gray',
    })
    expect(readWidgetRuntimeContext(container)).toEqual({
      dashboardLayoutId: 'layout-b',
      dashboardLayoutName: 'Layout B',
      dashboardLayoutOwnerUserId: 'user-b',
    })
  })

  it('keeps personal widget controls independent of workspace entity permission', async () => {
    await act(async () => {
      renderDashboard({ topology: createPanelLayout('panel-a', 'wf-a') })
    })

    const switchToRedButton = container.querySelector('[data-testid="pair-color-red-panel-a"]')
    if (!(switchToRedButton instanceof HTMLButtonElement)) {
      throw new Error('Expected pair color switch button to be rendered')
    }

    expect(switchToRedButton.disabled).toBe(false)
    await act(async () => {
      switchToRedButton.click()
    })
    expect(readWidgetSurface(container, 'panel-a')).toEqual({
      workflowId: '',
      watchlistId: '',
      workspaceId: 'ws-a',
      pairColor: 'red',
    })
  })

  it('applies remote sizes and persists only completed local resizes', async () => {
    mockPanelGroupLayout = [50, 50]
    await act(async () => {
      renderDashboard({ topology: createGroupLayout([50, 50]) })
    })
    expect(mockSetPanelGroupLayout).not.toHaveBeenCalled()

    await act(async () => {
      renderDashboard({ topology: createGroupLayout([35, 65]) })
    })

    expect(mockSetPanelGroupLayout).toHaveBeenCalledWith([35, 65])
    expect(mockLayoutMutation).not.toHaveBeenCalled()

    act(() => {
      mockResizeHandleProps?.onDragging?.(true)
      mockPanelGroupLayout = [25, 75]
    })
    expect(mockLayoutMutation).not.toHaveBeenCalled()

    mockPanelGroupLayout = [25, 75]
    act(() => mockResizeHandleProps?.onDragging?.(false))
    expect(mockLayoutMutation).toHaveBeenCalledTimes(1)

    mockPanelGroupLayout = [40, 60]
    act(() => mockResizeHandleProps?.onKeyUp?.())
    expect(mockLayoutMutation.mock.calls).toEqual([
      [{ type: 'resize', groupId: 'group-a', sizes: [25, 75] }],
      [{ type: 'resize', groupId: 'group-a', sizes: [40, 60] }],
    ])
  })

  it('handles rejected panel structural actions at the client boundary', async () => {
    const closeError = new Error('panel disappeared')
    const replaceError = new Error('panel disappeared')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockLayoutMutation.mockRejectedValueOnce(closeError).mockRejectedValueOnce(replaceError)
    try {
      await act(async () => {
        renderDashboard({ topology: createGroupLayout([50, 50]) })
      })

      const closePanel = container.querySelector('[data-testid="close-panel-panel-left"]')
      if (!(closePanel instanceof HTMLButtonElement)) throw new Error('Expected panel close button')
      const replacePanel = container.querySelector('[data-testid="widget-watchlist-panel-left"]')
      if (!(replacePanel instanceof HTMLButtonElement)) {
        throw new Error('Expected panel replacement button')
      }
      await act(async () => {
        closePanel.click()
        replacePanel.click()
        await Promise.resolve()
      })

      expect(mockLayoutMutation).toHaveBeenCalledWith({ type: 'close', panelId: 'panel-left' })
      expect(mockLayoutMutation).toHaveBeenCalledWith({
        type: 'replace',
        panelId: 'panel-left',
        widgetKey: 'watchlist',
      })
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to update dashboard layout structure:',
        closeError
      )
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to update dashboard layout structure:',
        replaceError
      )
    } finally {
      consoleError.mockRestore()
    }
  })

  it('does not carry a pending activation across repeated server selections', async () => {
    let resolveActivation!: () => void
    dashboardClientMocks.activateDashboardLayoutAction.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveActivation = resolve
      })
    )
    await act(async () => {
      renderDashboard({ topology: createPanelLayout('panel-a', 'wf-a') })
    })

    await act(async () => {
      mockSelectLayout?.('layout-b')
    })
    expect(mockLayoutTabsIsBusy).toBe(true)

    await act(async () => {
      renderDashboard({
        topology: createPanelLayout('panel-b', 'wf-b'),
        layoutId: 'layout-b',
      })
    })

    expect(mockLayoutDocumentLayoutId).toBe('layout-b')
    expect(mockLayoutTabsIsBusy).toBe(false)

    await act(async () => {
      renderDashboard({
        topology: createPanelLayout('panel-a', 'wf-a'),
        layoutId: 'layout-a',
      })
    })

    expect(mockLayoutDocumentLayoutId).toBe('layout-a')
    expect(mockLayoutTabsIsBusy).toBe(false)

    await act(async () => resolveActivation())
    expect(mockLayoutDocumentLayoutId).toBe('layout-a')
    expect(mockLayoutTabsIsBusy).toBe(false)
  })

  it('selects the target immediately and keeps it after activation settles', async () => {
    let resolveActivation!: () => void
    dashboardClientMocks.activateDashboardLayoutAction.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveActivation = resolve
      })
    )
    await act(async () => {
      renderDashboard({ topology: createPanelLayout('panel-a', 'wf-a') })
    })

    await act(async () => {
      void mockSelectLayout?.('layout-b')
      await Promise.resolve()
    })

    expect(mockLayoutDocumentLayoutId).toBe('layout-b')
    expect(mockLayoutTabsIsBusy).toBe(true)
    expect(mockLayoutTabsLayouts).toEqual(createLayouts('layout-b'))

    await act(async () => resolveActivation())
    expect(mockLayoutTabsIsBusy).toBe(false)
    expect(mockLayoutDocumentLayoutId).toBe('layout-b')
    expect(mockLayoutTabsLayouts).toEqual(createLayouts('layout-b'))
  })

  it('rolls back the scoped selection when activation rejects', async () => {
    dashboardClientMocks.activateDashboardLayoutAction.mockRejectedValueOnce(
      new Error('activation failed')
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await act(async () => {
      renderDashboard({ topology: createPanelLayout('panel-a', 'wf-a') })
      mockSelectLayout?.('layout-b')
      await Promise.resolve()
    })

    expect(mockLayoutTabsIsBusy).toBe(false)
    expect(mockLayoutDocumentLayoutId).toBe('layout-a')
    expect(mockLayoutTabsLayouts).toEqual(createLayouts('layout-a'))
    consoleError.mockRestore()
  })

  it('keeps a ready selected layout independent of entity-list failure', async () => {
    mockDashboardLayoutList = {
      layouts: createLayouts('layout-a'),
      isLoading: false,
      error: new Error('layout list unavailable'),
    }

    await act(async () => {
      renderDashboard({ topology: createGroupLayout([50, 50]) })
    })

    expect(mockLayoutTabsCanMutate).toBe(false)
    const closePanel = container.querySelector('[data-testid="close-panel-panel-left"]')
    if (!(closePanel instanceof HTMLButtonElement)) throw new Error('Expected panel close control')
    expect(closePanel.disabled).toBe(false)
    await act(async () => closePanel.click())
    expect(mockLayoutMutation).toHaveBeenCalledWith({ type: 'close', panelId: 'panel-left' })
  })
})

function createPanelLayout(
  panelId: string,
  workflowId: string,
  pairColor: PairColor = 'gray'
): DashboardLayoutTopologyNode {
  const topology: DashboardLayoutTopologyNode = {
    id: panelId,
    type: 'panel',
    identityId: `${panelId}-widget`,
    widgetKey: 'editor_workflow',
  }
  const doc = new Y.Doc()
  seedDashboardLayoutSession(doc, {
    layout: topology,
  })
  const widgetDoc = new Y.Doc()
  seedDashboardWidgetSession(widgetDoc, { pairColor, params: { workflowId } })
  mockWidgetDocuments.set(`${panelId}-widget`, widgetDoc)
  mockDocuments.add(widgetDoc)
  mockTopologyDocuments.set(topology, doc)
  mockDocuments.add(doc)
  return topology
}

function createGroupLayout(sizes: number[]): DashboardLayoutTopologyNode {
  const topology: DashboardLayoutTopologyNode = {
    id: 'group-a',
    type: 'group',
    direction: 'horizontal',
    sizes,
    children: [
      {
        id: 'panel-left',
        type: 'panel',
        identityId: 'widget-left',
        widgetKey: 'copilot',
      },
      {
        id: 'panel-right',
        type: 'panel',
        identityId: 'widget-right',
        widgetKey: 'copilot',
      },
    ],
  }
  const doc = new Y.Doc()
  seedDashboardLayoutSession(doc, {
    layout: topology,
  })
  for (const identityId of ['widget-left', 'widget-right']) {
    const widgetDoc = new Y.Doc()
    seedDashboardWidgetSession(widgetDoc, { pairColor: 'gray', params: null })
    mockWidgetDocuments.set(identityId, widgetDoc)
    mockDocuments.add(widgetDoc)
  }
  mockTopologyDocuments.set(topology, doc)
  mockDocuments.add(doc)
  return topology
}

function resetDashboardStores() {
  useWorkflowRegistry.setState({
    workflows: {},
    activeWorkflowIds: {},
    loadedWorkflowIds: {},
    hydrationByChannel: {},
    deploymentStatuses: {},
    isLoading: false,
    error: null,
  })
}

function createLayouts(layoutId: string): LayoutTab[] {
  return [
    {
      id: 'layout-a',
      name: 'Layout A',
      sortOrder: 0,
      isActive: layoutId === 'layout-a',
    },
    {
      id: 'layout-b',
      name: 'Layout B',
      sortOrder: 1,
      isActive: layoutId === 'layout-b',
    },
  ]
}

function readWidgetSurface(container: HTMLDivElement, panelId?: string) {
  const selector = panelId
    ? `[data-testid="widget-surface-${panelId}"]`
    : '[data-testid^="widget-surface-"]'
  const element = container.querySelector(selector)
  if (!(element instanceof HTMLElement)) {
    throw new Error('Expected widget surface to be rendered')
  }

  return {
    workflowId: element.dataset.workflowId ?? '',
    watchlistId: element.dataset.watchlistId ?? '',
    workspaceId: element.dataset.workspaceId ?? '',
    pairColor: element.dataset.pairColor ?? 'gray',
  }
}

function readWidgetRuntimeContext(container: HTMLDivElement, panelId?: string) {
  const selector = panelId
    ? `[data-testid="widget-surface-${panelId}"]`
    : '[data-testid^="widget-surface-"]'
  const element = container.querySelector(selector)
  if (!(element instanceof HTMLElement)) {
    throw new Error('Expected widget surface to be rendered')
  }

  return {
    dashboardLayoutId: element.dataset.dashboardLayoutId ?? '',
    dashboardLayoutName: element.dataset.dashboardLayoutName ?? '',
    dashboardLayoutOwnerUserId: element.dataset.dashboardLayoutOwnerUserId ?? '',
  }
}
