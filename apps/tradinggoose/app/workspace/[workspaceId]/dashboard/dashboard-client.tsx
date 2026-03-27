'use client'

import {
  type ComponentType,
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  BookOpen,
  Building2,
  LayoutTemplate,
  LibraryBig,
  ScrollText,
  Search,
  Shapes,
} from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { useBrandConfig } from '@/lib/branding/branding'
import {
  type ListingIdentity,
  type ListingInputValue,
  toListingValueObject,
} from '@/lib/listing/identity'
import { type LayoutTab, LayoutTabs } from '@/app/workspace/[workspaceId]/dashboard/layout-tabs'
import { GlobalNavbarHeader } from '@/global-navbar'
import { useKnowledgeBasesList } from '@/hooks/use-knowledge'
import { type PairColorContext, usePairColorStore } from '@/stores/dashboard/pair-store'
import {
  createLayoutNodeId,
  type LayoutNode,
  type LinkedPairColor,
  normalizeColorPairsState,
  type PersistedColorPair,
  type PersistedColorPairsState,
  resolveWidgetParamsForPairColorChange,
  serializeLayout,
  type WidgetInstance,
} from '@/widgets/layout'
import { isPairColor, PAIR_COLORS, type PairColor } from '@/widgets/pair-colors'
import type { WidgetRuntimeContext } from '@/widgets/types'
import { WidgetSurface } from '@/widgets/widget-surface'

interface DashboardClientProps {
  initialState: LayoutNode
  workspaceId: string
  layoutId: string
  initialLayouts: LayoutTab[]
  initialColorPairs?: PersistedColorPairsState | unknown
}

interface LayoutResponse {
  layout?: LayoutNode
  layouts?: LayoutTab[]
  layoutId?: string
  colorPairs?: unknown
}

interface DashboardNodeProps {
  node: LayoutNode
  persistGroup: (id: string, sizes: number[]) => void
  widgetContext: WidgetRuntimeContext
  updatePairColor: (panelId: string, color: PairColor) => void
  updateWidget: (panelId: string, widgetKey: string) => void
  updateWidgetParams: (panelId: string, params: Record<string, unknown> | null) => void
  sizeHint?: number
  availableWidth?: number
  availableHeight?: number
  splitPanelVertical: (panelId: string) => void
  splitPanelHorizontal: (panelId: string) => void
  closePanel: (panelId: string) => void
}

const PANEL_MIN_SIZE = 10
const MIN_SPLIT_SIZE = PANEL_MIN_SIZE * 2

interface DropdownItem {
  id: string
  name: string
  href: string
  icon?: ComponentType<any>
  bgColor?: string
}

