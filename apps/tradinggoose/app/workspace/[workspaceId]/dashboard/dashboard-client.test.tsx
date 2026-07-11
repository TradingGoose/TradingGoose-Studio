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
import { seedDashboardLayoutSession } from '@/lib/yjs/dashboard-layout-session'
import { DashboardClient } from '@/app/workspace/[workspaceId]/dashboard/dashboard-client'
import type { LayoutTab } from '@/app/workspace/[workspaceId]/dashboard/layout-tabs'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { DashboardLayoutTopologyNode } from '@/widgets/layout-document'
import type { PairColor } from '@/widgets/pair-colors'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const mockPush = vi.fn()
const mockReplace = vi.fn()
const dashboardClientMocks = vi.hoisted(() => ({
  activateDashboardLayoutAction: vi.fn(() => Promise.resolve()),
  createDashboardLayoutAction: vi.fn(() => Promise.resolve({ layoutId: 'layout-new' })),
  deleteDashboardLayoutAction: vi.fn(() => Promise.resolve()),
  renameSavedEntityAction: vi.fn(() => Promise.resolve()),
  reorderDashboardLayoutAction: vi.fn(() => Promise.resolve()),
}))
let mockPathname = '/workspace/ws-a/dashboard'
let mockSearchParams = 'panel=left'
let mockSelectLayout: ((layoutId: string) => void) | null = null
let mockLayoutTabsLayouts: LayoutTab[] = []
let mockDashboardLayoutList: {
  layouts: LayoutTab[]
  isLoading: boolean
  error: unknown
} | null = null
let mockTopologyDocuments = new WeakMap<DashboardLayoutTopologyNode, Y.Doc>()
let mockDocuments = new Set<Y.Doc>()
const mockLayoutMutation = vi.fn()
const mockSetPanelGroupLayout = vi.fn((sizes: number[]) => {
  mockPanelGroupLayout = sizes
})
let mockPanelGroupLayout: number[] = []
const dashboardPermissions = {
  workspaceCanWrite: true,
} as const

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearchParams),
}))

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
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
}))

vi.mock('@/app/workspace/[workspaceId]/dashboard/actions', () => ({
  activateDashboardLayoutAction: dashboardClientMocks.activateDashboardLayoutAction,
  createDashboardLayoutAction: dashboardClientMocks.createDashboardLayoutAction,
  deleteDashboardLayoutAction: dashboardClientMocks.deleteDashboardLayoutAction,
  reorderDashboardLayoutAction: dashboardClientMocks.reorderDashboardLayoutAction,
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
      initialTopology,
    }: {
      initialTopology?: DashboardLayoutTopologyNode | null
    }) => {
      const doc = initialTopology ? (mockTopologyDocuments.get(initialTopology) ?? null) : null
      return {
        doc,
        topology: initialTopology ?? null,
        isProviderReady: Boolean(doc),
        isLoading: false,
        error: null,
        updateGroupSizes: mockLayoutMutation,
        splitPanel: mockLayoutMutation,
        closePanel: mockLayoutMutation,
        replacePanelWidget: mockLayoutMutation,
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
  }: {
    layouts: LayoutTab[]
    onSelect: (layoutId: string) => void
  }) => {
    mockLayoutTabsLayouts = layouts
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
  ResizableHandle: () => null,
}))

