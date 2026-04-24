'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Loader2, PanelLeft, RefreshCw } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { parseQuery, serializeQuery } from '@/lib/logs/query-parser'
import { type MonitorRowSuggestionData, type WorkflowData } from '@/lib/logs/search-suggestions'
import { MONITOR_QUERY_POLICY } from '@/lib/logs/query-policy'
import { toListingValueObject } from '@/lib/listing/identity'
import { GlobalNavbarHeader } from '@/global-navbar'
import { useLogDetail } from '@/hooks/queries/logs'
import { type LayoutTab, LayoutTabs } from '@/app/workspace/[workspaceId]/dashboard/layout-tabs'
import { AutocompleteSearch } from '@/app/workspace/[workspaceId]/logs/components/logs-toolbar'
import {
  createIndicatorMonitor,
  createMonitorView,
  deleteIndicatorMonitor,
  listMonitorViews,
  loadIndicatorOptions,
  loadMonitors,
  loadWorkflowOptions,
  loadWorkflowTargetOptions,
  removeMonitorView,
  reorderMonitorViews,
  setActiveMonitorView,
  updateIndicatorMonitor,
  updateMonitorView,
} from '@/app/workspace/[workspaceId]/monitor/components/data/api'
import { MonitorExecutionWorkspace } from '@/app/workspace/[workspaceId]/monitor/components/workspace/monitor-execution-workspace'
import { MonitorManagementPane } from '@/app/workspace/[workspaceId]/monitor/components/management/monitor-management-pane'
import type {
  IndicatorMonitorMutationInput,
  IndicatorMonitorRecord,
  IndicatorOption,
  WorkflowPickerOption,
  WorkflowTargetOption,
} from '@/app/workspace/[workspaceId]/monitor/components/shared/types'
import {
  createMonitorQuickFilterClause,
  useMonitorWorkspaceLogs,
} from '@/app/workspace/[workspaceId]/monitor/components/data/use-monitor-workspace-logs'
import { bootstrapMonitorViews } from '@/app/workspace/[workspaceId]/monitor/components/view/view-bootstrap'
import {
  DEFAULT_MONITOR_VIEW_CONFIG,
  normalizeMonitorViewConfig,
  type MonitorQuickFilterField,
  type MonitorViewConfig,
  type MonitorViewRow,
} from '@/app/workspace/[workspaceId]/monitor/components/view/view-config'
import {
  readMonitorWorkingState,
  writeMonitorWorkingState,
} from '@/app/workspace/[workspaceId]/monitor/components/view/view-preferences'

type MonitorPageProps = {
  workspaceId: string
  userId: string
}

const DESKTOP_MONITORS_PANE_DEFAULT = [28, 72] as [number, number]

const areConfigsEqual = (left: MonitorViewConfig, right: MonitorViewConfig) =>
  JSON.stringify(left) === JSON.stringify(right)

const sortViewRows = (rows: MonitorViewRow[]) =>
  [...rows].sort((left, right) => left.sortOrder - right.sortOrder)

const getNextOrdinalViewName = (rows: MonitorViewRow[]) => {
  let index = 1
  while (rows.some((row) => row.name === `View ${index}`)) {
    index += 1
  }
  return `View ${index}`
}

const getListingLabel = (listing: unknown) => {
  const normalized = toListingValueObject(listing as any)
  if (!normalized) return 'Unknown listing'
  if (normalized.listing_type === 'default') {
    return normalized.listing_id || 'Unknown listing'
  }
  return [normalized.base_id, normalized.quote_id].filter(Boolean).join('/') || 'Unknown listing'
}

const toMonitorRowSuggestions = (monitors: IndicatorMonitorRecord[]): MonitorRowSuggestionData[] =>
  monitors.map((monitor) => ({
    monitorId: monitor.monitorId,
    monitorLabel: monitor.monitorId,
    providerId: monitor.providerConfig.monitor.providerId,
    interval: monitor.providerConfig.monitor.interval,
    listing: monitor.providerConfig.monitor.listing,
    listingLabel: getListingLabel(monitor.providerConfig.monitor.listing),
  }))

