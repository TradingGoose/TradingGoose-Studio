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
  Activity,
  BookOpen,
  Building2,
  LayoutTemplate,
  LibraryBig,
  ScrollText,
  Search,
} from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { useBrandConfig } from '@/lib/branding/branding'
import { sanitizeSolidIconColor } from '@/lib/ui/icon-colors'
import { saveSavedEntityField } from '@/lib/yjs/use-entity-fields'
import {
  createDashboardLayoutAction,
  deleteDashboardLayoutAction,
} from '@/app/workspace/[workspaceId]/dashboard/actions'
import { type LayoutTab, LayoutTabs } from '@/app/workspace/[workspaceId]/dashboard/layout-tabs'
import {
  useDashboardLayoutDocument,
  useDashboardLayoutList,
} from '@/app/workspace/[workspaceId]/dashboard/use-dashboard-layout-doc'
import { GlobalNavbarHeader } from '@/global-navbar'
import { useKnowledgeBasesList } from '@/hooks/use-knowledge'
import { usePathname, useRouter } from '@/i18n/navigation'
import {
  closeDashboardLayoutPanelGroup,
  createDefaultColorPairsState,
  createDefaultLayoutState,
  findDashboardLayoutParentGroupId,
  type LayoutNode,
  normalizeColorPairsState,
  type PersistedColorPairsState,
  splitDashboardLayoutPanelIntoHorizontalGroup,
  splitDashboardLayoutPanelIntoVerticalGroup,
  updateDashboardLayoutGroupSizes,
} from '@/widgets/layout'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetRuntimeContext } from '@/widgets/types'
import {
  useWidgetConfigRuntimeActions,
  WidgetConfigRuntimeProvider,
} from '@/widgets/widget-config-runtime'
import { WidgetSurface } from '@/widgets/widget-surface'

interface DashboardClientProps {
  initialState: LayoutNode
  workspaceId: string
  ownerUserId: string
  layoutId: string
  initialLayoutName: string
  initialLayouts: LayoutTab[]
  initialColorPairs: PersistedColorPairsState | unknown
  canWrite: boolean
}

