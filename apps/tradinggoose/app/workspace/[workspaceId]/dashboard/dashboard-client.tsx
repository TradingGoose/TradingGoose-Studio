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
import { useTranslations } from 'next-intl'
import type { ImperativePanelGroupHandle } from 'react-resizable-panels'
import { Input } from '@/components/ui/input'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { useBrandConfig } from '@/lib/branding/branding'
import { renameSavedEntityAction } from '@/lib/saved-entities/actions'
import { sanitizeSolidIconColor } from '@/lib/ui/icon-colors'
import {
  activateDashboardLayoutAction,
  createDashboardLayoutAction,
  deleteDashboardLayoutAction,
  reorderDashboardLayoutsAction,
} from '@/app/workspace/[workspaceId]/dashboard/actions'
import { type LayoutTab, LayoutTabs } from '@/app/workspace/[workspaceId]/dashboard/layout-tabs'
import {
  useDashboardLayoutDocument,
  useDashboardLayoutList,
} from '@/app/workspace/[workspaceId]/dashboard/use-dashboard-layout-doc'
import { GlobalNavbarHeader } from '@/global-navbar'
import { useKnowledgeBasesList } from '@/hooks/use-knowledge'
import { useRouter } from '@/i18n/navigation'
import {
  countDashboardTopologyPanels,
  type DashboardLayoutStructureMutation,
  type DashboardLayoutTopologyNode,
} from '@/widgets/layout-document'
import type { WidgetRuntimeContext } from '@/widgets/types'
import {
  useWidgetConfigRuntimeActions,
  WidgetConfigRuntimeProvider,
} from '@/widgets/widget-config-runtime'
import { WidgetSurface } from '@/widgets/widget-surface'

interface DashboardClientProps {
  initialTopology: DashboardLayoutTopologyNode
  workspaceId: string
  ownerUserId: string
  layoutId: string
  initialLayouts: LayoutTab[]
  workspaceCanWrite: boolean
}

interface DashboardNodeProps {
  node: DashboardLayoutTopologyNode
  workspaceId: string
  ownerUserId: string
  layoutId: string
  canEditContent: boolean
  persistGroup?: (id: string, sizes: number[]) => void
  resizeReconcileVersion: number
  widgetContext: WidgetRuntimeContext
  availableWidth?: number
  availableHeight?: number
  splitPanelVertical?: (panelId: string) => void
  splitPanelHorizontal?: (panelId: string) => void
  closePanel?: (panelId: string) => void
  replacePanelWidget?: (panelId: string, widgetKey: string) => void
}

const PANEL_MIN_SIZE = 10
const MIN_SPLIT_SIZE = PANEL_MIN_SIZE * 2
const PANEL_SIZE_EPSILON = 0.01

const arePanelSizesEqual = (left: number[], right: number[]) =>
  left.length === right.length &&
  left.every((value, index) => Math.abs(value - (right[index] ?? 0)) < PANEL_SIZE_EPSILON)

interface DropdownItem {
  id: string
  name: string
  href: string
  icon?: ComponentType<any>
  bgColor?: string
}