export function MonitorPage({ workspaceId, userId }: MonitorPageProps) {
  const isMobile = useIsMobile()
  const pathname = usePathname()
  const workingStateScope = `${workspaceId}:${userId}`
  const [monitors, setMonitors] = useState<IndicatorMonitorRecord[]>([])
  const [monitorsLoading, setMonitorsLoading] = useState(true)
  const [referenceLoading, setReferenceLoading] = useState(true)
  const [monitorsError, setMonitorsError] = useState<string | null>(null)
  const [referenceWarning, setReferenceWarning] = useState<string | null>(null)
  const [indicatorOptions, setIndicatorOptions] = useState<IndicatorOption[]>([])
  const [workflowTargets, setWorkflowTargets] = useState<WorkflowTargetOption[]>([])
  const [workflowOptions, setWorkflowOptions] = useState<WorkflowPickerOption[]>([])
  const [workingState, setWorkingState] = useState(() =>
    readMonitorWorkingState(workspaceId, userId)
  )
  const [hydratedWorkingStateScope, setHydratedWorkingStateScope] = useState(workingStateScope)
  const [isMonitorsSheetOpen, setIsMonitorsSheetOpen] = useState(false)
  const [isRefreshingAll, setIsRefreshingAll] = useState(false)

  const [viewRows, setViewRows] = useState<MonitorViewRow[]>([])
  const [activeViewId, setActiveViewId] = useState<string | null>(null)
  const [viewConfig, setViewConfig] = useState<MonitorViewConfig>(DEFAULT_MONITOR_VIEW_CONFIG)
  const [viewStateMode, setViewStateMode] = useState<'loading' | 'server' | 'error'>('loading')
  const [viewStateReloading, setViewStateReloading] = useState(false)
  const [viewsError, setViewsError] = useState<string | null>(null)
  const [viewBusyAction, setViewBusyAction] = useState<string | null>(null)
  const [isCreateViewDialogOpen, setIsCreateViewDialogOpen] = useState(false)
  const [nameDialogValue, setNameDialogValue] = useState('')
  const [nameDialogBusy, setNameDialogBusy] = useState(false)
  const [selectedExecutionLogId, setSelectedExecutionLogId] = useState<string | null>(null)

  const effectiveConfig = viewConfig
  const activeViewRow = useMemo(
    () =>
      viewRows.find((row) => row.id === activeViewId) ??
      viewRows.find((row) => row.isActive) ??
      null,
    [activeViewId, viewRows]
  )
  const bootstrapRequestRef = useRef(0)
  const activeViewIdRef = useRef<string | null>(null)
  const loadedViewIdRef = useRef<string | null>(null)
  const latestConfigRef = useRef<MonitorViewConfig>(DEFAULT_MONITOR_VIEW_CONFIG)
  const viewStateModeRef = useRef<'loading' | 'server' | 'error'>('loading')

  useEffect(() => {
    activeViewIdRef.current = activeViewId
  }, [activeViewId])

  useEffect(() => {
    viewStateModeRef.current = viewStateMode
  }, [viewStateMode])

  useEffect(() => {
    latestConfigRef.current = viewConfig
  }, [viewConfig])

  useEffect(() => {
    setHydratedWorkingStateScope(workingStateScope)
    setWorkingState(readMonitorWorkingState(workspaceId, userId))
  }, [userId, workingStateScope, workspaceId])

  useEffect(() => {
    if (hydratedWorkingStateScope !== workingStateScope) {
      return
    }

    writeMonitorWorkingState(workspaceId, userId, workingState)
  }, [hydratedWorkingStateScope, userId, workingState, workingStateScope, workspaceId])

  const updateViewConfig = useCallback(
    (next: MonitorViewConfig | ((current: MonitorViewConfig) => MonitorViewConfig)) => {
      const resolved = typeof next === 'function' ? next(latestConfigRef.current) : next
      const normalized = normalizeMonitorViewConfig(resolved)
      const targetViewId = loadedViewIdRef.current ?? activeViewIdRef.current

      latestConfigRef.current = normalized
      setViewConfig((current) => (areConfigsEqual(current, normalized) ? current : normalized))

      if (!targetViewId) {
        return
      }

      const updatedAt = new Date().toISOString()
      setViewRows((current) =>
        current.map((row) =>
          row.id === targetViewId && !areConfigsEqual(row.config, normalized)
            ? { ...row, config: normalized, updatedAt }
            : row
        )
      )
    },
    []
  )

  const persistViewImmediate = useCallback(
    async (viewIdOverride?: string | null, configOverride?: MonitorViewConfig) => {
      const targetViewId = viewIdOverride ?? loadedViewIdRef.current
      if (!targetViewId || viewStateModeRef.current !== 'server') return

      await updateMonitorView(workspaceId, targetViewId, {
        config: normalizeMonitorViewConfig(configOverride ?? latestConfigRef.current),
      })
    },
    [workspaceId]
  )

  const persistView = useCallback(async () => {
    const targetViewId = loadedViewIdRef.current
    if (!targetViewId || viewStateModeRef.current !== 'server') return

    const body = JSON.stringify({
      config: normalizeMonitorViewConfig(latestConfigRef.current),
    })

    try {
      await fetch(
        `/api/workspaces/${encodeURIComponent(
          workspaceId
        )}/monitor-views/${encodeURIComponent(targetViewId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }
      )
    } catch {
      // Persisting on unload mirrors dashboard behavior and should not block navigation.
    }
  }, [workspaceId])

  useEffect(() => {
    const handleBeforeUnload = () => {
      void persistView()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void persistView()
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      void persistView()
    }
  }, [persistView])

  useEffect(() => {
    return () => {
      void persistView()
    }
  }, [pathname, persistView])

  const reloadViewState = useCallback(async () => {
    const requestId = ++bootstrapRequestRef.current
    const isInitialLoad = viewStateModeRef.current === 'loading'

    if (isInitialLoad) {
      setViewStateMode('loading')
    } else {
      setViewStateReloading(true)
    }
    setViewsError(null)

    const result = await bootstrapMonitorViews({
      workspaceId,
      listMonitorViews,
      createMonitorView,
    })

    if (bootstrapRequestRef.current !== requestId) {
      return
    }

    if (!isInitialLoad && result.viewStateMode === 'error') {
      setViewStateReloading(false)
      setViewsError(result.viewsError)
      return
    }

    if (result.activeViewId !== activeViewIdRef.current) {
      setSelectedExecutionLogId(null)
    }
    setViewRows(sortViewRows(result.viewRows))
    setActiveViewId(result.activeViewId)
    loadedViewIdRef.current = result.activeViewId
    latestConfigRef.current = result.viewConfig
    setViewConfig(result.viewConfig)
    setViewStateMode(result.viewStateMode)
    setViewStateReloading(false)
    setViewsError(result.viewsError)
  }, [workspaceId])

  useEffect(() => {
    void reloadViewState()

    return () => {
      bootstrapRequestRef.current += 1
    }
  }, [reloadViewState])

  const loadMonitorData = useCallback(async () => {
    setMonitorsLoading(true)
    setReferenceLoading(true)
    setMonitorsError(null)
    setReferenceWarning(null)

    const [monitorsResult, indicatorResult, targetsResult, workflowsResult] =
      await Promise.allSettled([
        loadMonitors(workspaceId),
        loadIndicatorOptions(workspaceId),
        loadWorkflowTargetOptions(workspaceId),
        loadWorkflowOptions(workspaceId),
      ])

    if (monitorsResult.status === 'fulfilled') {
      setMonitors(monitorsResult.value)
      setMonitorsLoading(false)
    } else {
      setMonitors([])
      setMonitorsLoading(false)
      setMonitorsError(
        monitorsResult.reason instanceof Error
          ? monitorsResult.reason.message
          : 'Failed to load monitors'
      )
    }

    let nextReferenceWarning: string | null = null

    if (indicatorResult.status === 'fulfilled') {
      setIndicatorOptions(indicatorResult.value)
    } else {
      setIndicatorOptions([])
      nextReferenceWarning = 'Indicator options are unavailable right now.'
    }

    if (targetsResult.status === 'fulfilled') {
      setWorkflowTargets(targetsResult.value)
    } else {
      setWorkflowTargets([])
      nextReferenceWarning = nextReferenceWarning ?? 'Workflow targets are unavailable right now.'
    }

    if (workflowsResult.status === 'fulfilled') {
      setWorkflowOptions(workflowsResult.value)
    } else {
      setWorkflowOptions([])
      nextReferenceWarning = nextReferenceWarning ?? 'Workflow options are unavailable right now.'
    }

    setReferenceWarning(nextReferenceWarning)
    setReferenceLoading(false)
  }, [workspaceId])

  useEffect(() => {
    void loadMonitorData()
  }, [loadMonitorData])

  const { executionItems, orderedVisibleLogIds, isSelectionResolved, isLoading, error, refresh } =
    useMonitorWorkspaceLogs({
      workspaceId,
      viewConfig: effectiveConfig,
      monitors,
    })

  const selectedExecution = useMemo(
    () => executionItems.find((item) => item.logId === selectedExecutionLogId) ?? null,
    [executionItems, selectedExecutionLogId]
  )

  useEffect(() => {
    if (!selectedExecutionLogId) return
    if (!isSelectionResolved) return
    if (orderedVisibleLogIds.includes(selectedExecutionLogId)) return
    setSelectedExecutionLogId(null)
  }, [isSelectionResolved, orderedVisibleLogIds, selectedExecutionLogId])

  const logDetailQuery = useLogDetail(selectedExecutionLogId ?? undefined)
  const selectedExecutionIndex = selectedExecutionLogId
    ? orderedVisibleLogIds.indexOf(selectedExecutionLogId)
    : -1

  const monitorRowSuggestions = useMemo(() => toMonitorRowSuggestions(monitors), [monitors])
  const workflowSuggestionData = useMemo<WorkflowData[]>(
    () =>
      workflowOptions.map((option) => ({
        id: option.workflowId,
        name: option.workflowName,
      })),
    [workflowOptions]
  )
  const parsedFilterQuery = useMemo(
    () => parseQuery(effectiveConfig.filterQuery, MONITOR_QUERY_POLICY),
    [effectiveConfig.filterQuery]
  )
  const externalQuickFilterClauses = useMemo(() => {
    const committedClauses = new Set(parsedFilterQuery.clauses.map((clause) => clause.raw))
    return effectiveConfig.quickFilters
      .map(createMonitorQuickFilterClause)
      .filter((clause) => !committedClauses.has(clause.raw))
  }, [effectiveConfig.quickFilters, parsedFilterQuery.clauses])
  const activeQuickFilterClauseRaws = useMemo(() => {
    const clauseRaws = new Set(parsedFilterQuery.clauses.map((clause) => clause.raw))

    effectiveConfig.quickFilters.forEach((filter) => {
      clauseRaws.add(createMonitorQuickFilterClause(filter).raw)
    })

    return clauseRaws
  }, [effectiveConfig.quickFilters, parsedFilterQuery.clauses])

  const commitFilterQuery = useCallback(
    (nextQuery: string) => {
      updateViewConfig((current) => ({
        ...current,
        filterQuery: nextQuery,
      }))
    },
    [updateViewConfig]
  )

  const handleToggleQuickFilter = useCallback(
    (field: MonitorQuickFilterField, value: string) => {
      updateViewConfig((current) => {
        const targetFilter = {
          field,
          operator: 'include' as const,
          values: [value],
        }
        const targetClause = createMonitorQuickFilterClause(targetFilter)
        const parsedCurrentQuery = parseQuery(current.filterQuery, MONITOR_QUERY_POLICY)
        const nextClauses = parsedCurrentQuery.clauses.filter(
          (clause) => clause.raw !== targetClause.raw
        )
        const nextQuickFilters = current.quickFilters.filter(
          (filter) => createMonitorQuickFilterClause(filter).raw !== targetClause.raw
        )
        const quickFilterRemoved = nextQuickFilters.length !== current.quickFilters.length
        const committedClauseRemoved = nextClauses.length !== parsedCurrentQuery.clauses.length

        if (quickFilterRemoved || committedClauseRemoved) {
          return {
            ...current,
            filterQuery: committedClauseRemoved
              ? serializeQuery(
                  {
                    clauses: nextClauses,
                    textSearch: parsedCurrentQuery.textSearch,
                  },
                  MONITOR_QUERY_POLICY
                )
              : current.filterQuery,
            quickFilters: nextQuickFilters,
          }
        }

        return {
          ...current,
          quickFilters: current.quickFilters.concat(targetFilter),
        }
      })
    },
    [updateViewConfig]
  )

  const isQuickFilterActive = useCallback(
    (field: MonitorQuickFilterField, value: string) =>
      activeQuickFilterClauseRaws.has(
        createMonitorQuickFilterClause({
          field,
          operator: 'include',
          values: [value],
        }).raw
      ),
    [activeQuickFilterClauseRaws]
  )

  const handleRefreshAll = useCallback(async () => {
    setIsRefreshingAll(true)
    try {
      await persistViewImmediate()
      await Promise.allSettled([refresh(), loadMonitorData(), reloadViewState()])
    } catch (errorValue) {
      setViewsError(
        errorValue instanceof Error ? errorValue.message : 'Failed to persist view before refresh'
      )
      await Promise.allSettled([refresh(), loadMonitorData()])
    } finally {
      setIsRefreshingAll(false)
    }
  }, [loadMonitorData, persistViewImmediate, refresh, reloadViewState])

  const upsertMonitor = useCallback((nextMonitor: IndicatorMonitorRecord) => {
    setMonitors((current) => [
      nextMonitor,
      ...current.filter((monitor) => monitor.monitorId !== nextMonitor.monitorId),
    ])
    return nextMonitor
  }, [])

  const handleCreateMonitor = useCallback(
    async (input: IndicatorMonitorMutationInput) => {
      setMonitorsError(null)

      try {
        const savedMonitor = await createIndicatorMonitor(input)
        if (savedMonitor) {
          upsertMonitor(savedMonitor)
        }
        return savedMonitor
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create monitor'
        setMonitorsError(message)
        throw error instanceof Error ? error : new Error(message)
      }
    },
    [upsertMonitor]
  )

  const handleUpdateMonitor = useCallback(
    async (monitorId: string, input: IndicatorMonitorMutationInput) => {
      setMonitorsError(null)

      try {
        const savedMonitor = await updateIndicatorMonitor(monitorId, input)
        if (savedMonitor) {
          upsertMonitor(savedMonitor)
        }
        return savedMonitor
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to update monitor'
        setMonitorsError(message)
        throw error instanceof Error ? error : new Error(message)
      }
    },
    [upsertMonitor]
  )

  const handleToggleMonitorState = useCallback(
    async (monitor: IndicatorMonitorRecord, nextIsActive: boolean) => {
      setMonitorsError(null)

      try {
        const savedMonitor = await updateIndicatorMonitor(monitor.monitorId, {
          workspaceId,
          isActive: nextIsActive,
        })
        if (savedMonitor) {
          upsertMonitor(savedMonitor)
        }
        return savedMonitor
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to update monitor state'
        setMonitorsError(message)
        throw error instanceof Error ? error : new Error(message)
      }
    },
    [upsertMonitor, workspaceId]
  )

  const handleDeleteMonitor = useCallback(async (monitorId: string) => {
    setMonitorsError(null)

    try {
      await deleteIndicatorMonitor(monitorId)
      setMonitors((current) => current.filter((monitor) => monitor.monitorId !== monitorId))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete monitor'
      setMonitorsError(message)
      throw error instanceof Error ? error : new Error(message)
    }
  }, [])

  const handleRemoveQuickFilterClause = useCallback(
    (targetClause: ReturnType<typeof createMonitorQuickFilterClause>) => {
      updateViewConfig((current) => {
        const nextQuickFilters = current.quickFilters.filter(
          (filter) => createMonitorQuickFilterClause(filter).raw !== targetClause.raw
        )

        if (nextQuickFilters.length === current.quickFilters.length) {
          return current
        }

        return {
          ...current,
          quickFilters: nextQuickFilters,
        }
      })
    },
    [updateViewConfig]
  )

  const handleReorderColumnCards = useCallback(
    (columnId: string, nextExecutionIds: string[]) => {
      updateViewConfig((current) => ({
        ...current,
        kanban: {
          ...current.kanban,
          localCardOrder: {
            ...current.kanban.localCardOrder,
            [columnId]: nextExecutionIds,
          },
        },
      }))
    },
    [updateViewConfig]
  )

  const handleOpenCreateViewDialog = useCallback(() => {
    setViewsError(null)
    setIsCreateViewDialogOpen(true)
    setNameDialogValue(getNextOrdinalViewName(viewRows))
  }, [viewRows])

  const handleCloseNameDialog = useCallback(() => {
    if (nameDialogBusy) return

    setIsCreateViewDialogOpen(false)
    setNameDialogValue('')
  }, [nameDialogBusy])

  const handleActivateView = useCallback(
    async (viewId: string) => {
      if (viewId === activeViewId) return

      const nextRow = viewRows.find((row) => row.id === viewId)
      if (!nextRow) return

      setViewBusyAction('activate')
      setViewsError(null)

      try {
        try {
          await persistViewImmediate(loadedViewIdRef.current, latestConfigRef.current)
        } catch (error) {
          console.error('Failed to persist current monitor view:', error)
        }

        await setActiveMonitorView(workspaceId, viewId)
        const nextConfig = normalizeMonitorViewConfig(nextRow.config)
        setViewRows((current) =>
          current.map((row) => ({
            ...row,
            isActive: row.id === viewId,
          }))
        )
        setSelectedExecutionLogId(null)
        setActiveViewId(viewId)
        loadedViewIdRef.current = viewId
        latestConfigRef.current = nextConfig
        setViewConfig(nextConfig)
      } catch (errorValue) {
        setViewsError(errorValue instanceof Error ? errorValue.message : 'Failed to activate view')
      } finally {
        setViewBusyAction(null)
      }
    },
    [activeViewId, persistViewImmediate, viewRows, workspaceId]
  )

  const handleSubmitNameDialog = useCallback(async () => {
    if (!isCreateViewDialogOpen) return

    const trimmedName = nameDialogValue.trim()
    if (!trimmedName) {
      setViewsError('Name cannot be empty')
      return
    }

    setNameDialogBusy(true)
    setViewBusyAction('create')
    setViewsError(null)

    try {
      try {
        await persistViewImmediate(loadedViewIdRef.current, latestConfigRef.current)
      } catch (error) {
        console.error('Failed to persist current monitor view:', error)
      }

      const createdRow = await createMonitorView(workspaceId, {
        name: trimmedName,
        config: effectiveConfig,
        makeActive: true,
      })

      setViewRows((current) =>
        sortViewRows(
          current
            .map((row) => ({ ...row, isActive: false }))
            .concat([{ ...createdRow, isActive: true }])
        )
      )
      setSelectedExecutionLogId(null)
      setActiveViewId(createdRow.id)
      const nextConfig = normalizeMonitorViewConfig(createdRow.config)
      loadedViewIdRef.current = createdRow.id
      latestConfigRef.current = nextConfig
      setViewConfig(nextConfig)
      setIsCreateViewDialogOpen(false)
      setNameDialogValue('')
    } catch (errorValue) {
      setViewsError(errorValue instanceof Error ? errorValue.message : 'Failed to create view')
    } finally {
      setNameDialogBusy(false)
      setViewBusyAction(null)
    }
  }, [effectiveConfig, isCreateViewDialogOpen, nameDialogValue, persistViewImmediate, workspaceId])

  const handleRenameView = useCallback(
    async (viewId: string, name: string) => {
      setViewBusyAction('rename')
      setViewsError(null)

      try {
        await updateMonitorView(workspaceId, viewId, { name })
        setViewRows((current) =>
          current.map((row) =>
            row.id === viewId
              ? {
                  ...row,
                  name,
                  updatedAt: new Date().toISOString(),
                }
              : row
          )
        )
      } catch (errorValue) {
        setViewsError(errorValue instanceof Error ? errorValue.message : 'Failed to rename view')
      } finally {
        setViewBusyAction(null)
      }
    },
    [workspaceId]
  )

  const handleReorderViews = useCallback(
    async (nextLayouts: LayoutTab[]) => {
      const nextRows = nextLayouts
        .map((layout, index) => {
          const current = viewRows.find((row) => row.id === layout.id)
          return current
            ? {
                ...current,
                sortOrder: index,
              }
            : null
        })
        .filter((row): row is MonitorViewRow => Boolean(row))
      const previousRows = viewRows

      setViewRows(nextRows)
      setViewBusyAction('reorder')
      setViewsError(null)

      try {
        await reorderMonitorViews(workspaceId, {
          viewOrder: nextRows.map((row) => row.id),
          activeViewId: activeViewId ?? undefined,
        })
      } catch (errorValue) {
        setViewRows(previousRows)
        setViewsError(errorValue instanceof Error ? errorValue.message : 'Failed to reorder views')
      } finally {
        setViewBusyAction(null)
      }
    },
    [activeViewId, viewRows, workspaceId]
  )

  const handleDeleteView = useCallback(
    async (viewId: string) => {
      if (!viewId || viewRows.length <= 1) return

      const previousRows = viewRows
      setViewBusyAction('delete')
      setViewsError(null)
      setViewRows((current) => current.filter((row) => row.id !== viewId))

      try {
        await removeMonitorView(workspaceId, viewId)
        if (viewId === activeViewId) {
          setSelectedExecutionLogId(null)
          loadedViewIdRef.current = null
          await reloadViewState()
        }
      } catch (errorValue) {
        setViewRows(previousRows)
        setViewsError(errorValue instanceof Error ? errorValue.message : 'Failed to delete view')
      } finally {
        setViewBusyAction(null)
      }
    },
    [activeViewId, reloadViewState, viewRows, workspaceId]
  )

  const headerLeft = (
    <div className='flex w-full flex-1 items-center gap-3'>
      <div className='hidden items-center gap-2 sm:flex'>
        <Activity className='h-[18px] w-[18px] text-muted-foreground' />
        <span className='font-medium text-sm'>Monitor</span>
      </div>
      <div className='flex w-full flex-1'>
        <AutocompleteSearch
          value={effectiveConfig.filterQuery}
          onChange={commitFilterQuery}
          queryPolicy={MONITOR_QUERY_POLICY}
          workflowsData={workflowSuggestionData}
          availableMonitorRows={monitorRowSuggestions}
          placeholder='Search executions...'
          className='w-full'
          externalClauses={externalQuickFilterClauses}
          onRemoveExternalClause={handleRemoveQuickFilterClause}
        />
      </div>
    </div>
  )

  const layouts: LayoutTab[] = viewRows.map((row) => ({
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    isActive: row.id === activeViewId,
  }))

  const headerCenter =
    viewRows.length > 0 ? (
      <LayoutTabs
        layouts={layouts}
        isBusy={Boolean(viewBusyAction) || viewStateReloading || viewStateMode === 'loading'}
        onSelect={handleActivateView}
        onReorder={handleReorderViews}
        onCreate={handleOpenCreateViewDialog}
        onRename={handleRenameView}
        onDelete={handleDeleteView}
      />
    ) : (
      <div className='flex items-center justify-center text-muted-foreground text-sm'>
        {viewStateMode === 'loading' ? (
          <span className='inline-flex items-center gap-2'>
            <Loader2 className='h-4 w-4 animate-spin' />
            Loading views…
          </span>
        ) : (
          'Views unavailable'
        )}
      </div>
    )

  const headerRight = (
    <div className='flex items-center gap-2'>
      <Button
        variant='ghost'
        size='icon'
        className='h-9 w-9'
        onClick={() => {
          void handleRefreshAll()
        }}
        disabled={isRefreshingAll}
      >
        {isRefreshingAll ? (
          <Loader2 className='h-4 w-4 animate-spin' />
        ) : (
          <RefreshCw className='h-4 w-4' />
        )}
        <span className='sr-only'>Refresh monitor workspace</span>
      </Button>
      <Button
        variant='outline'
        size='sm'
        className='h-9 gap-2'
        onClick={() => {
          if (isMobile) {
            setIsMonitorsSheetOpen(true)
            return
          }

          setWorkingState((current) => ({
            ...current,
            isMonitorsPaneOpen: !current.isMonitorsPaneOpen,
          }))
        }}
      >
        <PanelLeft className='h-4 w-4' />
        Monitors
      </Button>
    </div>
  )

  const managementPane = (
    <MonitorManagementPane
      workspaceId={workspaceId}
      monitors={monitors}
      monitorsLoading={monitorsLoading}
      monitorsError={monitorsError}
      referenceLoading={referenceLoading}
      referenceWarning={referenceWarning}
      indicatorOptions={indicatorOptions}
      workflowTargets={workflowTargets}
      workflowOptions={workflowOptions}
      onCreateMonitor={handleCreateMonitor}
      onUpdateMonitor={handleUpdateMonitor}
      onToggleMonitorState={handleToggleMonitorState}
      onDeleteMonitor={handleDeleteMonitor}
    />
  )

  const workspace = (
    <MonitorExecutionWorkspace
      viewStateMode={viewStateMode}
      viewStateReloading={viewStateReloading}
      viewsError={viewsError}
      effectiveConfig={effectiveConfig}
      isCreateViewDialogOpen={isCreateViewDialogOpen}
      nameDialogValue={nameDialogValue}
      nameDialogBusy={nameDialogBusy}
      executionItems={executionItems}
      executionsLoading={isLoading}
      executionsError={error}
      selectedExecutionLogId={selectedExecutionLogId}
      selectedExecution={selectedExecution}
      selectedExecutionLog={logDetailQuery.data ?? null}
      inspectorLoading={Boolean(selectedExecutionLogId) && logDetailQuery.isLoading}
      inspectorError={
        logDetailQuery.error instanceof Error
          ? logDetailQuery.error.message
          : logDetailQuery.error
            ? 'Failed to load execution details'
            : null
      }
      innerPanelSizes={workingState.innerPanelSizes}
      onInnerPanelLayout={(sizes) =>
        setWorkingState((current) => ({
          ...current,
          innerPanelSizes: [sizes[0] ?? 68, sizes[1] ?? 32],
        }))
      }
      onUpdateViewConfig={updateViewConfig}
      onToggleQuickFilter={handleToggleQuickFilter}
      isQuickFilterActive={isQuickFilterActive}
      onReorderColumnCards={handleReorderColumnCards}
      onSelectExecution={setSelectedExecutionLogId}
      onNavigatePrev={() => {
        if (selectedExecutionIndex <= 0) return
        setSelectedExecutionLogId(orderedVisibleLogIds[selectedExecutionIndex - 1] ?? null)
      }}
      onNavigateNext={() => {
        if (
          selectedExecutionIndex < 0 ||
          selectedExecutionIndex >= orderedVisibleLogIds.length - 1
        ) {
          return
        }
        setSelectedExecutionLogId(orderedVisibleLogIds[selectedExecutionIndex + 1] ?? null)
      }}
      hasPrev={selectedExecutionIndex > 0}
      hasNext={
        selectedExecutionIndex >= 0 && selectedExecutionIndex < orderedVisibleLogIds.length - 1
      }
      onChangeNameDialogValue={setNameDialogValue}
      onCloseNameDialog={handleCloseNameDialog}
      onSubmitNameDialog={handleSubmitNameDialog}
      onReloadViews={() => {
        void reloadViewState()
      }}
    />
  )

  return (
    <div className='flex h-full w-full min-h-0 min-w-0 flex-col'>
      <GlobalNavbarHeader left={headerLeft} center={headerCenter} right={headerRight} />
      <div className='flex min-h-0 w-full min-w-0 flex-1 overflow-hidden'>
        {isMobile ? (
          <>
            {workspace}
            <Sheet open={isMonitorsSheetOpen} onOpenChange={setIsMonitorsSheetOpen}>
              <SheetContent side='left' className='w-full p-0 sm:max-w-[420px]'>
                {managementPane}
              </SheetContent>
            </Sheet>
          </>
        ) : workingState.isMonitorsPaneOpen ? (
          <ResizablePanelGroup
            direction='horizontal'
            className='flex min-h-0 w-full min-w-0 flex-1 overflow-hidden'
            onLayout={(sizes) =>
              setWorkingState((current) => ({
                ...current,
                outerPanelSizes: [
                  sizes[0] ?? DESKTOP_MONITORS_PANE_DEFAULT[0],
                  sizes[1] ?? DESKTOP_MONITORS_PANE_DEFAULT[1],
                ],
              }))
            }
          >
            <ResizablePanel
              order={1}
              minSize={18}
              defaultSize={workingState.outerPanelSizes?.[0] ?? DESKTOP_MONITORS_PANE_DEFAULT[0]}
              className='flex h-full max-h-full w-full min-h-0 min-w-0 flex-col overflow-hidden'
            >
              {managementPane}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel
              order={2}
              minSize={35}
              defaultSize={workingState.outerPanelSizes?.[1] ?? DESKTOP_MONITORS_PANE_DEFAULT[1]}
              className='flex h-full max-h-full w-full min-h-0 min-w-0 flex-col overflow-hidden'
            >
              {workspace}
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          workspace
        )}
      </div>
    </div>
  )
}