vi.mock('@/widgets/widget-surface', async () => {
  const { useDashboardWidgetRenderConfig } = await import('@/widgets/widget-config-runtime')

  return {
    WidgetSurface: ({
      context,
      panelId,
      onPairColorChange,
      onWidgetChange,
    }: {
      context?: {
        workspaceId?: string
        dashboardLayoutId?: string
        dashboardLayoutName?: string
        dashboardLayoutOwnerUserId?: string
        canWrite?: boolean
      }
      panelId?: string
      onPairColorChange?: (color: PairColor) => void
      onWidgetChange?: (widgetKey: string) => void
    }) => {
      const renderWidget = useDashboardWidgetRenderConfig()
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
            data-can-write={String(context?.canWrite ?? '')}
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

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockPush.mockReset()
    mockReplace.mockReset()
    mockPathname = '/workspace/ws-a/dashboard'
    mockSearchParams = 'panel=left'
    mockSelectLayout = null
    mockLayoutTabsLayouts = []
    mockDashboardLayoutList = null
    mockTopologyDocuments = new WeakMap()
    mockDocuments = new Set()
    mockLayoutMutation.mockClear()
    mockSetPanelGroupLayout.mockClear()
    mockPanelGroupLayout = []
    dashboardClientMocks.activateDashboardLayoutAction.mockClear()
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

  it('replaces stale widget workflow params when the dashboard identity changes', async () => {
    await act(async () => {
      root.render(
        <DashboardClient
          initialTopology={createPanelLayout('panel-a', 'wf-a')}
          workspaceId='ws-a'
          ownerUserId='user-a'
          layoutId='layout-a'
          initialLayouts={createLayouts('layout-a')}
          {...dashboardPermissions}
        />
      )
    })

    expect(readWidgetSurface(container)).toEqual({
      workflowId: 'wf-a',
      watchlistId: '',
      workspaceId: 'ws-a',
      pairColor: 'gray',
    })

    mockPathname = '/workspace/ws-b/dashboard'

    await act(async () => {
      root.render(
        <DashboardClient
          initialTopology={createPanelLayout('panel-b', 'wf-b')}
          workspaceId='ws-b'
          ownerUserId='user-b'
          layoutId='layout-b'
          initialLayouts={createLayouts('layout-b')}
          {...dashboardPermissions}
        />
      )
    })

    expect(readWidgetSurface(container)).toEqual({
      workflowId: 'wf-b',
      watchlistId: '',
      workspaceId: 'ws-b',
      pairColor: 'gray',
    })
  })

  it('propagates dashboard runtime context changes through the dashboard node boundary', async () => {
    await act(async () => {
      root.render(
        <DashboardClient
          initialTopology={createPanelLayout('panel-a', 'wf-a')}
          workspaceId='ws-a'
          ownerUserId='user-a'
          layoutId='layout-a'
          initialLayouts={createLayouts('layout-a')}
          {...dashboardPermissions}
        />
      )
    })

    expect(readWidgetRuntimeContext(container)).toEqual({
      dashboardLayoutId: 'layout-a',
      dashboardLayoutName: 'Layout A',
      dashboardLayoutOwnerUserId: 'user-a',
      canWrite: true,
    })

    await act(async () => {
      root.render(
        <DashboardClient
          initialTopology={createPanelLayout('panel-a', 'wf-a')}
          workspaceId='ws-b'
          ownerUserId='user-b'
          layoutId='layout-b'
          initialLayouts={createLayouts('layout-b')}
          {...dashboardPermissions}
        />
      )
    })

    expect(readWidgetRuntimeContext(container)).toEqual({
      dashboardLayoutId: 'layout-b',
      dashboardLayoutName: 'Layout B',
      dashboardLayoutOwnerUserId: 'user-b',
      canWrite: true,
    })
  })

  it('keeps personal layout controls writable for workspace readers', async () => {
    await act(async () => {
      root.render(
        <DashboardClient
          initialTopology={createPanelLayout('panel-a', 'wf-a')}
          workspaceId='ws-a'
          ownerUserId='user-a'
          layoutId='layout-a'
          initialLayouts={createLayouts('layout-a')}
          workspaceCanWrite={false}
        />
      )
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
    expect(readWidgetRuntimeContext(container).canWrite).toBe(false)
  })

  it('applies remote group-size changes to the mounted panel group', async () => {
    mockPanelGroupLayout = [50, 50]
    await act(async () => {
      root.render(
        <DashboardClient
          initialTopology={createGroupLayout([50, 50])}
          workspaceId='ws-a'
          ownerUserId='user-a'
          layoutId='layout-a'
          initialLayouts={createLayouts('layout-a')}
          {...dashboardPermissions}
        />
      )
    })
    expect(mockSetPanelGroupLayout).not.toHaveBeenCalled()

    await act(async () => {
      root.render(
        <DashboardClient
          initialTopology={createGroupLayout([35, 65])}
          workspaceId='ws-a'
          ownerUserId='user-a'
          layoutId='layout-a'
          initialLayouts={createLayouts('layout-a')}
          {...dashboardPermissions}
        />
      )
    })

    expect(mockSetPanelGroupLayout).toHaveBeenCalledWith([35, 65])
    expect(mockLayoutMutation).not.toHaveBeenCalled()
  })

  it('routes widget selection through the layout document owner', async () => {
    await act(async () => {
      root.render(
        <DashboardClient
          initialTopology={createPanelLayout('panel-a', 'wf-a')}
          workspaceId='ws-a'
          ownerUserId='user-a'
          layoutId='layout-a'
          initialLayouts={createLayouts('layout-a')}
          {...dashboardPermissions}
        />
      )
    })

    const selectWatchlist = container.querySelector('[data-testid="widget-watchlist-panel-a"]')
    if (!(selectWatchlist instanceof HTMLButtonElement)) {
      throw new Error('Expected widget selector button')
    }
    await act(async () => selectWatchlist.click())

    expect(mockLayoutMutation).toHaveBeenCalledWith('panel-a', 'watchlist')
  })

  it('keeps the current layout stable while switching active layout metadata', async () => {
    await act(async () => {
      root.render(
        <DashboardClient
          initialTopology={createPanelLayout('panel-a', 'wf-a')}
          workspaceId='ws-a'
          ownerUserId='user-a'
          layoutId='layout-a'
          initialLayouts={createLayouts('layout-a')}
          {...dashboardPermissions}
        />
      )
    })

    if (!mockSelectLayout) {
      throw new Error('Expected layout select handler to be captured')
    }

    await act(async () => {
      mockSelectLayout?.('layout-b')
      await Promise.resolve()
    })

    await act(async () => {
      mockSelectLayout?.('layout-a')
      await Promise.resolve()
    })

    expect(dashboardClientMocks.activateDashboardLayoutAction).toHaveBeenCalledTimes(1)
    expect(dashboardClientMocks.activateDashboardLayoutAction).toHaveBeenCalledWith(
      'ws-a',
      'layout-b'
    )
    expect(readWidgetSurface(container)).toEqual({
      workflowId: 'wf-a',
      watchlistId: '',
      workspaceId: 'ws-a',
      pairColor: 'gray',
    })
  })

  it('does not write selected layout identity into the dashboard URL', async () => {
    mockDashboardLayoutList = {
      layouts: createLayouts('layout-a'),
      isLoading: false,
      error: null,
    }

    await act(async () => {
      root.render(
        <DashboardClient
          initialTopology={createPanelLayout('panel-a', 'wf-a')}
          workspaceId='ws-a'
          ownerUserId='user-a'
          layoutId='layout-a'
          initialLayouts={createLayouts('layout-a')}
          {...dashboardPermissions}
        />
      )
    })

    if (!mockSelectLayout) {
      throw new Error('Expected layout select handler to be captured')
    }

    await act(async () => {
      mockSelectLayout?.('layout-b')
      await Promise.resolve()
    })

    expect(dashboardClientMocks.activateDashboardLayoutAction).toHaveBeenCalledWith(
      'ws-a',
      'layout-b'
    )
    expect(mockReplace).not.toHaveBeenCalled()

    mockDashboardLayoutList = {
      layouts: createLayouts('layout-b'),
      isLoading: false,
      error: null,
    }

    await act(async () => {
      root.render(
        <DashboardClient
          initialTopology={createPanelLayout('panel-a', 'wf-a')}
          workspaceId='ws-a'
          ownerUserId='user-a'
          layoutId='layout-a'
          initialLayouts={createLayouts('layout-a')}
          {...dashboardPermissions}
        />
      )
    })

    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('removes stale layout identity from the dashboard URL', async () => {
    mockSearchParams = 'layoutId=layout-b&panel=left'
    mockDashboardLayoutList = {
      layouts: createLayouts('layout-b'),
      isLoading: false,
      error: null,
    }

    await act(async () => {
      root.render(
        <DashboardClient
          initialTopology={createPanelLayout('panel-a', 'wf-a')}
          workspaceId='ws-a'
          ownerUserId='user-a'
          layoutId='layout-a'
          initialLayouts={createLayouts('layout-a')}
          {...dashboardPermissions}
        />
      )
    })

    expect(mockReplace).toHaveBeenCalledWith('/workspace/ws-a/dashboard?panel=left')
  })

  it('passes dashboard list order to layout tabs without consumer-side sorting', async () => {
    mockDashboardLayoutList = {
      layouts: [
        {
          id: 'layout-b',
          name: 'Layout B',
          sortOrder: 1,
          isActive: false,
        },
        {
          id: 'layout-a',
          name: 'Layout A',
          sortOrder: 0,
          isActive: true,
        },
      ],
      isLoading: false,
      error: null,
    }

    await act(async () => {
      root.render(
        <DashboardClient
          initialTopology={createPanelLayout('panel-a', 'wf-a')}
          workspaceId='ws-a'
          ownerUserId='user-a'
          layoutId='layout-a'
          initialLayouts={createLayouts('layout-a')}
          {...dashboardPermissions}
        />
      )
    })

    expect(mockLayoutTabsLayouts.map((layout) => layout.id)).toEqual(['layout-b', 'layout-a'])
  })

  it('uses an empty completed live layout list instead of retaining SSR layouts', async () => {
    mockDashboardLayoutList = {
      layouts: [],
      isLoading: false,
      error: null,
    }

    await act(async () => {
      root.render(
        <DashboardClient
          initialTopology={createPanelLayout('panel-a', 'wf-a')}
          workspaceId='ws-a'
          ownerUserId='user-a'
          layoutId='layout-a'
          initialLayouts={createLayouts('layout-a')}
          {...dashboardPermissions}
        />
      )
    })

    expect(mockLayoutTabsLayouts).toEqual([])
    expect(container.querySelector('[data-testid^="widget-surface-"]')).toBeNull()
    expect(
      container
        .querySelector('[data-testid="dashboard-layout-document-state"]')
        ?.getAttribute('data-state')
    ).toBe('empty')
  })

  it('does not show SSR or synthetic content for a newly active layout', async () => {
    mockDashboardLayoutList = {
      layouts: createLayouts('layout-b'),
      isLoading: false,
      error: null,
    }

    await act(async () => {
      root.render(
        <DashboardClient
          initialTopology={createPanelLayout('panel-a', 'wf-a')}
          workspaceId='ws-a'
          ownerUserId='user-a'
          layoutId='layout-a'
          initialLayouts={createLayouts('layout-a')}
          {...dashboardPermissions}
        />
      )
    })

    expect(container.querySelector('[data-testid^="widget-surface-"]')).toBeNull()
    expect(
      container.querySelector('[data-testid="dashboard-layout-document-state"]')
    ).not.toBeNull()
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
    widgets: {
      [`${panelId}-widget`]: { pairColor, params: { workflowId } },
    },
    colorPairs: { pairs: [] },
  })
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
    widgets: {
      'widget-left': { pairColor: 'gray', params: null },
      'widget-right': { pairColor: 'gray', params: null },
    },
    colorPairs: { pairs: [] },
  })
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
    canWrite: element.dataset.canWrite === 'true',
  }
}