const DashboardNode = memo(function DashboardNode({
  node,
  workspaceId,
  ownerUserId,
  layoutId,
  canEditContent,
  persistGroup,
  resizeReconcileVersion,
  widgetContext,
  availableWidth = 100,
  availableHeight = 100,
  splitPanelVertical,
  splitPanelHorizontal,
  closePanel,
  replacePanelWidget,
}: DashboardNodeProps) {
  const groupRef = useRef<ImperativePanelGroupHandle>(null)
  const appliedLayoutRef = useRef<number[] | null>(null)
  const groupSizes = node.type === 'group' ? node.sizes : null

  useEffect(() => {
    if (!groupSizes || !groupRef.current) return
    const mounted = groupRef.current.getLayout()
    if (arePanelSizesEqual(mounted, groupSizes)) return
    appliedLayoutRef.current = groupSizes
    groupRef.current.setLayout(groupSizes)
  }, [groupSizes, resizeReconcileVersion])

  const handleGroupLayout = useCallback(
    (sizes: number[]) => {
      if (node.type !== 'group') return
      const applied = appliedLayoutRef.current
      if (applied && arePanelSizesEqual(applied, sizes)) {
        appliedLayoutRef.current = null
        return
      }
      appliedLayoutRef.current = null
      if (arePanelSizesEqual(node.sizes, sizes)) return
      persistGroup?.(node.id, sizes)
    },
    [node, persistGroup]
  )

  if (node.type === 'panel') {
    const canSplitVertical = availableHeight >= MIN_SPLIT_SIZE
    const canSplitHorizontal = availableWidth >= MIN_SPLIT_SIZE

    return (
      <WidgetConfigRuntimeProvider
        workspaceId={workspaceId}
        ownerUserId={ownerUserId}
        layoutId={layoutId}
        identityId={node.identityId}
        widgetKey={node.widgetKey}
        canWrite={canEditContent}
      >
        <DashboardPanel
          panelId={node.id}
          widgetContext={widgetContext}
          canEditContent={canEditContent}
          splitPanelVertical={canSplitVertical ? splitPanelVertical : undefined}
          splitPanelHorizontal={canSplitHorizontal ? splitPanelHorizontal : undefined}
          closePanel={closePanel}
          replacePanelWidget={replacePanelWidget}
        />
      </WidgetConfigRuntimeProvider>
    )
  }

  return (
    <ResizablePanelGroup
      ref={groupRef}
      key={node.id}
      direction={node.direction}
      onLayout={persistGroup ? handleGroupLayout : undefined}
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
                workspaceId={workspaceId}
                ownerUserId={ownerUserId}
                layoutId={layoutId}
                canEditContent={canEditContent}
                persistGroup={persistGroup}
                resizeReconcileVersion={resizeReconcileVersion}
                widgetContext={widgetContext}
                availableWidth={nextAvailableWidth}
                availableHeight={nextAvailableHeight}
                splitPanelVertical={splitPanelVertical}
                splitPanelHorizontal={splitPanelHorizontal}
                closePanel={closePanel}
                replacePanelWidget={replacePanelWidget}
              />
            </ResizablePanel>
            {index < node.children.length - 1 && <ResizableHandle withHandle />}
          </Fragment>
        )
      })}
    </ResizablePanelGroup>
  )
})

function DashboardPanel({
  panelId,
  widgetContext,
  canEditContent,
  splitPanelVertical,
  splitPanelHorizontal,
  closePanel,
  replacePanelWidget,
}: {
  panelId: string
  widgetContext: WidgetRuntimeContext
  canEditContent: boolean
  splitPanelVertical?: (panelId: string) => void
  splitPanelHorizontal?: (panelId: string) => void
  closePanel?: (panelId: string) => void
  replacePanelWidget?: (panelId: string, widgetKey: string) => void
}) {
  const { changeWidgetPairColor, patchWidgetLinkedParams, patchWidgetParams } =
    useWidgetConfigRuntimeActions()
  const handlePanelSplitVertical = useCallback(
    () => splitPanelVertical?.(panelId),
    [panelId, splitPanelVertical]
  )
  const handlePanelSplitHorizontal = useCallback(
    () => splitPanelHorizontal?.(panelId),
    [panelId, splitPanelHorizontal]
  )
  const handlePanelClose = useCallback(() => closePanel?.(panelId), [closePanel, panelId])
  const handleWidgetChange = useCallback(
    (widgetKey: string) => replacePanelWidget?.(panelId, widgetKey),
    [panelId, replacePanelWidget]
  )

  return (
    <WidgetSurface
      context={widgetContext}
      panelId={panelId}
      onPairColorChange={canEditContent ? changeWidgetPairColor : undefined}
      onWidgetChange={canEditContent && replacePanelWidget ? handleWidgetChange : undefined}
      onWidgetParamsPatch={canEditContent ? patchWidgetParams : undefined}
      onWidgetLinkedParamsPatch={canEditContent ? patchWidgetLinkedParams : undefined}
      onPanelSplit={splitPanelVertical ? handlePanelSplitVertical : undefined}
      onPanelSplitHorizontal={splitPanelHorizontal ? handlePanelSplitHorizontal : undefined}
      onPanelClose={closePanel ? handlePanelClose : undefined}
    />
  )
}