interface DashboardNodeProps {
  node: LayoutNode
  persistGroup?: (id: string, sizes: number[]) => void
  widgetContext: WidgetRuntimeContext
  updatePairColor?: (panelId: string, color: PairColor) => void
  updateWidget?: (panelId: string, widgetKey: string) => void
  updateWidgetParamsPatch?: (
    panelId: string,
    widgetKey: string,
    params: Record<string, unknown>
  ) => void
  sizeHint?: number
  availableWidth?: number
  availableHeight?: number
  splitPanelVertical?: (panelId: string) => void
  splitPanelHorizontal?: (panelId: string) => void
  closePanel?: (panelId: string) => void
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

const DashboardNode = memo(function DashboardNode({
  node,
  persistGroup,
  widgetContext,
  updatePairColor,
  updateWidget,
  updateWidgetParamsPatch,
  sizeHint,
  availableWidth = 100,
  availableHeight = 100,
  splitPanelVertical,
  splitPanelHorizontal,
  closePanel,
}: DashboardNodeProps) {
  const panelId = node.type === 'panel' ? node.id : null
  const panelWidgetKey = node.type === 'panel' ? node.widget?.key : undefined
  const handlePairColorChange = useCallback(
    (color: PairColor) => {
      if (!panelId || !updatePairColor) return
      updatePairColor(panelId, color)
    },
    [panelId, updatePairColor]
  )
  const handleWidgetChange = useCallback(
    (key: string) => {
      if (!panelId || !updateWidget) return
      updateWidget(panelId, key)
    },
    [panelId, updateWidget]
  )
  const handleWidgetParamsPatch = useCallback(
    (params: Record<string, unknown>) => {
      if (!panelId || !panelWidgetKey || !updateWidgetParamsPatch) return
      updateWidgetParamsPatch(panelId, panelWidgetKey, params)
    },
    [panelId, panelWidgetKey, updateWidgetParamsPatch]
  )
  const handlePanelSplitVertical = useCallback(() => {
    if (!panelId || !splitPanelVertical) return
    splitPanelVertical(panelId)
  }, [panelId, splitPanelVertical])
  const handlePanelSplitHorizontal = useCallback(() => {
    if (!panelId || !splitPanelHorizontal) return
    splitPanelHorizontal(panelId)
  }, [panelId, splitPanelHorizontal])
  const handlePanelClose = useCallback(() => {
    if (!panelId || !closePanel) return
    closePanel(panelId)
  }, [closePanel, panelId])

  if (node.type === 'panel') {
    const canSplitVertical = availableHeight >= MIN_SPLIT_SIZE
    const canSplitHorizontal = availableWidth >= MIN_SPLIT_SIZE

    return (
      <WidgetSurface
        widget={node.widget}
        context={widgetContext}
        panelId={node.id}
        onPairColorChange={updatePairColor ? handlePairColorChange : undefined}
        onWidgetChange={updateWidget ? handleWidgetChange : undefined}
        onWidgetParamsPatch={
          updateWidgetParamsPatch && panelWidgetKey ? handleWidgetParamsPatch : undefined
        }
        onPanelSplit={splitPanelVertical && canSplitVertical ? handlePanelSplitVertical : undefined}
        onPanelSplitHorizontal={
          splitPanelHorizontal && canSplitHorizontal ? handlePanelSplitHorizontal : undefined
        }
        onPanelClose={closePanel ? handlePanelClose : undefined}
      />
    )
  }

  return (
    <ResizablePanelGroup
      key={node.id}
      direction={node.direction}
      onLayout={persistGroup ? (sizes) => persistGroup(node.id, sizes) : undefined}
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
                updateWidgetParamsPatch={updateWidgetParamsPatch}
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
})

export function DashboardClient({
  initialState,
  workspaceId,
  ownerUserId,
  layoutId,
  initialLayoutName,
  initialLayouts,
  initialColorPairs,
  canWrite,
}: DashboardClientProps) {
  const [isCreatingLayout, setIsCreatingLayout] = useState(false)
  const [pendingActivationId, setPendingActivationId] = useState<string | null>(null)
  const skipLayoutRef = useRef<Set<string>>(new Set())
  const isCreatingLayoutRef = useRef(false)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const searchParamsString = searchParams.toString()
  const [docs, setDocs] = useState<DropdownItem[]>([])
  const [searchWorkspaces, setSearchWorkspaces] = useState<DropdownItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const searchContainerRef = useRef<HTMLDivElement | null>(null)
  const docsLoadedRef = useRef(false)
  const docsLoadingRef = useRef(false)
  const layoutListCacheRef = useRef<{
    scopeKey: string
    layouts: LayoutTab[]
  } | null>(null)
  const brand = useBrandConfig()
  const { knowledgeBases } = useKnowledgeBasesList(workspaceId)
  const t = useTranslations('workspace.dashboard')
  const dashboardLayoutList = useDashboardLayoutList(workspaceId, ownerUserId)
  const layoutListScopeKey = `${workspaceId}:${ownerUserId}`
  if (layoutListCacheRef.current?.scopeKey !== layoutListScopeKey) {
    layoutListCacheRef.current = {
      scopeKey: layoutListScopeKey,
      layouts: initialLayouts,
    }
  }
  const hasLiveLayouts = dashboardLayoutList.layouts.length > 0
  const canUseLiveLayoutList = !dashboardLayoutList.isLoading && hasLiveLayouts
  useEffect(() => {
    if (!canUseLiveLayoutList) return
    layoutListCacheRef.current = {
      scopeKey: layoutListScopeKey,
      layouts: dashboardLayoutList.layouts,
    }
  }, [canUseLiveLayoutList, dashboardLayoutList.layouts, layoutListScopeKey])
  const layouts = useMemo(
    () =>
      canUseLiveLayoutList
        ? dashboardLayoutList.layouts
        : (layoutListCacheRef.current?.layouts ?? initialLayouts),
    [canUseLiveLayoutList, dashboardLayoutList.layouts, initialLayouts]
  )
  const listActiveLayout = useMemo(
    () => layouts.find((layout) => layout.isActive) ?? null,
    [layouts]
  )
  const activeLayoutId = listActiveLayout?.id ?? layoutId
  const emptyInitialLayout = useMemo(() => createDefaultLayoutState(), [])
  const emptyInitialColorPairs = useMemo(() => createDefaultColorPairsState(), [])
  const activeInitialLayout = activeLayoutId === layoutId ? initialState : emptyInitialLayout
  const activeInitialColorPairs = useMemo(
    () =>
      activeLayoutId === layoutId
        ? normalizeColorPairsState(initialColorPairs)
        : emptyInitialColorPairs,
    [activeLayoutId, emptyInitialColorPairs, initialColorPairs, layoutId]
  )
  const activeInitialName = listActiveLayout?.name ?? initialLayoutName
  const layoutDocument = useDashboardLayoutDocument({
    workspaceId,
    ownerUserId,
    layoutId: activeLayoutId,
    canWrite,
    initialName: activeInitialName,
    initialLayout: activeInitialLayout,
    initialColorPairs: activeInitialColorPairs,
  })
  const rawTree = layoutDocument.layout
  const colorPairs = layoutDocument.colorPairs
  const mutateLayoutDocument = layoutDocument.mutateLayoutDocument
  const canEditContent = canWrite && layoutDocument.isProviderReady && Boolean(activeLayoutId)

  useEffect(() => {
    skipLayoutRef.current.clear()
  }, [activeLayoutId])

  useEffect(() => {
    if (pendingActivationId && activeLayoutId === pendingActivationId) {
      setPendingActivationId(null)
    }
  }, [activeLayoutId, pendingActivationId])

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParamsString)
    if (!nextParams.has('layoutId')) return

    nextParams.delete('layoutId')
    const query = nextParams.toString()
    router.replace(`${pathname}${query ? `?${query}` : ''}`)
  }, [pathname, router, searchParamsString])

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
              href: `/workspace/${workspace.id}/dashboard`,
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

  const persistGroup = useCallback(
    (groupId: string, sizes: number[]) => {
      if (!canEditContent) return
      if (skipLayoutRef.current.has(groupId)) {
        skipLayoutRef.current.delete(groupId)
        return
      }

      mutateLayoutDocument((current) => {
        const next = updateDashboardLayoutGroupSizes(current.layout, groupId, sizes)
        return next === current.layout ? null : { layout: next }
      })
    },
    [canEditContent, mutateLayoutDocument]
  )

  const widgetContext = useMemo<WidgetRuntimeContext>(
    () => ({
      workspaceId,
      dashboardLayoutId: activeLayoutId ?? undefined,
      dashboardLayoutName: layoutDocument.name,
      dashboardLayoutOwnerUserId: ownerUserId,
    }),
    [activeLayoutId, layoutDocument.name, ownerUserId, workspaceId]
  )

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
      {
        id: 'records',
        name: t('pages.records'),
        icon: ScrollText,
        href: `/workspace/${workspaceId}/records`,
      },
      {
        id: 'monitor',
        name: t('pages.monitor'),
        icon: Activity,
        href: `/workspace/${workspaceId}/monitor`,
      },
      {
        id: 'knowledge',
        name: t('pages.knowledge'),
        icon: LibraryBig,
        href: `/workspace/${workspaceId}/knowledge`,
      },
      {
        id: 'docs',
        name: t('pages.docs'),
        icon: BookOpen,
        href: brand.documentationUrl,
      },
    ],
    [brand.documentationUrl, t, workspaceId]
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
          bgColor: sanitizeSolidIconColor(block.bgColor),
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

  const handleSplitPanelVertical = useCallback(
    (panelId: string) => {
      if (!canEditContent) return
      mutateLayoutDocument((current) => {
        const parentId = findDashboardLayoutParentGroupId(current.layout, panelId)
        const next = splitDashboardLayoutPanelIntoVerticalGroup(current.layout, panelId)
        if (next === current.layout) return null
        if (parentId) skipLayoutRef.current.add(parentId)
        return { layout: next }
      })
    },
    [canEditContent, mutateLayoutDocument]
  )

  const handleSplitPanelHorizontal = useCallback(
    (panelId: string) => {
      if (!canEditContent) return
      mutateLayoutDocument((current) => {
        const parentId = findDashboardLayoutParentGroupId(current.layout, panelId)
        const next = splitDashboardLayoutPanelIntoHorizontalGroup(current.layout, panelId)
        if (next === current.layout) return null
        if (parentId) skipLayoutRef.current.add(parentId)
        return { layout: next }
      })
    },
    [canEditContent, mutateLayoutDocument]
  )

  const handleClosePanel = useCallback(
    (panelId: string) => {
      if (!canEditContent) return
      mutateLayoutDocument((current) => {
        const next = closeDashboardLayoutPanelGroup(current.layout, panelId)
        if (next === current.layout) return null
        return { layout: next }
      })
    },
    [canEditContent, mutateLayoutDocument]
  )

  const handleSelectLayout = useCallback(
    async (nextLayoutId: string) => {
      if (!nextLayoutId || nextLayoutId === activeLayoutId) return
      setPendingActivationId(nextLayoutId)

      try {
        if (!canWrite) {
          throw new Error('Write access is required to switch the active layout')
        }
        await saveSavedEntityField(
          'dashboard_layout',
          nextLayoutId,
          workspaceId,
          'isActive',
          true,
          ownerUserId
        )
      } catch (error) {
        console.error('Failed to switch layout:', error)
        setPendingActivationId(null)
      }
    },
    [activeLayoutId, canWrite, ownerUserId, workspaceId]
  )

  const handleRenameLayout = useCallback(
    async (layoutId: string, name: string) => {
      if (!canWrite) return
      try {
        await saveSavedEntityField(
          'dashboard_layout',
          layoutId,
          workspaceId,
          'name',
          name,
          ownerUserId
        )
      } catch (error) {
        console.error('Failed to rename layout:', error)
      }
    },
    [canWrite, ownerUserId, workspaceId]
  )

  const handleDeleteLayout = useCallback(
    async (layoutId: string) => {
      if (!canWrite) return
      try {
        await deleteDashboardLayoutAction(workspaceId, layoutId)
      } catch (error) {
        console.error('Failed to delete layout:', error)
      }
    },
    [canWrite, workspaceId]
  )

  const handleReorderLayouts = useCallback(
    (layoutId: string, targetIndex: number) => {
      if (!canWrite) return
      saveSavedEntityField(
        'dashboard_layout',
        layoutId,
        workspaceId,
        'sortOrder',
        targetIndex,
        ownerUserId
      ).catch((error) => {
        console.error('Failed to reorder layouts:', error)
      })
    },
    [canWrite, ownerUserId, workspaceId]
  )

  const handleAddLayout = useCallback(async () => {
    if (!canWrite) return
    if (isCreatingLayoutRef.current) {
      return
    }

    isCreatingLayoutRef.current = true
    setIsCreatingLayout(true)

    try {
      await createDashboardLayoutAction(workspaceId)
    } catch (error) {
      console.error('Failed to create layout:', error)
    } finally {
      isCreatingLayoutRef.current = false
      setIsCreatingLayout(false)
    }
  }, [canWrite, workspaceId])

  const headerLeftContent = (
    <div className='flex w-full flex-1 items-center gap-3'>
      <div className='hidden items-center gap-2 sm:flex'>
        <LayoutTemplate className='h-[18px] w-[18px] text-muted-foreground' />
        <span className='font-medium text-sm'>{t('title')}</span>
      </div>
      <div ref={searchContainerRef} className='relative flex flex-1'>
        <Search className='-translate-y-1/2 absolute top-1/2 left-3 h-4 w-4 text-muted-foreground' />
        <Input
          placeholder={t('searchPlaceholder')}
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
                  title={t('sections.workspaces')}
                  icon={Building2}
                  items={filteredWorkspaces}
                  onSelect={(href) => {
                    setIsSearchOpen(false)
                    setSearchQuery('')
                    router.push(href)
                  }}
                />
                <DropdownSection
                  title={t('sections.knowledgeBases')}
                  icon={LibraryBig}
                  items={filteredKnowledgeBases}
                  onSelect={(href) => {
                    setIsSearchOpen(false)
                    setSearchQuery('')
                    router.push(href)
                  }}
                />
                <DropdownSection
                  title={t('sections.pages')}
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
                      {t('sections.docs')}
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
                            const docColor = sanitizeSolidIconColor(doc.bgColor) ?? undefined
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
                  <div className='text-muted-foreground text-sm'>{t('emptySearch')}</div>
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
      isBusy={isCreatingLayout || pendingActivationId !== null}
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
        <WidgetConfigRuntimeProvider
          context={widgetContext}
          layout={rawTree}
          colorPairs={colorPairs}
          canWrite={canEditContent}
          onDocumentMutation={mutateLayoutDocument}
        >
          <DashboardRuntimeTree
            node={rawTree}
            persistGroup={canEditContent ? persistGroup : undefined}
            widgetContext={widgetContext}
            availableWidth={100}
            availableHeight={100}
            canEditContent={canEditContent}
            splitPanelVertical={canEditContent ? handleSplitPanelVertical : undefined}
            splitPanelHorizontal={canEditContent ? handleSplitPanelHorizontal : undefined}
            closePanel={canEditContent ? handleClosePanel : undefined}
          />
        </WidgetConfigRuntimeProvider>
      </div>
    </>
  )
}

function DashboardRuntimeTree(
  props: Omit<
    DashboardNodeProps,
    'updatePairColor' | 'updateWidget' | 'updateWidgetParamsPatch'
  > & { canEditContent: boolean }
) {
  const { canEditContent, ...nodeProps } = props
  const { changeWidgetPairColor, changeWidgetKey, patchWidgetParams } =
    useWidgetConfigRuntimeActions()

  return (
    <DashboardNode
      {...nodeProps}
      updatePairColor={canEditContent ? changeWidgetPairColor : undefined}
      updateWidget={canEditContent ? changeWidgetKey : undefined}
      updateWidgetParamsPatch={canEditContent ? patchWidgetParams : undefined}
    />
  )
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
          const iconColor = sanitizeSolidIconColor(item.bgColor) ?? undefined

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
