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
import type { DashboardLayoutTab } from '@/lib/dashboard-layouts/operations'
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

let mockLayoutTabsLayouts: LayoutTab[] = []
let mockDashboardLayoutList: {
  layouts: DashboardLayoutTab[]
  hasLiveSnapshot: boolean
  isLoading: boolean
  error: unknown
} | null = null
let mockLayoutDocumentLayoutId: string | null = null
let mockTopologyDocuments = new WeakMap<DashboardLayoutTopologyNode, Y.Doc>()
let mockLayoutTopologies = new Map<string, DashboardLayoutTopologyNode>()
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
    push: vi.fn(),
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
  useEntityList: (kind: string, workspaceId: string) => {
    if (kind === 'dashboard_layout') {
      const list = mockDashboardLayoutList ?? {
        layouts: createLayouts(workspaceId === 'ws-b' ? 'layout-b' : 'layout-a'),
        hasLiveSnapshot: true,
        isLoading: false,
        error: null,
      }
      return {
        ...list,
        members: list.layouts.map((layout, sortOrder) => ({
          entityId: layout.id,
          entityName: layout.name,
          sortOrder,
          isActive: layout.isActive,
          updatedAt: layout.updatedAt,
        })),
      }
    }
    return {
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
    }
  },
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

vi.mock(
  '@/app/workspace/[workspaceId]/dashboard/use-dashboard-layout-doc',
  async (importOriginal) => {
    return {
      ...(await importOriginal()),
      useDashboardLayoutDocument: ({
        layoutId,
        initialTopology,
      }: {
        layoutId?: string | null
        initialTopology?: DashboardLayoutTopologyNode | null
      }) => {
        mockLayoutDocumentLayoutId = layoutId ?? null
        const topology =
          initialTopology ?? (layoutId ? (mockLayoutTopologies.get(layoutId) ?? null) : null)
        const doc = topology ? (mockTopologyDocuments.get(topology) ?? null) : null
        return {
          doc,
          topology,
          isLoading: false,
          error: null,
          mutateStructure: mockLayoutMutation,
        }
      },
    }
  }
)

vi.mock('@/global-navbar', () => ({
  GlobalNavbarHeader: ({ center }: { center?: ReactNode }) => <>{center}</>,
}))

vi.mock('@/app/workspace/[workspaceId]/dashboard/layout-tabs', () => ({
  LayoutTabs: ({ layouts }: { layouts: LayoutTab[] }) => {
    mockLayoutTabsLayouts = layouts
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

  async function renderDashboard({
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
    await act(async () => {
      root.render(
        <DashboardClient
          initialTopology={topology}
          workspaceId={workspaceId}
          ownerUserId={ownerUserId}
          layoutId={layoutId}
          initialLayouts={createLayouts(layoutId)}
        />
      )
    })
  }

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.clearAllMocks()
    mockLayoutTabsLayouts = []
    mockDashboardLayoutList = null
    mockLayoutDocumentLayoutId = null
    mockTopologyDocuments = new WeakMap()
    mockLayoutTopologies = new Map()
    mockDocuments = new Set()
    mockWidgetDocuments = new Map()
    mockPairDocuments = new Map()
    for (const color of ['red', 'blue']) {
      const pairDoc = new Y.Doc()
      seedDashboardColorPairSession(pairDoc, {})
      mockPairDocuments.set(color, pairDoc)
      mockDocuments.add(pairDoc)
    }
    mockPanelGroupLayout = []
    mockResizeHandleProps = undefined
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
    await renderDashboard({ topology: createPanelLayout('panel-a', 'wf-a') })

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

    await renderDashboard({
      topology: createPanelLayout('panel-b', 'wf-b'),
      workspaceId: 'ws-b',
      ownerUserId: 'user-b',
      layoutId: 'layout-b',
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
    await renderDashboard({ topology: createPanelLayout('panel-a', 'wf-a') })

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
    await renderDashboard({ topology: createGroupLayout([50, 50]) })
    expect(mockSetPanelGroupLayout).not.toHaveBeenCalled()

    await renderDashboard({ topology: createGroupLayout([35, 65]) })

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
      await renderDashboard({ topology: createGroupLayout([50, 50]) })

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

  it('follows the live active layout when another client activates and deletes the previous one', async () => {
    const layoutA = createPanelLayout('panel-a', 'wf-a')
    const layoutB = createPanelLayout('panel-b', 'wf-b')
    mockLayoutTopologies.set('layout-b', layoutB)
    await renderDashboard({ topology: layoutA })

    mockDashboardLayoutList = {
      layouts: createLayouts('layout-b'),
      hasLiveSnapshot: true,
      isLoading: false,
      error: null,
    }
    await renderDashboard({ topology: layoutA })

    expect(mockLayoutDocumentLayoutId).toBe('layout-b')
    expect(mockLayoutTabsLayouts).toEqual(createLayouts('layout-b'))
    expect(readWidgetRuntimeContext(container)).toEqual({
      dashboardLayoutId: 'layout-b',
      dashboardLayoutName: 'Layout B',
      dashboardLayoutOwnerUserId: 'user-a',
    })

    mockDashboardLayoutList = {
      layouts: createLayouts('layout-b').filter((layout) => layout.id !== 'layout-a'),
      hasLiveSnapshot: true,
      isLoading: false,
      error: null,
    }
    await renderDashboard({ topology: layoutA })

    expect(mockLayoutDocumentLayoutId).toBe('layout-b')
    expect(mockLayoutTabsLayouts).toEqual([{ ...createLayouts('layout-b')[1]!, sortOrder: 0 }])
    expect(container.querySelector('[data-testid="dashboard-layout-document-state"]')).toBeNull()
  })

  it('keeps the layout ready when the live layout list is unavailable', async () => {
    mockDashboardLayoutList = {
      layouts: [],
      hasLiveSnapshot: false,
      isLoading: false,
      error: new Error('layout list unavailable'),
    }

    await renderDashboard({ topology: createGroupLayout([50, 50]) })

    const closePanel = container.querySelector('[data-testid="close-panel-panel-left"]')
    if (!(closePanel instanceof HTMLButtonElement)) throw new Error('Expected panel close control')
    expect(closePanel.disabled).toBe(false)
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

const revision = (value: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, value)).toISOString()

function createLayouts(layoutId: string, updatedRevision = 0): DashboardLayoutTab[] {
  return [
    {
      id: 'layout-a',
      name: 'Layout A',
      sortOrder: 0,
      isActive: layoutId === 'layout-a',
      updatedAt: revision(updatedRevision),
    },
    {
      id: 'layout-b',
      name: 'Layout B',
      sortOrder: 1,
      isActive: layoutId === 'layout-b',
      updatedAt: revision(updatedRevision),
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