export function DashboardClient({
  initialTopology,
  workspaceId,
  ownerUserId,
  layoutId,
  initialLayouts,
  workspaceCanWrite,
}: DashboardClientProps) {
  const [isCreatingLayout, setIsCreatingLayout] = useState(false)
  const [pendingActivation, setPendingActivation] = useState<{
    workspaceId: string
    layoutId: string
  } | null>(null)
  const isCreatingLayoutRef = useRef(false)
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
  const t = useTranslations('workspace.dashboard')
  const dashboardLayoutList = useDashboardLayoutList(workspaceId, ownerUserId)
  const layouts = dashboardLayoutList.isLoading ? initialLayouts : dashboardLayoutList.layouts
  const listActiveLayout = useMemo(
    () => layouts.find((layout) => layout.isActive) ?? null,
    [layouts]
  )
  const activeLayoutId = listActiveLayout?.id ?? null
  const activeInitialTopology = useMemo<DashboardLayoutTopologyNode | null>(
    () => (activeLayoutId === layoutId ? initialTopology : null),
    [activeLayoutId, initialTopology, layoutId]
  )
  const layoutDocument = useDashboardLayoutDocument({
    workspaceId,
    ownerUserId,
    layoutId: activeLayoutId,
    initialTopology: activeInitialTopology,
  })
  const rawTree = layoutDocument.topology
  const hasLayoutFailure = Boolean(dashboardLayoutList.error || layoutDocument.error)
  const canMutateLayouts = !dashboardLayoutList.error
  const activePendingActivation =
    pendingActivation?.workspaceId === workspaceId ? pendingActivation : null
  const canClosePanel = rawTree !== null && countDashboardTopologyPanels(rawTree) > 1
  const isActiveDocumentReady =
    !hasLayoutFailure &&
    layoutDocument.isProviderReady &&
    rawTree !== null &&
    activeLayoutId !== null
  const canEditContent = !activePendingActivation && isActiveDocumentReady

  useEffect(() => {
    if (!activePendingActivation) return
    const targetIsActive = activeLayoutId === activePendingActivation.layoutId
    if (
      dashboardLayoutList.isTerminalError ||
      (targetIsActive && (layoutDocument.isTerminalError || isActiveDocumentReady))
    ) {
      setPendingActivation(null)
    }
  }, [
    activeLayoutId,
    dashboardLayoutList.isTerminalError,
    layoutDocument.isTerminalError,
    activePendingActivation,
    isActiveDocumentReady,
  ])

  useEffect(() => {
    setPendingActivation((current) => (current?.workspaceId === workspaceId ? current : null))
  }, [workspaceId])

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
      layoutDocument.updateGroupSizes(groupId, sizes)
    },
    [canEditContent, layoutDocument.updateGroupSizes]
  )

  const canWriteNestedEntities = workspaceCanWrite && canEditContent
  const widgetContext = useMemo<WidgetRuntimeContext>(
    () => ({
      workspaceId,
      dashboardLayoutId: activeLayoutId ?? undefined,
      dashboardLayoutName: listActiveLayout?.name,
      dashboardLayoutOwnerUserId: ownerUserId,
      canWrite: canWriteNestedEntities,
    }),
    [activeLayoutId, canWriteNestedEntities, listActiveLayout?.name, ownerUserId, workspaceId]
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

  const mutatePanelStructure = useCallback(
    async (mutation: Exclude<DashboardLayoutStructureMutation, { type: 'resize' }>) => {
      if (!canEditContent) return
      try {
        await layoutDocument.mutateStructure(mutation)
      } catch (error) {
        console.error('Failed to update dashboard layout structure:', error)
      }
    },
    [canEditContent, layoutDocument.mutateStructure]
  )

  const handleSplitPanelVertical = useCallback(
    (panelId: string) => mutatePanelStructure({ type: 'split', panelId, direction: 'vertical' }),
    [mutatePanelStructure]
  )

  const handleSplitPanelHorizontal = useCallback(
    (panelId: string) => mutatePanelStructure({ type: 'split', panelId, direction: 'horizontal' }),
    [mutatePanelStructure]
  )

  const handleClosePanel = useCallback(
    (panelId: string) => mutatePanelStructure({ type: 'close', panelId }),
    [mutatePanelStructure]
  )

  const handleReplacePanelWidget = useCallback(
    (panelId: string, widgetKey: string) =>
      mutatePanelStructure({ type: 'replace', panelId, widgetKey }),
    [mutatePanelStructure]
  )

  const handleSelectLayout = useCallback(
    async (nextLayoutId: string) => {
      if (
        !canMutateLayouts ||
        !nextLayoutId ||
        nextLayoutId === activeLayoutId ||
        activePendingActivation
      )
        return
      setPendingActivation({ workspaceId, layoutId: nextLayoutId })

      let keepPending = false
      try {
        keepPending = (await activateDashboardLayoutAction(workspaceId, nextLayoutId)).listConverged
      } catch (error) {
        console.error('Failed to switch layout:', error)
      }
      if (!keepPending) {
        setPendingActivation((current) =>
          current?.workspaceId === workspaceId && current.layoutId === nextLayoutId ? null : current
        )
      }
    },
    [activeLayoutId, activePendingActivation, canMutateLayouts, workspaceId]
  )

  const handleRenameLayout = useCallback(
    async (layoutId: string, name: string) => {
      if (!canMutateLayouts) return
      try {
        await renameSavedEntityAction({
          entityKind: 'dashboard_layout',
          entityId: layoutId,
          workspaceId,
          name,
        })
      } catch (error) {
        console.error('Failed to rename layout:', error)
      }
    },
    [canMutateLayouts, workspaceId]
  )

  const handleDeleteLayout = useCallback(
    async (layoutId: string) => {
      if (!canMutateLayouts) return
      try {
        await deleteDashboardLayoutAction(workspaceId, layoutId)
      } catch (error) {
        console.error('Failed to delete layout:', error)
      }
    },
    [canMutateLayouts, workspaceId]
  )

  const handleReorderLayouts = useCallback(
    (layoutOrder: string[]) => {
      if (!canMutateLayouts) return
      reorderDashboardLayoutsAction(workspaceId, layoutOrder).catch((error) => {
        console.error('Failed to reorder layouts:', error)
      })
    },
    [canMutateLayouts, workspaceId]
  )

  const handleAddLayout = useCallback(async () => {
    if (!canMutateLayouts || isCreatingLayoutRef.current) return

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
  }, [canMutateLayouts, workspaceId])

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
      isBusy={isCreatingLayout || activePendingActivation !== null}
      canMutate={canMutateLayouts}
      onSelect={handleSelectLayout}
      onReorder={handleReorderLayouts}
      onCreate={handleAddLayout}
      onRename={handleRenameLayout}
      onDelete={handleDeleteLayout}
    />
  )

  const layoutDocumentState =
    dashboardLayoutList.error || layoutDocument.error
      ? 'error'
      : dashboardLayoutList.isLoading || layoutDocument.isLoading
        ? 'loading'
        : 'empty'
  const layoutDocumentMessage =
    layoutDocumentState === 'error'
      ? t('layoutState.error')
      : layoutDocumentState === 'loading'
        ? t('layoutState.loading')
        : t('layoutState.empty')

  return (
    <>
      <GlobalNavbarHeader left={headerLeftContent} center={headerCenterContent} />
      <div className='relative h-full min-h-0 w-full min-w-0 overflow-hidden'>
        {layoutDocument.hasResizePersistenceError && (
          <div
            className='absolute top-3 right-3 z-10 rounded-md bg-destructive px-3 py-2 text-destructive-foreground text-sm shadow-sm'
            role='alert'
          >
            {t('layoutState.resizePersistenceError')}
          </div>
        )}
        {rawTree && layoutDocument.doc ? (
          <DashboardNode
            node={rawTree}
            workspaceId={workspaceId}
            ownerUserId={ownerUserId}
            layoutId={activeLayoutId as string}
            persistGroup={canEditContent ? persistGroup : undefined}
            resizeReconcileVersion={layoutDocument.resizeReconcileVersion}
            widgetContext={widgetContext}
            availableWidth={100}
            availableHeight={100}
            canEditContent={canEditContent}
            splitPanelVertical={canEditContent ? handleSplitPanelVertical : undefined}
            splitPanelHorizontal={canEditContent ? handleSplitPanelHorizontal : undefined}
            closePanel={canEditContent && canClosePanel ? handleClosePanel : undefined}
            replacePanelWidget={canEditContent ? handleReplacePanelWidget : undefined}
          />
        ) : (
          <div
            className='flex h-full items-center justify-center text-muted-foreground text-sm'
            data-state={layoutDocumentState}
            data-testid='dashboard-layout-document-state'
            role={layoutDocumentState === 'error' ? 'alert' : 'status'}
          >
            {layoutDocumentMessage}
          </div>
        )}
      </div>
    </>
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