const sanitizeHexColor = (value?: string) => {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`
}

const DashboardNode = memo(
  function DashboardNode({
    node,
    persistGroup,
    widgetContext,
    updatePairColor,
    updateWidget,
    updateWidgetParams,
    sizeHint,
    availableWidth = 100,
    availableHeight = 100,
    splitPanelVertical,
    splitPanelHorizontal,
    closePanel,
  }: DashboardNodeProps) {
    if (node.type === 'panel') {
      const canSplitVertical = availableHeight >= MIN_SPLIT_SIZE
      const canSplitHorizontal = availableWidth >= MIN_SPLIT_SIZE

      return (
        <WidgetSurface
          widget={node.widget}
          context={widgetContext}
          panelId={node.id}
          onPairColorChange={(color) => updatePairColor(node.id, color)}
          onWidgetChange={(key) => updateWidget(node.id, key)}
          onWidgetParamsChange={(params) => updateWidgetParams(node.id, params)}
          onPanelSplit={canSplitVertical ? () => splitPanelVertical(node.id) : undefined}
          onPanelSplitHorizontal={
            canSplitHorizontal ? () => splitPanelHorizontal(node.id) : undefined
          }
          onPanelClose={() => closePanel(node.id)}
        />
      )
    }

    return (
      <ResizablePanelGroup
        key={node.id}
        direction={node.direction}
        layout={node.sizes}
        onLayout={(sizes) => persistGroup(node.id, sizes)}
        className='h-full w-full'
      >
        {node.children.map((child, index) => {
          const childSize = node.sizes[index] ?? 100 / Math.max(node.children.length, 1)
          const nextAvailableWidth =
            node.direction === 'horizontal' ? (availableWidth * childSize) / 100 : availableWidth
          const nextAvailableHeight =
            node.direction === 'vertical' ? (availableHeight * childSize) / 100 : availableHeight

          return (
            <Fragment key={`${node.id}-${child.id}`}>
              <ResizablePanel
                id={child.id}
                order={index + 1}
                defaultSize={childSize}
                minSize={PANEL_MIN_SIZE}
                collapsible
              >
                <DashboardNode
                  node={child}
                  persistGroup={persistGroup}
                  widgetContext={widgetContext}
                  updatePairColor={updatePairColor}
                  updateWidget={updateWidget}
                  updateWidgetParams={updateWidgetParams}
                  sizeHint={childSize}
                  availableWidth={nextAvailableWidth}
                  availableHeight={nextAvailableHeight}
                  splitPanelVertical={splitPanelVertical}
                  splitPanelHorizontal={splitPanelHorizontal}
                  closePanel={closePanel}
                />
              </ResizablePanel>
              {index < node.children.length - 1 && <ResizableHandle withHandle />}
            </Fragment>
          )
        })}
      </ResizablePanelGroup>
    )
  },
  (prev, next) =>
    prev.node === next.node &&
    prev.sizeHint === next.sizeHint &&
    prev.availableWidth === next.availableWidth &&
    prev.availableHeight === next.availableHeight
)

export function DashboardClient({
  initialState,
  workspaceId,
  layoutId,
  initialLayouts,
  initialColorPairs,
}: DashboardClientProps) {
  const normalizedInitialColorPairs = useMemo(
    () => normalizeColorPairsState(initialColorPairs),
    [initialColorPairs]
  )
  const initialTree = useMemo(() => {
    if (!hasLinkedColorPairs(normalizedInitialColorPairs)) {
      return initialState
    }
    return applyColorPairsToLayout(initialState, normalizedInitialColorPairs)
  }, [initialState, normalizedInitialColorPairs])
  const [tree, setTree] = useState<LayoutNode>(initialTree)
  const [layouts, setLayouts] = useState<LayoutTab[]>(() => sortLayouts(initialLayouts ?? []))
  const [isCreatingLayout, setIsCreatingLayout] = useState(false)
  const layoutIdRef = useRef(layoutId)
  const latestLayoutRef = useRef<LayoutNode>(initialTree)
  const skipLayoutRef = useRef<Set<string>>(new Set())
  const isCreatingLayoutRef = useRef(false)
  const pathname = usePathname()
  const router = useRouter()
  const [docs, setDocs] = useState<DropdownItem[]>([])
  const [searchWorkspaces, setSearchWorkspaces] = useState<DropdownItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const searchContainerRef = useRef<HTMLDivElement | null>(null)
  const docsLoadedRef = useRef(false)
  const docsLoadingRef = useRef(false)
  const brand = useBrandConfig()
  const { knowledgeBases } = useKnowledgeBasesList(workspaceId)

  const applyLayoutData = useCallback(
    (data: LayoutResponse) => {
      const normalizedPairs = normalizeColorPairsState(
        data.colorPairs ?? normalizedInitialColorPairs
      )
      const hasLinkedPairs = hasLinkedColorPairs(normalizedPairs)
      hydratePairStoreFromColorPairs(normalizedPairs)

      if (data.layout) {
        const layoutWithPairs = hasLinkedPairs
          ? applyColorPairsToLayout(data.layout, normalizedPairs)
          : data.layout
        setTree(layoutWithPairs)
        latestLayoutRef.current = layoutWithPairs
      }

      if (Array.isArray(data.layouts)) {
        setLayouts(sortLayouts(data.layouts))
      }

      if (typeof data.layoutId === 'string') {
        layoutIdRef.current = data.layoutId
      }
    },
    [normalizedInitialColorPairs, sortLayouts]
  )

  const persistLayoutImmediate = useCallback(
    async (layoutIdOverride?: string) => {
      const targetLayoutId = layoutIdOverride ?? layoutIdRef.current
      if (!targetLayoutId) return

      const serialized = serializeLayout(latestLayoutRef.current)
      const colorPairs = buildPersistedColorPairs(latestLayoutRef.current)
      await fetch(`/api/workspaces/${workspaceId}/layout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layoutId: targetLayoutId, layout: serialized, colorPairs }),
      })
    },
    [workspaceId]
  )

  const loadLayoutData = useCallback(
    async (targetLayoutId?: string) => {
      const query = targetLayoutId ? `?layoutId=${targetLayoutId}` : ''
      const response = await fetch(`/api/workspaces/${workspaceId}/layout${query}`, {
        cache: 'no-store',
      })

      if (!response.ok) {
        throw new Error(`Failed to load layout (${response.status})`)
      }

      return (await response.json()) as LayoutResponse
    },
    [workspaceId]
  )

  useEffect(() => {
    setLayouts((prev) => {
      if (prev.length) return prev
      return sortLayouts((initialLayouts ?? []).map((layout) => ({ ...layout })))
    })
  }, [initialLayouts, sortLayouts])

  useEffect(() => {
    let isMounted = true

    const loadWorkspacesForSearch = async () => {
      try {
        const response = await fetch('/api/workspaces')
        if (!response.ok) {
          throw new Error(`Failed to load workspaces (${response.status})`)
        }
        const payload = (await response.json()) as {
          workspaces?: Array<{ id: string; name: string }>
        }
        if (!isMounted) return
        const workspaces = Array.isArray(payload?.workspaces) ? payload.workspaces : []
        setSearchWorkspaces(
          workspaces.map(
            (workspace: { id: string; name: string }): DropdownItem => ({
              id: workspace.id,
              name: workspace.name,
              href: `/workspace/${workspace.id}/w`,
            })
          )
        )
      } catch (error) {
        if (isMounted) {
          console.error('Failed to load workspaces for search:', error)
        }
      }
    }

    void loadWorkspacesForSearch()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    hydratePairStoreFromColorPairs(normalizedInitialColorPairs)
  }, [normalizedInitialColorPairs])

  useEffect(() => {
    cleanupUnusedPairContexts(tree)
  }, [tree])

  useEffect(() => {
    latestLayoutRef.current = tree
  }, [tree])

  const persistLayout = useCallback(async () => {
    const currentLayoutId = layoutIdRef.current
    if (!currentLayoutId) return

    const serialized = serializeLayout(latestLayoutRef.current)
    const colorPairs = buildPersistedColorPairs(latestLayoutRef.current)
    const body = JSON.stringify({ layoutId: currentLayoutId, layout: serialized, colorPairs })
    const url = `/api/workspaces/${workspaceId}/layout`

    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' })
      navigator.sendBeacon(url, blob)
      return
    }

    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body,
        keepalive: true,
      })
    } catch {
      // Silently ignore persistence errors on unload
    }
  }, [workspaceId])

  useEffect(() => {
    const handleBeforeUnload = () => {
      void persistLayout()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void persistLayout()
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      void persistLayout()
    }
  }, [persistLayout])

  useEffect(() => {
    return () => {
      void persistLayout()
    }
  }, [pathname, persistLayout])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node)
      ) {
        setIsSearchOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const persistGroup = useCallback((groupId: string, sizes: number[]) => {
    if (skipLayoutRef.current.has(groupId)) {
      skipLayoutRef.current.delete(groupId)
      return
    }

    setTree((prev) => updateGroupSizes(prev, groupId, sizes))
  }, [])

  const widgetContext = useMemo<WidgetRuntimeContext>(() => ({ workspaceId }), [workspaceId])

  const handlePairColorChange = useCallback((panelId: string, color: PairColor) => {
    setTree((prev) => {
      const previousColor = findPanelPairColor(prev, panelId)
      if (previousColor === color) {
        return prev
      }

      const next = updatePanelPairColor(prev, panelId, color)

      if (next !== prev) {
        clonePairContextIfEmpty(previousColor, color)
        cleanupUnusedPairContexts(next)
      }

      return next === prev ? prev : next
    })
  }, [])

  const searchKnowledgeBases = useMemo(
    () =>
      knowledgeBases.map((kb) => ({
        id: kb.id,
        name: kb.name,
        description: kb.description,
        href: `/workspace/${workspaceId}/knowledge/${kb.id}`,
      })),
    [knowledgeBases, workspaceId]
  )

  const pages = useMemo(
    () => [
      { id: 'logs', name: 'Logs', icon: ScrollText, href: `/workspace/${workspaceId}/logs` },
      {
        id: 'knowledge',
        name: 'Knowledge',
        icon: LibraryBig,
        href: `/workspace/${workspaceId}/knowledge`,
      },
      {
        id: 'templates',
        name: 'Templates',
        icon: Shapes,
        href: `/workspace/${workspaceId}/templates`,
      },
      {
        id: 'docs',
        name: 'Docs',
        icon: BookOpen,
        href: brand.documentationUrl || 'https://docs.sim.ai/',
      },
    ],
    [brand.documentationUrl, workspaceId]
  )

  const loadDocs = useCallback(async () => {
    if (docsLoadedRef.current || docsLoadingRef.current) return

    docsLoadingRef.current = true
    try {
      const { getAllBlocks } = await import('@/blocks')
      const blocks = getAllBlocks().filter((block) => block.docsLink)
      setDocs(
        blocks.map((block) => ({
          id: block.type,
          name: block.name,
          icon: block.icon,
          bgColor: block.bgColor && block.bgColor.trim() ? block.bgColor : undefined,
          href: block.docsLink!,
        }))
      )
      docsLoadedRef.current = true
    } catch (error) {
      console.error('Failed to load block docs', error)
    } finally {
      docsLoadingRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!isSearchOpen) return
    void loadDocs()
  }, [isSearchOpen, loadDocs])

  const normalizedQuery = searchQuery.trim().toLowerCase()
  const filteredWorkspaces = normalizedQuery
    ? searchWorkspaces.filter((workspace) => workspace.name.toLowerCase().includes(normalizedQuery))
    : searchWorkspaces
  const filteredKnowledgeBases = normalizedQuery
    ? searchKnowledgeBases.filter((kb) => kb.name.toLowerCase().includes(normalizedQuery))
    : searchKnowledgeBases
  const filteredPages = normalizedQuery
    ? pages.filter((page) => page.name.toLowerCase().includes(normalizedQuery))
    : pages
  const filteredDocs = normalizedQuery
    ? docs.filter((doc) => doc.name.toLowerCase().includes(normalizedQuery))
    : docs
  const hasResults =
    filteredWorkspaces.length > 0 ||
    filteredKnowledgeBases.length > 0 ||
    filteredPages.length > 0 ||
    filteredDocs.length > 0
  const showDropdown = isSearchOpen

  const handleWidgetChange = useCallback((panelId: string, widgetKey: string) => {
    setTree((prev) => {
      const next = updatePanelWidget(prev, panelId, widgetKey)
      return next === prev ? prev : next
    })
  }, [])

  const handleWidgetParamsChange = useCallback(
    (panelId: string, params: Record<string, unknown> | null) => {
      setTree((prev) => {
        const next = updatePanelWidgetParams(prev, panelId, params)
        return next === prev ? prev : next
      })
    },
    []
  )

  const handleSplitPanelVertical = useCallback((panelId: string) => {
    setTree((prev) => {
      const parentId = findParentGroupId(prev, panelId)
      const next = splitPanelIntoVerticalGroup(prev, panelId)
      if (next !== prev && parentId) {
        skipLayoutRef.current.add(parentId)
      }
      return next === prev ? prev : next
    })
  }, [])

  const handleSplitPanelHorizontal = useCallback((panelId: string) => {
    setTree((prev) => {
      const parentId = findParentGroupId(prev, panelId)
      const next = splitPanelIntoHorizontalGroup(prev, panelId)
      if (next !== prev && parentId) {
        skipLayoutRef.current.add(parentId)
      }
      return next === prev ? prev : next
    })
  }, [])

  const handleClosePanel = useCallback((panelId: string) => {
    setTree((prev) => {
      const next = closePanelGroup(prev, panelId)
      return next === prev ? prev : next
    })
  }, [])

  const handleSelectLayout = useCallback(
    async (nextLayoutId: string) => {
      const previousLayoutId = layoutIdRef.current
      if (!nextLayoutId || nextLayoutId === previousLayoutId) return

      const previousLayouts = layouts
      try {
        await persistLayoutImmediate(previousLayoutId ?? undefined)
      } catch (error) {
        console.error('Failed to persist current layout before switching:', error)
      }
      layoutIdRef.current = nextLayoutId
      setLayouts((current) =>
        current.map((layout) => ({
          ...layout,
          isActive: layout.id === nextLayoutId,
        }))
      )

      try {
        await fetch(`/api/workspaces/${workspaceId}/layout`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activeLayoutId: nextLayoutId }),
        })

        const data = await loadLayoutData(nextLayoutId)
        applyLayoutData(data)
      } catch (error) {
        console.error('Failed to switch layout:', error)
        setLayouts(previousLayouts)
        layoutIdRef.current = previousLayoutId
      }
    },
    [layouts, loadLayoutData, applyLayoutData, persistLayoutImmediate]
  )

  const handleRenameLayout = useCallback(
    async (layoutId: string, name: string) => {
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}/layout/${layoutId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        })
        if (!response.ok) {
          throw new Error(`Failed to rename layout (${response.status})`)
        }
        const data = await loadLayoutData(layoutIdRef.current)
        applyLayoutData(data)
      } catch (error) {
        console.error('Failed to rename layout:', error)
      }
    },
    [workspaceId, loadLayoutData, applyLayoutData]
  )

  const handleDeleteLayout = useCallback(
    async (layoutId: string) => {
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}/layout/${layoutId}`, {
          method: 'DELETE',
        })
        if (!response.ok) {
          throw new Error(`Failed to delete layout (${response.status})`)
        }
        setLayouts((current) => current.filter((layout) => layout.id !== layoutId))
      } catch (error) {
        console.error('Failed to delete layout:', error)
      }
    },
    [workspaceId]
  )

  const handleReorderLayouts = useCallback(
    (nextLayouts: LayoutTab[]) => {
      const ordered = sortLayouts(nextLayouts)
      setLayouts(ordered)
      const layoutOrder = ordered.map((layout) => layout.id)

      fetch(`/api/workspaces/${workspaceId}/layout`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layoutOrder }),
      }).catch((error) => {
        console.error('Failed to reorder layouts:', error)
      })
    },
    [workspaceId, sortLayouts]
  )

  const handleAddLayout = useCallback(async () => {
    if (isCreatingLayoutRef.current) {
      return
    }

    isCreatingLayoutRef.current = true
    setIsCreatingLayout(true)

    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/layout/new`, { method: 'POST' })
      if (!response.ok) {
        throw new Error(`Failed to create layout (${response.status})`)
      }

      const { layout: createdLayout } = (await response.json()) as {
        layout?: LayoutTab
      }
      if (!createdLayout?.id) {
        throw new Error('Invalid create layout response')
      }

      setLayouts((current) =>
        sortLayouts([...current.filter((layout) => layout.id !== createdLayout.id), createdLayout])
      )
    } catch (error) {
      console.error('Failed to create layout:', error)
    } finally {
      isCreatingLayoutRef.current = false
      setIsCreatingLayout(false)
    }
  }, [workspaceId, sortLayouts])

  const headerLeftContent = (
    <div className='flex w-full flex-1 items-center gap-3'>
      <div className='hidden items-center gap-2 sm:flex'>
        <LayoutTemplate className='h-[18px] w-[18px] text-muted-foreground' />
        <span className='font-medium text-sm'>Dashboard</span>
      </div>
      <div ref={searchContainerRef} className='relative flex flex-1'>
        <Search className='-translate-y-1/2 absolute top-1/2 left-3 h-4 w-4 text-muted-foreground' />
        <Input
          placeholder='Search workspace content...'
          value={searchQuery}
          onChange={(event) => {
            setSearchQuery(event.target.value)
            setIsSearchOpen(true)
          }}
          onFocus={() => setIsSearchOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setIsSearchOpen(false)
            }
          }}
          className='h-full w-full rounded-md border bg-background pr-3 pl-10 text-sm'
        />
        {showDropdown && (
          <div className='absolute top-full left-0 z-50 mt-2 w-full min-w-[220px] rounded-md border border-border bg-background shadow-lg'>
            <div className='max-h-80 overflow-y-auto'>
              <div className='space-y-2 p-2'>
                <DropdownSection
                  title='Workspaces'
                  icon={Building2}
                  items={filteredWorkspaces}
                  onSelect={(href) => {
                    setIsSearchOpen(false)
                    setSearchQuery('')
                    router.push(href)
                  }}
                />
                <DropdownSection
                  title='Knowledge Bases'
                  icon={LibraryBig}
                  items={filteredKnowledgeBases}
                  onSelect={(href) => {
                    setIsSearchOpen(false)
                    setSearchQuery('')
                    router.push(href)
                  }}
                />
                <DropdownSection
                  title='Pages'
                  icon={ScrollText}
                  items={filteredPages}
                  onSelect={(href) => {
                    setIsSearchOpen(false)
                    setSearchQuery('')
                    router.push(href)
                  }}
                />
                {filteredDocs.length > 0 && (
                  <section>
                    <div className='mb-2 text-muted-foreground/70 text-xs uppercase tracking-wide'>
                      Docs
                    </div>
                    <div className='space-y-1'>
                      {filteredDocs.map((doc) => (
                        <button
                          key={doc.id}
                          className='flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-foreground text-sm transition hover:bg-card/50'
                          onClick={() => {
                            setIsSearchOpen(false)
                            setSearchQuery('')
                            window.open(doc.href, '_blank', 'noopener,noreferrer')
                          }}
                        >
                          {(() => {
                            const DocIcon = doc.icon ?? BookOpen
                            const docColor = sanitizeHexColor(doc.bgColor) ?? undefined
                            return (
                              <div
                                className='flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-secondary text-foreground'
                                style={{
                                  backgroundColor: docColor ? `${docColor}20` : undefined,
                                  color: docColor || undefined,
                                }}
                              >
                                <DocIcon className='h-4 w-4' />
                              </div>
                            )
                          })()}
                          <span className='truncate'>{doc.name}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {!hasResults && (
                  <div className='text-muted-foreground text-sm'>No matching content</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )

  const headerCenterContent = (
    <LayoutTabs
      layouts={layouts}
      isBusy={isCreatingLayout}
      onSelect={handleSelectLayout}
      onReorder={handleReorderLayouts}
      onCreate={handleAddLayout}
      onRename={handleRenameLayout}
      onDelete={handleDeleteLayout}
    />
  )

  return (
    <>
      <GlobalNavbarHeader left={headerLeftContent} center={headerCenterContent} />
      <div className='h-full min-h-0 w-full min-w-0 overflow-hidden'>
        <DashboardNode
          node={tree}
          persistGroup={persistGroup}
          widgetContext={widgetContext}
          updatePairColor={handlePairColorChange}
          updateWidget={handleWidgetChange}
          updateWidgetParams={handleWidgetParamsChange}
          availableWidth={100}
          availableHeight={100}
          splitPanelVertical={handleSplitPanelVertical}
          splitPanelHorizontal={handleSplitPanelHorizontal}
          closePanel={handleClosePanel}
        />
      </div>
    </>
  )
}

function updateGroupSizes(node: LayoutNode, groupId: string, sizes: number[]): LayoutNode {
  if (node.type === 'panel') {
    return node
  }

  if (node.id === groupId) {
    if (arePanelSizesEqual(node.sizes, sizes)) {
      return node
    }

    return {
      ...node,
      sizes: [...sizes],
    }
  }

  const updatedChildren = node.children.map((child) => updateGroupSizes(child, groupId, sizes))
  const hasChanged = updatedChildren.some((child, index) => child !== node.children[index])

  if (!hasChanged) {
    return node
  }

  return {
    ...node,
    children: updatedChildren,
  }
}

function arePanelSizesEqual(a: number[] | undefined, b: number[] | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return !a && !b
  if (a.length !== b.length) return false

  for (let index = 0; index < a.length; index += 1) {
    if (Math.abs(a[index] - b[index]) > 0.01) {
      return false
    }
  }

  return true
}

function updatePanelPairColor(node: LayoutNode, panelId: string, color: PairColor): LayoutNode {
  if (node.type === 'panel') {
    if (node.id !== panelId) {
      return node
    }

    const currentPairColor = isPairColor(node.widget?.pairColor) ? node.widget.pairColor : 'gray'
    if (currentPairColor === color) {
      return node
    }
    // When switching to a linked color pair, drop stale params that belong to the previous color.
    // Linked color pairs should derive params from the shared pair store instead of the widget state.
    const nextParams = resolveWidgetParamsForPairColorChange(node.widget, color)

    return {
      ...node,
      widget: node.widget
        ? { ...node.widget, pairColor: color, params: nextParams }
        : { key: 'empty', pairColor: color, params: nextParams },
    }
  }

  const updatedChildren = node.children.map((child) => updatePanelPairColor(child, panelId, color))
  const hasChanged = updatedChildren.some((child, index) => child !== node.children[index])

  if (!hasChanged) {
    return node
  }

  return {
    ...node,
    children: updatedChildren,
  }
}

function updatePanelWidget(node: LayoutNode, panelId: string, widgetKey: string): LayoutNode {
  if (node.type === 'panel') {
    if (node.id !== panelId) {
      return node
    }

    if (node.widget?.key === widgetKey) {
      return node
    }

    const pairColor = node.widget?.pairColor ?? 'gray'
    const previousParams = node.widget?.params ?? null
    const nextParams = pairColor === 'gray' ? previousParams : null

    return {
      ...node,
      widget: {
        key: widgetKey,
        pairColor: pairColor,
        params: nextParams,
      },
    }
  }

  const updatedChildren = node.children.map((child) => updatePanelWidget(child, panelId, widgetKey))
  const hasChanged = updatedChildren.some((child, index) => child !== node.children[index])

  if (!hasChanged) {
    return node
  }

  return {
    ...node,
    children: updatedChildren,
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function areWidgetParamValuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true

  const aIsArray = Array.isArray(a)
  const bIsArray = Array.isArray(b)
  if (aIsArray || bIsArray) {
    if (!aIsArray || !bIsArray) return false
    if (a.length !== b.length) return false
    for (let index = 0; index < a.length; index += 1) {
      if (!areWidgetParamValuesEqual(a[index], b[index])) {
        return false
      }
    }
    return true
  }

  const aIsRecord = isPlainRecord(a)
  const bIsRecord = isPlainRecord(b)
  if (aIsRecord || bIsRecord) {
    if (!aIsRecord || !bIsRecord) return false

    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    if (aKeys.length !== bKeys.length) return false

    for (const key of aKeys) {
      if (!(key in b)) return false
      if (!areWidgetParamValuesEqual(a[key], b[key])) {
        return false
      }
    }
    return true
  }

  return false
}

function areWidgetParamsEqual(
  a: Record<string, unknown> | null,
  b: Record<string, unknown> | null
): boolean {
  if (a === b) return true
  if (!a || !b) return !a && !b
  return areWidgetParamValuesEqual(a, b)
}

function updatePanelWidgetParams(
  node: LayoutNode,
  panelId: string,
  params: Record<string, unknown> | null
): LayoutNode {
  if (node.type === 'panel') {
    if (node.id !== panelId) {
      return node
    }

    const existingParams = node.widget?.params ?? null
    const nextParams = params ?? null

    if (areWidgetParamsEqual(existingParams, nextParams)) {
      return node
    }

    return {
      ...node,
      widget: node.widget
        ? { ...node.widget, params: nextParams }
        : { key: 'empty', pairColor: 'gray', params: nextParams },
    }
  }

  const updatedChildren = node.children.map((child) =>
    updatePanelWidgetParams(child, panelId, params)
  )
  const hasChanged = updatedChildren.some((child, index) => child !== node.children[index])

  if (!hasChanged) {
    return node
  }

  return {
    ...node,
    children: updatedChildren,
  }
}

function applyColorPairsToLayout(
  node: LayoutNode,
  colorPairs: PersistedColorPairsState
): LayoutNode {
  if (!hasLinkedColorPairs(colorPairs)) {
    return node
  }

  const pairMap = new Map<LinkedPairColor, PersistedColorPair>()

  for (const pair of colorPairs.pairs ?? []) {
    if (pair?.color) {
      pairMap.set(pair.color, pair)
    }
  }

  if (pairMap.size === 0) {
    return node
  }

  if (node.type === 'panel') {
    const nextWidget = applyPairDataToWidget(node.widget, pairMap)
    if (nextWidget === node.widget) {
      return node
    }

    return {
      ...node,
      widget: nextWidget,
    }
  }

  const updatedChildren = node.children.map((child) => applyColorPairsToLayout(child, colorPairs))
  const hasChanged = updatedChildren.some((child, index) => child !== node.children[index])

  if (!hasChanged) {
    return node
  }

  return {
    ...node,
    children: updatedChildren,
  }
}

function applyPairDataToWidget(
  widget: WidgetInstance,
  pairMap: Map<LinkedPairColor, PersistedColorPair>
): WidgetInstance {
  if (!widget) return widget

  const pairColor = isPairColor(widget.pairColor) ? widget.pairColor : 'gray'
  if (pairColor === 'gray') {
    return widget
  }

  const pairData = pairMap.get(pairColor)
  if (!pairData) {
    return widget
  }

  const baseParams =
    widget.params && typeof widget.params === 'object' && !Array.isArray(widget.params)
      ? { ...(widget.params as Record<string, unknown>) }
      : {}

  const workflowId = pairData.workflowId ?? null
  const listing = pairData.listing ?? null
  const copilotChatId = pairData.copilotChatId ?? null
  const indicatorId = pairData.indicatorId ?? null
  const pineIndicatorId = pairData.pineIndicatorId ?? null

  if (
    workflowId == null &&
    listing == null &&
    copilotChatId == null &&
    indicatorId == null &&
    pineIndicatorId == null
  ) {
    return widget
  }

  baseParams.workflowId = workflowId
  baseParams.listing = listing
  if (copilotChatId) {
    baseParams.copilotChatId = copilotChatId
  }
  if (indicatorId) {
    baseParams.indicatorId = indicatorId
  }
  if (pineIndicatorId) {
    baseParams.pineIndicatorId = pineIndicatorId
  }

  if (areWidgetParamsEqual(widget.params ?? null, baseParams)) {
    return widget
  }

  return {
    ...widget,
    params: baseParams,
  }
}

function hydratePairStoreFromColorPairs(colorPairs: PersistedColorPairsState) {
  const now = Date.now()
  const currentContexts = usePairColorStore.getState().contexts
  const nextContexts: Record<PairColor, PairColorContext> = { ...currentContexts }

  PAIR_COLORS.forEach((color) => {
    if (color === 'gray') return
    nextContexts[color] = {}
  })

  for (const pair of colorPairs.pairs ?? []) {
    if (!pair || !pair.color) continue
    nextContexts[pair.color] = {
      workflowId: pair.workflowId ?? undefined,
      listing: pair.listing ?? null,
      copilotChatId: pair.copilotChatId ?? null,
      indicatorId: pair.indicatorId ?? null,
      pineIndicatorId: pair.pineIndicatorId ?? null,
      updatedAt: now,
    }
  }

  usePairColorStore.setState({ contexts: nextContexts })
}

function buildPersistedColorPairs(layout: LayoutNode): PersistedColorPairsState {
  const colorsInUse = collectPairColors(layout)
  const { contexts } = usePairColorStore.getState()
  const pairs: PersistedColorPair[] = []

  colorsInUse.forEach((color) => {
    if (color === 'gray') return
    const context = contexts[color]
    const workflowId =
      typeof context?.workflowId === 'string' && context.workflowId.trim().length > 0
        ? context.workflowId
        : null
    const listing = getListingIdentity(context?.listing)
    const copilotChatId =
      typeof context?.copilotChatId === 'string' && context.copilotChatId.trim().length > 0
        ? context.copilotChatId
        : null
    const indicatorId =
      typeof context?.indicatorId === 'string' && context.indicatorId.trim().length > 0
        ? context.indicatorId
        : null
    const pineIndicatorId =
      typeof context?.pineIndicatorId === 'string' && context.pineIndicatorId.trim().length > 0
        ? context.pineIndicatorId
        : null

    pairs.push({
      color,
      workflowId,
      listing,
      copilotChatId,
      indicatorId,
      pineIndicatorId,
    })
  })

  return { pairs }
}

function hasLinkedColorPairs(colorPairs?: PersistedColorPairsState): boolean {
  if (!colorPairs || !Array.isArray(colorPairs.pairs)) return false
  return colorPairs.pairs.some(
    (pair) =>
      pair?.color &&
      (pair.workflowId ||
        pair.copilotChatId ||
        Boolean(getListingIdentity(pair.listing)) ||
        pair.indicatorId ||
        pair.pineIndicatorId)
  )
}

function getListingIdentity(listing?: ListingInputValue | null): ListingIdentity | null {
  if (!listing) return null
  const identity = toListingValueObject(listing)
  return identity ?? null
}

function collectPairColors(node: LayoutNode, set: Set<PairColor> = new Set()): Set<PairColor> {
  if (node.type === 'panel') {
    const color = node.widget?.pairColor
    if (isPairColor(color) && color !== 'gray') {
      set.add(color)
    }
    return set
  }

  node.children.forEach((child) => collectPairColors(child, set))
  return set
}

function cleanupUnusedPairContexts(layout: LayoutNode) {
  const colorsInUse = collectPairColors(layout)
  const { contexts, resetContext } = usePairColorStore.getState()

  PAIR_COLORS.forEach((color) => {
    if (color === 'gray') return
    if (colorsInUse.has(color)) return
    const context = contexts[color]
    if (hasContextData(context)) {
      resetContext(color)
    }
  })
}

function clonePairContextIfEmpty(previousColor: PairColor | undefined, nextColor: PairColor) {
  if (!previousColor || previousColor === 'gray') return
  if (nextColor === 'gray' || nextColor === previousColor) return

  const { contexts, setContext } = usePairColorStore.getState()
  const source = contexts[previousColor]
  const target = contexts[nextColor]

  if (!hasContextData(source) || hasContextData(target)) {
    return
  }

  setContext(nextColor, { ...source })
}

function findPanelPairColor(node: LayoutNode, panelId: string): PairColor | undefined {
  if (node.type === 'panel') {
    if (node.id === panelId) {
      return isPairColor(node.widget?.pairColor) ? node.widget?.pairColor : undefined
    }
    return undefined
  }

  for (const child of node.children) {
    const color = findPanelPairColor(child, panelId)
    if (color) return color
  }

  return undefined
}

function findParentGroupId(
  node: LayoutNode,
  childId: string,
  parentId: string | null = null
): string | null {
  if (node.type === 'panel') {
    return node.id === childId ? parentId : null
  }

  for (const child of node.children) {
    const found = findParentGroupId(child, childId, node.id)
    if (found) {
      return found
    }
  }

  return null
}

function hasContextData(context?: PairColorContext): boolean {
  if (!context) return false
  return Object.keys(context).length > 0
}

function splitPanelIntoVerticalGroup(node: LayoutNode, panelId: string): LayoutNode {
  return splitPanelIntoGroup(node, panelId, 'vertical')
}

function splitPanelIntoHorizontalGroup(node: LayoutNode, panelId: string): LayoutNode {
  return splitPanelIntoGroup(node, panelId, 'horizontal')
}

function splitPanelIntoGroup(
  node: LayoutNode,
  panelId: string,
  direction: 'vertical' | 'horizontal'
): LayoutNode {
  if (node.type === 'panel') {
    if (node.id !== panelId) {
      return node
    }

    return {
      id: createLayoutNodeId(),
      type: 'group',
      direction,
      sizes: [50.0, 50.0],
      children: [
        {
          id: createLayoutNodeId(),
          type: 'panel',
          widget: duplicateWidgetInstance(node.widget),
        },
        {
          id: createLayoutNodeId(),
          type: 'panel',
          widget: duplicateWidgetInstance(node.widget),
        },
      ],
    }
  }

  const updatedChildren = node.children.map((child) =>
    splitPanelIntoGroup(child, panelId, direction)
  )
  const hasChanged = updatedChildren.some((child, index) => child !== node.children[index])

  if (!hasChanged) {
    return node
  }

  return {
    ...node,
    children: updatedChildren,
  }
}

function closePanelGroup(node: LayoutNode, panelId: string): LayoutNode {
  if (node.type === 'panel') {
    return node
  }

  const directIndex = node.children.findIndex(
    (child) => child.type === 'panel' && child.id === panelId
  )

  if (directIndex !== -1) {
    const remainingChildren = node.children.filter((_, index) => index !== directIndex)

    if (remainingChildren.length === 0) {
      return node
    }

    if (remainingChildren.length === 1) {
      const survivor = remainingChildren[0]

      if (survivor.type === 'panel') {
        return {
          id: createLayoutNodeId(),
          type: 'panel',
          widget: duplicateWidgetInstance(survivor.widget),
        }
      }

      return {
        ...survivor,
        id: createLayoutNodeId(),
      }
    }

    const nextSizes = normalizeRemainingSizes(node.sizes, directIndex, remainingChildren.length)

    return {
      ...node,
      id: createLayoutNodeId(),
      children: remainingChildren,
      sizes: nextSizes,
    }
  }

  const updatedChildren = node.children.map((child) => closePanelGroup(child, panelId))
  const hasChanged = updatedChildren.some((child, index) => child !== node.children[index])

  if (!hasChanged) {
    return node
  }

  return {
    ...node,
    children: updatedChildren,
  }
}

function duplicateWidgetInstance(widget: WidgetInstance): WidgetInstance {
  if (!widget) {
    return {
      key: 'empty',
      pairColor: 'gray',
      params: null,
    }
  }

  return {
    key: widget.key,
    pairColor: widget.pairColor ?? 'gray',
    params: widget.params ? { ...widget.params } : null,
  }
}

function sortLayouts(layouts: LayoutTab[]): LayoutTab[] {
  return [...layouts].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
}

function DropdownSection({
  title,
  icon: Icon,
  items,
  onSelect,
}: {
  title: string
  icon?: ComponentType<any>
  items: DropdownItem[]
  onSelect: (href: string) => void
}) {
  if (items.length === 0) return null

  return (
    <section>
      <div className='mb-2 text-muted-foreground/70 text-xs uppercase tracking-wide'>{title}</div>
      <div className='space-y-1'>
        {items.map((item) => {
          const ItemIcon = item.icon ?? Icon
          const iconColor = sanitizeHexColor(item.bgColor) ?? undefined

          return (
            <button
              key={item.id}
              className='flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-foreground text-sm transition hover:bg-card/50'
              onClick={() => onSelect(item.href)}
            >
              {ItemIcon && (
                <div
                  className='flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-secondary text-foreground'
                  style={{
                    backgroundColor: iconColor ? `${iconColor}20` : undefined,
                    color: iconColor || undefined,
                  }}
                >
                  <ItemIcon className='h-4 w-4' />
                </div>
              )}
              <span className='truncate'>{item.name}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function normalizeRemainingSizes(
  sizes: number[],
  removedIndex: number,
  nextLength: number
): number[] {
  if (nextLength === 0) {
    return []
  }

  const remaining = sizes.filter((_, index) => index !== removedIndex)
  const total = remaining.reduce((sum, value) => sum + value, 0)

  if (total <= 0) {
    const fallback = 100 / nextLength
    return new Array(nextLength).fill(fallback)
  }

  return remaining.map((value) => (value / total) * 100)
}
