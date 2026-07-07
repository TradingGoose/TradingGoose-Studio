/**
 * @vitest-environment jsdom
 */

import { act, type InputHTMLAttributes, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardClient } from '@/app/workspace/[workspaceId]/dashboard/dashboard-client'
import type { LayoutTab } from '@/app/workspace/[workspaceId]/dashboard/layout-tabs'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { PairColorContext } from '@/widgets/color-pairs'
import type { LayoutNode } from '@/widgets/layout'
import type { PairColor } from '@/widgets/pair-colors'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const mockPush = vi.fn()
const mockReplace = vi.fn()
const dashboardClientMocks = vi.hoisted(() => ({
  saveSavedEntityField: vi.fn(() => Promise.resolve()),
  createDashboardLayoutAction: vi.fn(() => Promise.resolve({ layoutId: 'layout-new' })),
  deleteDashboardLayoutAction: vi.fn(() => Promise.resolve()),
}))
let mockPathname = '/workspace/ws-a/dashboard'
let mockSearchParams = 'layoutId=layout-a&panel=left'
let mockSelectLayout: ((layoutId: string) => void) | null = null
let mockLayoutTabsLayouts: LayoutTab[] = []
let mockDashboardLayoutList: {
  layouts: LayoutTab[]
  isLoading: boolean
  error: unknown
} | null = null
let mockDashboardLayoutProviderReady = true
const mockMutateLayoutDocument = vi.fn()

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
  saveSavedEntityField: dashboardClientMocks.saveSavedEntityField,
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
  createDashboardLayoutAction: dashboardClientMocks.createDashboardLayoutAction,
  deleteDashboardLayoutAction: dashboardClientMocks.deleteDashboardLayoutAction,
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
  const React = await import('react')
  const { normalizeColorPairsState, normalizeDashboardLayout } = await import('@/widgets/layout')
  const { resolveEffectiveDashboardLayout } = await import('@/widgets/layout-document')

  return {
    useDashboardLayoutList: (workspaceId: string) =>
      mockDashboardLayoutList ?? {
        layouts: createLayouts(workspaceId === 'ws-b' ? 'layout-b' : 'layout-a'),
        isLoading: false,
        error: null,
      },
    useDashboardLayoutDocument: ({
      layoutId,
      initialName,
      initialLayout,
      initialColorPairs,
      initialIsActive,
      initialSortOrder,
    }: {
      layoutId: string
      initialName: string
      initialLayout: LayoutNode
      initialColorPairs: unknown
      initialIsActive?: boolean
      initialSortOrder: number
    }) => {
      const [name, setName] = React.useState(initialName)
      const [layout, setLayout] = React.useState(() => normalizeDashboardLayout(initialLayout))
      const [colorPairs, setColorPairs] = React.useState(() =>
        normalizeColorPairsState(initialColorPairs)
      )
      const [isActive, setIsActive] = React.useState(initialIsActive === true)
      const [sortOrder, setSortOrder] = React.useState(initialSortOrder)
      const layoutRef = React.useRef(layout)
      layoutRef.current = layout
      const colorPairsRef = React.useRef(colorPairs)
      colorPairsRef.current = colorPairs

      React.useEffect(() => {
        setName(initialName)
        setLayout(normalizeDashboardLayout(initialLayout))
        setColorPairs(normalizeColorPairsState(initialColorPairs))
        setIsActive(initialIsActive === true)
        setSortOrder(initialSortOrder)
      }, [
        initialColorPairs,
        initialIsActive,
        initialLayout,
        initialName,
        initialSortOrder,
        layoutId,
      ])
      const mutateLayoutDocument = React.useCallback(
        (
          mutation:
            | { layout?: LayoutNode; colorPairs?: unknown }
            | ((current: {
                layout: LayoutNode
                colorPairs: unknown
              }) => { layout?: LayoutNode; colorPairs?: unknown } | null)
        ) => {
          if (!mockDashboardLayoutProviderReady) {
            if (typeof mutation !== 'function') {
              mockMutateLayoutDocument(mutation)
            }
            return
          }
          const next =
            typeof mutation === 'function'
              ? mutation({
                  layout: layoutRef.current,
                  colorPairs: colorPairsRef.current,
                })
              : mutation
          if (!next) return
          mockMutateLayoutDocument(next)
          if (next.layout !== undefined) {
            setLayout(normalizeDashboardLayout(next.layout))
          }
          if (next.colorPairs !== undefined) {
            setColorPairs(normalizeColorPairsState(next.colorPairs))
          }
        },
        []
      )

      return {
        doc: null,
        save: async () => {},
        isProviderReady: mockDashboardLayoutProviderReady,
        isLoading: false,
        error: null,
        name,
        setName,
        layout,
        setLayout,
        colorPairs,
        setColorPairs,
        mutateLayoutDocument,
        effectiveLayout: resolveEffectiveDashboardLayout(layout, colorPairs),
        isActive,
        setIsActive,
        sortOrder,
        setSortOrder,
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
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => null,
}))

vi.mock('@/widgets/widget-surface', async () => {
  const { useWidgetPairContext } = await import('@/widgets/widget-config-runtime')

  return {
    WidgetSurface: ({
      widget,
      context,
      panelId,
      onPairColorChange,
    }: {
      widget: {
        pairColor?: string
        params?: Record<string, unknown> | null
      } | null
      context?: {
        workspaceId?: string
        dashboardLayoutId?: string
        dashboardLayoutName?: string
        dashboardLayoutOwnerUserId?: string
      }
      panelId?: string
      onPairColorChange?: (color: PairColor) => void
    }) => {
      const pairColor = (widget?.pairColor ?? 'gray') as PairColor
      const pairContext = useWidgetPairContext(pairColor)

      return (
        <div>
          <div
            data-testid={`widget-surface-${panelId ?? 'panel'}`}
            data-pair-color={pairColor}
            data-pair-context={JSON.stringify(pairContext)}
            data-workflow-id={String(widget?.params?.workflowId ?? '')}
            data-watchlist-id={String(widget?.params?.watchlistId ?? '')}
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
    mockSearchParams = 'layoutId=layout-a&panel=left'
    mockSelectLayout = null
    mockLayoutTabsLayouts = []
    mockDashboardLayoutList = null
    mockDashboardLayoutProviderReady = true
    mockMutateLayoutDocument.mockClear()
    dashboardClientMocks.saveSavedEntityField.mockClear()
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
    container.remove()
    vi.unstubAllGlobals()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('replaces stale widget workflow params when the dashboard identity changes', async () => {
    await act(async () => {
      root.render(
        <DashboardClient
          initialState={createPanelLayout('panel-a', 'wf-a')}
          workspaceId='ws-a'
          ownerUserId='user-a'
          layoutId='layout-a'
          initialLayoutName='Layout A'
          initialLayouts={createLayouts('layout-a')}
          initialColorPairs={{ pairs: [] }}
          canWrite
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
          initialState={createPanelLayout('panel-b', 'wf-b')}
          workspaceId='ws-b'
          ownerUserId='user-b'
          layoutId='layout-b'
          initialLayoutName='Layout B'
          initialLayouts={createLayouts('layout-b')}
          initialColorPairs={{ pairs: [] }}
          canWrite
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
          initialState={createPanelLayout('panel-a', 'wf-a')}
          workspaceId='ws-a'
          ownerUserId='user-a'
          layoutId='layout-a'
          initialLayoutName='Layout A'
          initialLayouts={createLayouts('layout-a')}
          initialColorPairs={{ pairs: [] }}
          canWrite
        />
      )
    })

    expect(readWidgetRuntimeContext(container)).toEqual({
      dashboardLayoutId: 'layout-a',
      dashboardLayoutName: 'Layout A',
      dashboardLayoutOwnerUserId: 'user-a',
    })

    await act(async () => {
      root.render(
        <DashboardClient
          initialState={createPanelLayout('panel-a', 'wf-a')}
          workspaceId='ws-b'
          ownerUserId='user-b'
          layoutId='layout-b'
          initialLayoutName='Layout B'
          initialLayouts={createLayouts('layout-b')}
          initialColorPairs={{ pairs: [] }}
          canWrite
        />
      )
    })

    expect(readWidgetRuntimeContext(container)).toEqual({
      dashboardLayoutId: 'layout-b',
      dashboardLayoutName: 'Layout B',
      dashboardLayoutOwnerUserId: 'user-b',
    })
  })

  it('keeps dashboard content controls inactive until the layout Yjs document is ready', async () => {
    mockDashboardLayoutProviderReady = false

    await act(async () => {
      root.render(
        <DashboardClient
          initialState={createPanelLayout('panel-a', 'wf-a')}
          workspaceId='ws-a'
          ownerUserId='user-a'
          layoutId='layout-a'
          initialLayoutName='Layout A'
          initialLayouts={createLayouts('layout-a')}
          initialColorPairs={{ pairs: [] }}
          canWrite
        />
      )
    })

    const switchToRedButton = container.querySelector('[data-testid="pair-color-red-panel-a"]')
    if (!(switchToRedButton instanceof HTMLButtonElement)) {
      throw new Error('Expected pair color switch button to be rendered')
    }

    expect(switchToRedButton.disabled).toBe(true)
    await act(async () => {
      switchToRedButton.click()
    })
    expect(mockMutateLayoutDocument).not.toHaveBeenCalled()
    expect(readWidgetSurface(container, 'panel-a')).toEqual({
      workflowId: 'wf-a',
      watchlistId: '',
      workspaceId: 'ws-a',
      pairColor: 'gray',
    })

    mockDashboardLayoutProviderReady = true
    await act(async () => {
      root.render(
        <DashboardClient
          initialState={createPanelLayout('panel-a', 'wf-a')}
          workspaceId='ws-a'
          ownerUserId='user-a'
          layoutId='layout-a'
          initialLayoutName='Layout A'
          initialLayouts={createLayouts('layout-a')}
          initialColorPairs={{ pairs: [] }}
          canWrite
        />
      )
    })

    expect(switchToRedButton.disabled).toBe(false)
    await act(async () => {
      switchToRedButton.click()
    })
    expect(mockMutateLayoutDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        colorPairs: { pairs: [{ color: 'red', workflowId: 'wf-a' }] },
      })
    )
  })

  it('switches linked pair colors without triggering render-phase registry updates', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await act(async () => {
      root.render(
        <>
          <DashboardClient
            initialState={createPanelLayout('panel-a', 'wf-red', 'red')}
            workspaceId='ws-a'
            ownerUserId='user-a'
            layoutId='layout-a'
            initialLayoutName='Layout A'
            initialLayouts={createLayouts('layout-a')}
            initialColorPairs={{
              pairs: [{ color: 'red', workflowId: 'wf-red' }],
            }}
            canWrite
          />
        </>
      )
    })

    expect(readWidgetPairContext(container, 'panel-a')).toMatchObject({
      workflowId: 'wf-red',
    })

    const switchToBlueButton = container.querySelector('[data-testid="pair-color-blue-panel-a"]')
    if (!(switchToBlueButton instanceof HTMLButtonElement)) {
      throw new Error('Expected pair color switch button to be rendered')
    }

    await act(async () => {
      switchToBlueButton.click()
    })

    expect(readWidgetPairContext(container, 'panel-a')).toMatchObject({
      workflowId: 'wf-red',
    })

    expect(readWidgetSurface(container)).toEqual({
      workflowId: 'wf-red',
      watchlistId: '',
      workspaceId: 'ws-a',
      pairColor: 'blue',
    })
    expect(hasRenderPhaseUpdateWarning(consoleError.mock.calls)).toBe(false)

    consoleError.mockRestore()
  })

  it('fills missing shared workflow state when switching a gray widget into a partially populated color', async () => {
    await act(async () => {
      root.render(
        <DashboardClient
          initialState={{
            id: 'group-root',
            type: 'group',
            direction: 'horizontal',
            sizes: [50, 50],
            children: [
              createPanelLayout('panel-a', 'wf-local'),
              {
                id: 'panel-b',
                type: 'panel',
                widget: {
                  key: 'data_chart',
                  pairColor: 'red',
                  params: null,
                },
              },
            ],
          }}
          workspaceId='ws-a'
          ownerUserId='user-a'
          layoutId='layout-a'
          initialLayoutName='Layout A'
          initialLayouts={createLayouts('layout-a')}
          initialColorPairs={{
            pairs: [
              {
                color: 'red',
                listing: {
                  listing_id: 'AAPL',
                  base_id: '',
                  quote_id: '',
                  listing_type: 'default',
                },
              },
            ],
          }}
          canWrite
        />
      )
    })

    const switchToRedButton = container.querySelector('[data-testid="pair-color-red-panel-a"]')
    if (!(switchToRedButton instanceof HTMLButtonElement)) {
      throw new Error('Expected pair color switch button to be rendered')
    }

    await act(async () => {
      switchToRedButton.click()
    })

    expect(readWidgetPairContext(container, 'panel-a')).toEqual({
      workflowId: 'wf-local',
      listing: {
        listing_id: 'AAPL',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
    })
    expect(readWidgetSurface(container, 'panel-a')).toEqual({
      workflowId: 'wf-local',
      watchlistId: '',
      workspaceId: 'ws-a',
      pairColor: 'red',
    })
  })

  it('hydrates supported stable entity ids from color pairs', async () => {
    await act(async () => {
      root.render(
        <DashboardClient
          initialState={createPanelLayout('panel-a', 'wf-current', 'red')}
          workspaceId='ws-a'
          ownerUserId='user-a'
          layoutId='layout-a'
          initialLayoutName='Layout A'
          initialLayouts={createLayouts('layout-a')}
          initialColorPairs={{
            pairs: [
              {
                color: 'red',
                workflowId: 'wf-current',
                skillId: 'skill-saved',
              },
            ],
          }}
          canWrite
        />
      )
    })

    expect(readWidgetPairContext(container, 'panel-a')).toMatchObject({
      workflowId: 'wf-current',
    })
  })

  it('resolves linked watchlist pair state into the effective widget projection', async () => {
    await act(async () => {
      root.render(
        <DashboardClient
          initialState={{
            id: 'panel-a',
            type: 'panel',
            widget: {
              key: 'watchlist',
              pairColor: 'red',
              params: { provider: 'alpaca' },
            },
          }}
          workspaceId='ws-a'
          ownerUserId='user-a'
          layoutId='layout-a'
          initialLayoutName='Layout A'
          initialLayouts={createLayouts('layout-a')}
          initialColorPairs={{
            pairs: [{ color: 'red', watchlistId: 'watchlist-pair' }],
          }}
          canWrite
        />
      )
    })

    expect(readWidgetPairContext(container, 'panel-a')).toMatchObject({
      watchlistId: 'watchlist-pair',
    })
    const surface = readWidgetSurface(container)
    expect(surface).toEqual({
      workflowId: '',
      watchlistId: 'watchlist-pair',
      workspaceId: 'ws-a',
      pairColor: 'red',
    })
  })

  it('keeps the current layout stable while switching active layout metadata', async () => {
    await act(async () => {
      root.render(
        <DashboardClient
          initialState={createPanelLayout('panel-a', 'wf-a')}
          workspaceId='ws-a'
          ownerUserId='user-a'
          layoutId='layout-a'
          initialLayoutName='Layout A'
          initialLayouts={createLayouts('layout-a')}
          initialColorPairs={{ pairs: [] }}
          canWrite
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

    expect(dashboardClientMocks.saveSavedEntityField).toHaveBeenCalledTimes(1)
    expect(dashboardClientMocks.saveSavedEntityField).toHaveBeenCalledWith(
      'dashboard_layout',
      'layout-b',
      'ws-a',
      'isActive',
      true,
      'user-a'
    )
    expect(readWidgetSurface(container)).toEqual({
      workflowId: 'wf-a',
      watchlistId: '',
      workspaceId: 'ws-a',
      pairColor: 'gray',
    })
  })

  it('updates the URL only after the layout list reports the selected active layout', async () => {
    mockDashboardLayoutList = {
      layouts: createLayouts('layout-a'),
      isLoading: false,
      error: null,
    }

    await act(async () => {
      root.render(
        <DashboardClient
          initialState={createPanelLayout('panel-a', 'wf-a')}
          workspaceId='ws-a'
          ownerUserId='user-a'
          layoutId='layout-a'
          initialLayoutName='Layout A'
          initialLayouts={createLayouts('layout-a')}
          initialColorPairs={{ pairs: [] }}
          canWrite
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

    expect(dashboardClientMocks.saveSavedEntityField).toHaveBeenCalledWith(
      'dashboard_layout',
      'layout-b',
      'ws-a',
      'isActive',
      true,
      'user-a'
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
          initialState={createPanelLayout('panel-a', 'wf-a')}
          workspaceId='ws-a'
          ownerUserId='user-a'
          layoutId='layout-a'
          initialLayoutName='Layout A'
          initialLayouts={createLayouts('layout-a')}
          initialColorPairs={{ pairs: [] }}
          canWrite
        />
      )
    })

    expect(mockReplace).toHaveBeenCalledWith(
      '/workspace/ws-a/dashboard?layoutId=layout-b&panel=left'
    )
  })

  it('updates the URL when an external layout-list activation changes the active layout', async () => {
    mockDashboardLayoutList = {
      layouts: createLayouts('layout-b'),
      isLoading: false,
      error: null,
    }

    await act(async () => {
      root.render(
        <DashboardClient
          initialState={createPanelLayout('panel-a', 'wf-a')}
          workspaceId='ws-a'
          ownerUserId='user-a'
          layoutId='layout-a'
          initialLayoutName='Layout A'
          initialLayouts={createLayouts('layout-a')}
          initialColorPairs={{ pairs: [] }}
          canWrite
        />
      )
    })

    expect(mockReplace).toHaveBeenCalledWith(
      '/workspace/ws-a/dashboard?layoutId=layout-b&panel=left'
    )
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
          initialState={createPanelLayout('panel-a', 'wf-a')}
          workspaceId='ws-a'
          ownerUserId='user-a'
          layoutId='layout-a'
          initialLayoutName='Layout A'
          initialLayouts={createLayouts('layout-a')}
          initialColorPairs={{ pairs: [] }}
          canWrite
        />
      )
    })

    expect(mockLayoutTabsLayouts.map((layout) => layout.id)).toEqual(['layout-b', 'layout-a'])
  })
})

function createPanelLayout(
  panelId: string,
  workflowId: string,
  pairColor: PairColor = 'gray'
): LayoutNode {
  return {
    id: panelId,
    type: 'panel',
    widget: {
      key: 'editor_workflow',
      pairColor,
      params: { workflowId },
    },
  }
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

function readWidgetPairContext(container: HTMLDivElement, panelId?: string): PairColorContext {
  const selector = panelId
    ? `[data-testid="widget-surface-${panelId}"]`
    : '[data-testid^="widget-surface-"]'
  const element = container.querySelector(selector)
  if (!(element instanceof HTMLElement)) {
    throw new Error('Expected widget surface to be rendered')
  }

  return JSON.parse(element.dataset.pairContext || '{}') as PairColorContext
}

function hasRenderPhaseUpdateWarning(calls: unknown[][]) {
  return calls.some((call) =>
    call.some(
      (value) =>
        typeof value === 'string' &&
        value.includes('Cannot update a component') &&
        value.includes('while rendering a different component')
    )
  )
}
