'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Download, Loader2, RefreshCw } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MONITOR_QUERY_POLICY } from '@/lib/logs/query-policy'
import { type LayoutTab, LayoutTabs } from '@/app/workspace/[workspaceId]/dashboard/layout-tabs'
import { buildConfigMonitorCards } from '@/app/workspace/[workspaceId]/monitor/components/config/config-card-model'
import { ConfigMonitorSearch } from '@/app/workspace/[workspaceId]/monitor/components/config/config-search'
import {
  createIndicatorMonitor,
  createMonitorView,
  deleteIndicatorMonitor,
  listMonitorViews,
  loadMonitors,
  removeMonitorView,
  reorderMonitorViews,
  setActiveMonitorView,
  updateIndicatorMonitor,
  updateMonitorView,
} from '@/app/workspace/[workspaceId]/monitor/components/data/api'
import { useMonitorReferenceData } from '@/app/workspace/[workspaceId]/monitor/components/data/use-monitor-reference-data'
import {
  buildMonitorExecutionLogFilters,
  createMonitorQuickFilterClause,
  useMonitorWorkspaceLogs,
} from '@/app/workspace/[workspaceId]/monitor/components/data/use-monitor-workspace-logs'
import { MonitorStateCard } from '@/app/workspace/[workspaceId]/monitor/components/shared/monitor-ui'
import type {
  IndicatorMonitorCreateInput,
  IndicatorMonitorRecord,
  IndicatorMonitorUpdateInput,
  MonitorRecordActions,
} from '@/app/workspace/[workspaceId]/monitor/components/shared/types'
import { bootstrapMonitorViews } from '@/app/workspace/[workspaceId]/monitor/components/view/view-bootstrap'
import {
  type ConfigMonitorViewConfig,
  DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
  DEFAULT_CONFIG_PANEL_SIZES,
  DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
  DEFAULT_EXECUTION_PANEL_SIZES,
  type ExecutionMonitorQuickFilterField,
  type ExecutionMonitorViewConfig,
  getNextMonitorViewName,
  MONITOR_PAGE_MODES,
  type MonitorPageMode,
  type MonitorSavedViewConfig,
  type MonitorViewRow,
  normalizeConfigMonitorViewConfig,
  normalizeExecutionMonitorViewConfig,
} from '@/app/workspace/[workspaceId]/monitor/components/view/view-config'
import {
  readMonitorWorkingState,
  writeMonitorWorkingState,
} from '@/app/workspace/[workspaceId]/monitor/components/view/view-preferences'
import { MonitorConfigWorkspace } from '@/app/workspace/[workspaceId]/monitor/components/workspace/monitor-config-workspace'
import { MonitorExecutionWorkspace } from '@/app/workspace/[workspaceId]/monitor/components/workspace/monitor-execution-workspace'
import { AutocompleteSearch } from '@/app/workspace/[workspaceId]/records/components/logs-toolbar'
import { GlobalNavbarHeader } from '@/global-navbar'
import { buildLogsRequestParams, useLogDetail } from '@/hooks/queries/logs'

type MonitorPageProps = {
  workspaceId: string
  userId: string
}

type ViewNameDialogState =
  | { kind: 'create'; mode: MonitorPageMode }
  | { kind: 'rename'; mode: MonitorPageMode; viewId: string }

type MonitorConfigsByMode = {
  executions: ExecutionMonitorViewConfig
  config: ConfigMonitorViewConfig
}

const areSavedConfigsEqual = (
  left: ExecutionMonitorViewConfig | ConfigMonitorViewConfig,
  right: ExecutionMonitorViewConfig | ConfigMonitorViewConfig
) => JSON.stringify(left) === JSON.stringify(right)

const sortViewRows = (rows: MonitorViewRow[]) =>
  [...rows].sort((left, right) => left.sortOrder - right.sortOrder)

const compactViewRows = (rows: MonitorViewRow[]) =>
  sortViewRows(rows).map((row, sortOrder) => ({ ...row, sortOrder }))

const replaceRowsInModeSlots = (
  rows: MonitorViewRow[],
  mode: MonitorPageMode,
  sameModeRows: MonitorViewRow[]
) => {
  let sameModeIndex = 0

  return compactViewRows(
    sortViewRows(rows).map((row) =>
      row.mode === mode ? (sameModeRows[sameModeIndex++] ?? row) : row
    )
  )
}

const normalizeConfigForMode = (
  mode: MonitorPageMode,
  configs: MonitorConfigsByMode
): MonitorSavedViewConfig =>
  mode === 'config'
    ? normalizeConfigMonitorViewConfig(configs.config)
    : normalizeExecutionMonitorViewConfig(configs.executions)

export function MonitorPage({ workspaceId, userId }: MonitorPageProps) {
  const pathname = usePathname()
  const workingStateScope = `${workspaceId}:${userId}`
  const [monitors, setMonitors] = useState<IndicatorMonitorRecord[]>([])
  const [monitorsLoading, setMonitorsLoading] = useState(true)
  const [monitorsError, setMonitorsError] = useState<string | null>(null)
  const referenceData = useMonitorReferenceData(workspaceId)
  const [workingState, setWorkingState] = useState(() =>
    readMonitorWorkingState(workspaceId, userId)
  )
  const [isRefreshingAll, setIsRefreshingAll] = useState(false)

  const [viewRows, setViewRows] = useState<MonitorViewRow[]>([])
  const [activeMode, setActiveMode] = useState<MonitorPageMode>(workingState.activeMode)
  const [activeViewIdsByMode, setActiveViewIdsByMode] = useState<
    Partial<Record<MonitorPageMode, string | null>>
  >({})
  const [configsByMode, setConfigsByMode] = useState<{
    executions: ExecutionMonitorViewConfig
    config: ConfigMonitorViewConfig
  }>({
    executions: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
    config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
  })
  const [viewStateMode, setViewStateMode] = useState<
    'loading' | 'server' | 'partial-error' | 'error'
  >('loading')
  const [renderableModes, setRenderableModes] = useState<MonitorPageMode[]>([])
  const [rowStateByMode, setRowStateByMode] = useState<Record<MonitorPageMode, 'server' | 'error'>>(
    { executions: 'error', config: 'error' }
  )
  const [viewStateReloading, setViewStateReloading] = useState(false)
  const [viewsError, setViewsError] = useState<string | null>(null)
  const [viewBusyAction, setViewBusyAction] = useState<string | null>(null)
  const [viewNameDialog, setViewNameDialog] = useState<ViewNameDialogState | null>(null)
  const [nameDialogValue, setNameDialogValue] = useState('')
  const [nameDialogBusy, setNameDialogBusy] = useState(false)
  const [selectedExecutionLogId, setSelectedExecutionLogId] = useState<string | null>(null)

  const activeViewId = activeViewIdsByMode.executions ?? null
  const activeConfigViewId = activeViewIdsByMode.config ?? null
  const executionViewConfig = configsByMode.executions
  const configViewConfig = configsByMode.config
  const bootstrapRequestRef = useRef(0)
  const activeModeRef = useRef<MonitorPageMode>(activeMode)
  const activeViewIdsByModeRef = useRef<Partial<Record<MonitorPageMode, string | null>>>({})
  const loadedViewIdsByModeRef = useRef<Partial<Record<MonitorPageMode, string | null>>>({})
  const latestConfigsByModeRef = useRef<MonitorConfigsByMode>({
    executions: DEFAULT_EXECUTION_MONITOR_VIEW_CONFIG,
    config: DEFAULT_CONFIG_MONITOR_VIEW_CONFIG,
  })
  const rowStateByModeRef = useRef<Record<MonitorPageMode, 'server' | 'error'>>({
    executions: 'error',
    config: 'error',
  })
  const dirtyModesRef = useRef<Set<MonitorPageMode>>(new Set())
  const viewStateModeRef = useRef<'loading' | 'server' | 'partial-error' | 'error'>('loading')
  const workingStateRef = useRef(workingState)

  useEffect(() => {
    activeModeRef.current = activeMode
  }, [activeMode])

  useEffect(() => {
    activeViewIdsByModeRef.current = activeViewIdsByMode
  }, [activeViewIdsByMode])

  useEffect(() => {
    viewStateModeRef.current = viewStateMode
  }, [viewStateMode])

  useEffect(() => {
    latestConfigsByModeRef.current = configsByMode
  }, [configsByMode])

  useEffect(() => {
    rowStateByModeRef.current = rowStateByMode
  }, [rowStateByMode])

  useEffect(() => {
    workingStateRef.current = workingState
  }, [workingState])

  useEffect(() => {
    const nextWorkingState = readMonitorWorkingState(workspaceId, userId)
    workingStateRef.current = nextWorkingState
    setWorkingState(nextWorkingState)
    setActiveMode(nextWorkingState.activeMode)
  }, [userId, workingStateScope, workspaceId])

  const updateWorkingState = useCallback(
    (updater: typeof workingState | ((current: typeof workingState) => typeof workingState)) => {
      const nextWorkingState =
        typeof updater === 'function' ? updater(workingStateRef.current) : updater
      workingStateRef.current = nextWorkingState
      setWorkingState(nextWorkingState)
      writeMonitorWorkingState(workspaceId, userId, nextWorkingState)
      return nextWorkingState
    },
    [userId, workspaceId]
  )

  const updateViewConfig = useCallback(
    (
      next:
        | ExecutionMonitorViewConfig
        | ((current: ExecutionMonitorViewConfig) => ExecutionMonitorViewConfig)
    ) => {
      const previous = latestConfigsByModeRef.current.executions
      const resolved = typeof next === 'function' ? next(previous) : next
      const normalized = normalizeExecutionMonitorViewConfig(resolved)
      const targetViewId =
        loadedViewIdsByModeRef.current.executions ??
        activeViewIdsByModeRef.current.executions ??
        null

      latestConfigsByModeRef.current = {
        ...latestConfigsByModeRef.current,
        executions: normalized,
      }
      if (targetViewId && !areSavedConfigsEqual(previous, normalized)) {
        dirtyModesRef.current.add('executions')
      }
      setConfigsByMode((current) =>
        areSavedConfigsEqual(current.executions, normalized)
          ? current
          : { ...current, executions: normalized }
      )

      if (!targetViewId) {
        return
      }

      const updatedAt = new Date().toISOString()
      setViewRows((current) =>
        current.map((row) =>
          row.id === targetViewId &&
          !areSavedConfigsEqual(normalizeExecutionMonitorViewConfig(row.config), normalized)
            ? { ...row, config: normalized, updatedAt }
            : row
        )
      )
    },
    []
  )

  const updateConfigViewConfig = useCallback(
    (
      next:
        | ConfigMonitorViewConfig
        | ((current: ConfigMonitorViewConfig) => ConfigMonitorViewConfig)
    ) => {
      const previous = latestConfigsByModeRef.current.config
      const resolved = typeof next === 'function' ? next(previous) : next
      const normalized = normalizeConfigMonitorViewConfig(resolved)
      const targetViewId =
        loadedViewIdsByModeRef.current.config ?? activeViewIdsByModeRef.current.config ?? null

      latestConfigsByModeRef.current = {
        ...latestConfigsByModeRef.current,
        config: normalized,
      }
      if (targetViewId && !areSavedConfigsEqual(previous, normalized)) {
        dirtyModesRef.current.add('config')
      }
      setConfigsByMode((current) =>
        areSavedConfigsEqual(current.config, normalized)
          ? current
          : { ...current, config: normalized }
      )

      if (!targetViewId) {
        return
      }

      const updatedAt = new Date().toISOString()
      setViewRows((current) =>
        current.map((row) =>
          row.id === targetViewId &&
          !areSavedConfigsEqual(normalizeConfigMonitorViewConfig(row.config), normalized)
            ? { ...row, config: normalized, updatedAt }
            : row
        )
      )
    },
    []
  )

  const persistModeImmediate = useCallback(
    async (mode: MonitorPageMode) => {
      if (!dirtyModesRef.current.has(mode)) {
        return
      }

      const targetViewId =
        loadedViewIdsByModeRef.current[mode] ?? activeViewIdsByModeRef.current[mode] ?? null
      if (
        !targetViewId ||
        rowStateByModeRef.current[mode] !== 'server' ||
        (viewStateModeRef.current !== 'server' && viewStateModeRef.current !== 'partial-error')
      ) {
        return
      }

      const normalizedConfig = normalizeConfigForMode(mode, latestConfigsByModeRef.current)
      const updatedRow = await updateMonitorView(workspaceId, targetViewId, {
        config: normalizedConfig,
      })
      dirtyModesRef.current.delete(mode)

      if (mode === 'config') {
        const nextConfig = normalizeConfigMonitorViewConfig(updatedRow.config)
        latestConfigsByModeRef.current = {
          ...latestConfigsByModeRef.current,
          config: nextConfig,
        }
        setConfigsByMode((current) =>
          areSavedConfigsEqual(current.config, nextConfig)
            ? current
            : { ...current, config: nextConfig }
        )
      } else {
        const nextConfig = normalizeExecutionMonitorViewConfig(updatedRow.config)
        latestConfigsByModeRef.current = {
          ...latestConfigsByModeRef.current,
          executions: nextConfig,
        }
        setConfigsByMode((current) =>
          areSavedConfigsEqual(current.executions, nextConfig)
            ? current
            : { ...current, executions: nextConfig }
        )
      }

      setViewRows((current) =>
        current.map((row) =>
          row.id === targetViewId
            ? {
                ...row,
                name: updatedRow.name,
                sortOrder: updatedRow.sortOrder,
                isActive: updatedRow.isActive,
                config: updatedRow.config,
                createdAt: updatedRow.createdAt,
                updatedAt: updatedRow.updatedAt,
              }
            : row
        )
      )
    },
    [workspaceId]
  )

  const persistDirtyModes = useCallback(
    async (modes: MonitorPageMode[] = [...MONITOR_PAGE_MODES]) => {
      for (const mode of modes) {
        await persistModeImmediate(mode)
      }
    },
    [persistModeImmediate]
  )

  const persistDirtyModesKeepalive = useCallback(async () => {
    if (viewStateModeRef.current !== 'server' && viewStateModeRef.current !== 'partial-error') {
      return
    }

    for (const mode of MONITOR_PAGE_MODES) {
      if (!dirtyModesRef.current.has(mode)) continue
      if (rowStateByModeRef.current[mode] !== 'server') continue

      const targetViewId =
        loadedViewIdsByModeRef.current[mode] ?? activeViewIdsByModeRef.current[mode] ?? null
      if (!targetViewId) continue

      const body = JSON.stringify({
        config: normalizeConfigForMode(mode, latestConfigsByModeRef.current),
      })

      try {
        const response = await fetch(
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
        if (!response.ok) continue

        dirtyModesRef.current.delete(mode)
      } catch {
        // Persisting on unload mirrors dashboard behavior and should not block navigation.
      }
    }
  }, [workspaceId])

  useEffect(() => {
    const handleBeforeUnload = () => {
      void persistDirtyModesKeepalive()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void persistDirtyModesKeepalive()
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      void persistDirtyModesKeepalive()
    }
  }, [persistDirtyModesKeepalive])

  useEffect(() => {
    return () => {
      void persistDirtyModesKeepalive()
    }
  }, [pathname, persistDirtyModesKeepalive])

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
      preferredActiveMode: workingStateRef.current.activeMode,
      preferredActiveViewIdsByMode: workingStateRef.current.activeViewIdsByMode,
      listMonitorViews,
      createMonitorView,
    })

    if (bootstrapRequestRef.current !== requestId) {
      return
    }

    const nextViewStateMode = result.viewStateMode
    const executionActiveViewId = result.activeViewIdsByMode.executions ?? null
    const configActiveViewId = result.activeViewIdsByMode.config ?? null
    const executionViewConfig = normalizeExecutionMonitorViewConfig(result.configsByMode.executions)
    const nextConfigViewConfig = normalizeConfigMonitorViewConfig(result.configsByMode.config)
    const allRows = sortViewRows(result.viewRows)
    const previousExecutionViewId = activeViewIdsByModeRef.current.executions ?? null

    if (!isInitialLoad && nextViewStateMode === 'error') {
      setViewStateReloading(false)
      setViewsError(result.viewsError)
      return
    }

    if (
      executionActiveViewId !== previousExecutionViewId ||
      !result.renderableModes.includes('executions')
    ) {
      setSelectedExecutionLogId(null)
    }
    const nextActiveViewIdsByMode = {
      executions: executionActiveViewId,
      config: configActiveViewId,
    }
    const nextConfigsByMode = {
      executions: executionViewConfig,
      config: nextConfigViewConfig,
    }
    setViewRows(allRows)
    setActiveViewIdsByMode(nextActiveViewIdsByMode)
    activeViewIdsByModeRef.current = nextActiveViewIdsByMode
    loadedViewIdsByModeRef.current = nextActiveViewIdsByMode
    latestConfigsByModeRef.current = nextConfigsByMode
    dirtyModesRef.current.clear()
    setConfigsByMode(nextConfigsByMode)
    setViewStateMode(nextViewStateMode)
    setRenderableModes(result.renderableModes)
    setRowStateByMode(result.rowStateByMode)
    rowStateByModeRef.current = result.rowStateByMode
    setViewStateReloading(false)
    setViewsError(result.viewsError)
    setActiveMode(result.initialMode)
    if (nextViewStateMode !== 'error') {
      updateWorkingState((current) => ({
        ...current,
        activeMode: result.initialMode,
        activeViewIdsByMode: result.activeViewIdsByMode,
      }))
    }
  }, [updateWorkingState, workspaceId])

  useEffect(() => {
    void reloadViewState()

    return () => {
      bootstrapRequestRef.current += 1
    }
  }, [reloadViewState])

  const loadMonitorData = useCallback(async () => {
    setMonitorsLoading(true)
    setMonitorsError(null)

    try {
      const nextMonitors = await loadMonitors(workspaceId)
      setMonitors(nextMonitors)
      setMonitorsLoading(false)
    } catch (error) {
      setMonitors([])
      setMonitorsLoading(false)
      setMonitorsError(error instanceof Error ? error.message : 'Failed to load monitors')
    }
  }, [workspaceId])

  useEffect(() => {
    void loadMonitorData()
  }, [loadMonitorData])

  const { executionItems, orderedVisibleLogIds, isSelectionResolved, isLoading, error, refresh } =
    useMonitorWorkspaceLogs({
      workspaceId,
      viewConfig: executionViewConfig,
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

  const workflowSuggestions = useMemo(
    () =>
      referenceData.workflowOptions.map((option) => ({
        id: option.workflowId,
        name: option.workflowName,
      })),
    [referenceData.workflowOptions]
  )
  const activeQuickFilterClauseRaws = useMemo(() => {
    return new Set(
      executionViewConfig.quickFilters.map((filter) => createMonitorQuickFilterClause(filter).raw)
    )
  }, [executionViewConfig.quickFilters])

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
    (field: ExecutionMonitorQuickFilterField, value: string) => {
      updateViewConfig((current) => {
        const targetFilter = {
          field,
          operator: 'include' as const,
          values: [value],
        }
        const targetClause = createMonitorQuickFilterClause(targetFilter)
        const nextQuickFilters = current.quickFilters.filter(
          (filter) => createMonitorQuickFilterClause(filter).raw !== targetClause.raw
        )
        const quickFilterRemoved = nextQuickFilters.length !== current.quickFilters.length

        if (quickFilterRemoved) {
          return {
            ...current,
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
    (field: ExecutionMonitorQuickFilterField, value: string) =>
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
      await persistDirtyModes()
      await Promise.allSettled([refresh(), loadMonitorData(), reloadViewState()])
    } catch (errorValue) {
      setViewsError(
        errorValue instanceof Error ? errorValue.message : 'Failed to persist view before refresh'
      )
      await Promise.allSettled([refresh(), loadMonitorData()])
    } finally {
      setIsRefreshingAll(false)
    }
  }, [loadMonitorData, persistDirtyModes, refresh, reloadViewState])

  const handleExportExecutionLogs = useCallback(() => {
    const filters = buildMonitorExecutionLogFilters(executionViewConfig)
    const queryParams = new URLSearchParams(
      buildLogsRequestParams(workspaceId, filters, {
        includePagination: false,
        includeDetails: false,
      })
    )
    const anchor = document.createElement('a')
    anchor.href = `/api/logs/export?${queryParams}`
    anchor.download = 'logs_export.csv'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }, [executionViewConfig, workspaceId])

  const upsertMonitor = useCallback((nextMonitor: IndicatorMonitorRecord) => {
    setMonitors((current) => [
      nextMonitor,
      ...current.filter((monitor) => monitor.monitorId !== nextMonitor.monitorId),
    ])
    return nextMonitor
  }, [])

  const handleCreateMonitor = useCallback(
    async (input: IndicatorMonitorCreateInput) => {
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
    async (
      monitorId: string,
      input: IndicatorMonitorUpdateInput,
      options?: Parameters<MonitorRecordActions['updateMonitor']>[2]
    ) => {
      setMonitorsError(null)
      let previousMonitors: IndicatorMonitorRecord[] | null = null

      if (options?.optimisticRecord) {
        setMonitors((current) => {
          previousMonitors = current
          return current.map((monitor) =>
            monitor.monitorId === monitorId ? options.optimisticRecord! : monitor
          )
        })
      }

      try {
        const savedMonitor = await updateIndicatorMonitor(monitorId, input)
        if (savedMonitor) {
          upsertMonitor(savedMonitor)
        }
        return savedMonitor
      } catch (error) {
        if (previousMonitors) {
          setMonitors(previousMonitors)
        }
        const message = error instanceof Error ? error.message : 'Failed to update monitor'
        setMonitorsError(message)
        throw error instanceof Error ? error : new Error(message)
      }
    },
    [upsertMonitor]
  )

  const handleToggleMonitorState = useCallback(
    async (
      monitor: IndicatorMonitorRecord,
      nextIsActive: boolean,
      options?: Parameters<MonitorRecordActions['toggleMonitorState']>[2]
    ) => {
      setMonitorsError(null)
      let previousMonitors: IndicatorMonitorRecord[] | null = null

      if (options?.optimisticRecord) {
        setMonitors((current) => {
          previousMonitors = current
          return current.map((entry) =>
            entry.monitorId === monitor.monitorId ? options.optimisticRecord! : entry
          )
        })
      }

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
        if (previousMonitors) {
          setMonitors(previousMonitors)
        }
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

  const activeModeRows = useMemo(
    () => sortViewRows(viewRows.filter((row) => row.mode === activeMode)),
    [activeMode, viewRows]
  )
  const activeModeViewId = activeMode === 'config' ? activeConfigViewId : activeViewId
  const activeModeConfig = activeMode === 'config' ? configViewConfig : executionViewConfig
  const setActiveModeViewId = useCallback((viewId: string | null) => {
    const mode = activeModeRef.current
    activeViewIdsByModeRef.current = { ...activeViewIdsByModeRef.current, [mode]: viewId }
    loadedViewIdsByModeRef.current = { ...loadedViewIdsByModeRef.current, [mode]: viewId }
    setActiveViewIdsByMode((current) => ({ ...current, [mode]: viewId }))
  }, [])

  const handleOpenCreateViewDialog = useCallback(() => {
    setViewsError(null)
    setViewNameDialog({ kind: 'create', mode: activeMode })
    setNameDialogValue(getNextMonitorViewName(activeModeRows, activeMode))
  }, [activeMode, activeModeRows])

  const handleOpenRenameViewDialog = useCallback(
    (viewId: string) => {
      const row = activeModeRows.find((entry) => entry.id === viewId)
      if (!row) return

      setViewsError(null)
      setViewNameDialog({ kind: 'rename', mode: activeMode, viewId: row.id })
      setNameDialogValue(row.name)
    },
    [activeMode, activeModeRows]
  )

  const handleCloseNameDialog = useCallback(() => {
    if (nameDialogBusy) return

    setViewNameDialog(null)
    setNameDialogValue('')
  }, [nameDialogBusy])

  const handleActivateView = useCallback(
    async (viewId: string) => {
      if (viewId === activeModeViewId) return

      const nextRow = activeModeRows.find((row) => row.id === viewId)
      if (!nextRow) return

      setViewBusyAction('activate')
      setViewsError(null)

      try {
        await persistDirtyModes([activeMode])

        await setActiveMonitorView(workspaceId, viewId)
        setViewRows((current) =>
          current.map((row) => ({
            ...row,
            isActive: row.mode === activeMode ? row.id === viewId : row.isActive,
          }))
        )
        setActiveModeViewId(viewId)
        updateWorkingState((current) => ({
          ...current,
          activeViewIdsByMode: {
            ...current.activeViewIdsByMode,
            [activeMode]: viewId,
          },
        }))
        if (activeMode === 'config') {
          const nextConfig = normalizeConfigMonitorViewConfig(nextRow.config)
          latestConfigsByModeRef.current = {
            ...latestConfigsByModeRef.current,
            config: nextConfig,
          }
          dirtyModesRef.current.delete('config')
          setConfigsByMode((current) => ({ ...current, config: nextConfig }))
        } else {
          const nextConfig = normalizeExecutionMonitorViewConfig(nextRow.config)
          setSelectedExecutionLogId(null)
          latestConfigsByModeRef.current = {
            ...latestConfigsByModeRef.current,
            executions: nextConfig,
          }
          dirtyModesRef.current.delete('executions')
          setConfigsByMode((current) => ({ ...current, executions: nextConfig }))
        }
      } catch (errorValue) {
        setViewsError(errorValue instanceof Error ? errorValue.message : 'Failed to activate view')
      } finally {
        setViewBusyAction(null)
      }
    },
    [
      activeMode,
      activeModeRows,
      activeModeViewId,
      persistDirtyModes,
      setActiveModeViewId,
      updateWorkingState,
      workspaceId,
    ]
  )

  const handleSubmitNameDialog = useCallback(async () => {
    if (!viewNameDialog) return

    const trimmedName = nameDialogValue.trim()
    if (!trimmedName) {
      setViewsError('Name cannot be empty')
      return
    }

    const dialogState = viewNameDialog
    if (dialogState.mode !== activeMode) {
      setViewsError('Saved view dialog is stale. Close it and try again.')
      return
    }
    if (
      dialogState.kind === 'rename' &&
      !activeModeRows.some((row) => row.id === dialogState.viewId && row.mode === dialogState.mode)
    ) {
      setViewsError('Saved view dialog is stale. Close it and try again.')
      return
    }

    setNameDialogBusy(true)
    setViewBusyAction(dialogState.kind)
    setViewsError(null)

    try {
      if (dialogState.kind === 'create') {
        await persistDirtyModes([activeMode])

        const createdRow = await createMonitorView(workspaceId, {
          name: trimmedName,
          config: activeModeConfig,
          makeActive: true,
        })

        setViewRows((current) =>
          sortViewRows(
            current
              .map((row) => ({
                ...row,
                isActive: row.mode === activeMode ? false : row.isActive,
              }))
              .concat([{ ...createdRow, isActive: true }])
          )
        )
        setActiveModeViewId(createdRow.id)
        updateWorkingState((current) => ({
          ...current,
          activeViewIdsByMode: {
            ...current.activeViewIdsByMode,
            [activeMode]: createdRow.id,
          },
        }))
        if (activeMode === 'config') {
          const nextConfig = normalizeConfigMonitorViewConfig(createdRow.config)
          latestConfigsByModeRef.current = {
            ...latestConfigsByModeRef.current,
            config: nextConfig,
          }
          dirtyModesRef.current.delete('config')
          setConfigsByMode((current) => ({ ...current, config: nextConfig }))
        } else {
          setSelectedExecutionLogId(null)
          const nextConfig = normalizeExecutionMonitorViewConfig(createdRow.config)
          latestConfigsByModeRef.current = {
            ...latestConfigsByModeRef.current,
            executions: nextConfig,
          }
          dirtyModesRef.current.delete('executions')
          setConfigsByMode((current) => ({ ...current, executions: nextConfig }))
        }
      } else {
        const updatedRow = await updateMonitorView(workspaceId, dialogState.viewId, {
          name: trimmedName,
        })
        setViewRows((current) =>
          current.map((row) =>
            row.id === dialogState.viewId
              ? {
                  ...row,
                  name: updatedRow.name,
                  sortOrder: updatedRow.sortOrder,
                  isActive: updatedRow.isActive,
                  createdAt: updatedRow.createdAt,
                  updatedAt: updatedRow.updatedAt,
                }
              : row
          )
        )
      }
      setViewNameDialog(null)
      setNameDialogValue('')
    } catch (errorValue) {
      setViewsError(
        errorValue instanceof Error
          ? errorValue.message
          : dialogState.kind === 'create'
            ? 'Failed to create view'
            : 'Failed to rename view'
      )
    } finally {
      setNameDialogBusy(false)
      setViewBusyAction(null)
    }
  }, [
    activeMode,
    activeModeRows,
    activeModeConfig,
    nameDialogValue,
    persistDirtyModes,
    setActiveModeViewId,
    updateWorkingState,
    viewNameDialog,
    workspaceId,
  ])

  const handleReorderViews = useCallback(
    async (nextLayouts: LayoutTab[]) => {
      const nextRows = nextLayouts
        .map((layout, index) => {
          const current = activeModeRows.find((row) => row.id === layout.id)
          return current
            ? {
                ...current,
                sortOrder: layout.sortOrder ?? index,
              }
            : null
        })
        .filter((row): row is MonitorViewRow => Boolean(row))
      const previousRows = viewRows

      setViewRows((current) => replaceRowsInModeSlots(current, activeMode, nextRows))
      setViewBusyAction('reorder')
      setViewsError(null)

      try {
        await reorderMonitorViews(workspaceId, {
          mode: activeMode,
          viewOrder: nextRows.map((row) => row.id),
          activeViewId: activeModeViewId ?? undefined,
        })
      } catch (errorValue) {
        setViewRows(previousRows)
        setViewsError(errorValue instanceof Error ? errorValue.message : 'Failed to reorder views')
      } finally {
        setViewBusyAction(null)
      }
    },
    [activeMode, activeModeRows, activeModeViewId, viewRows, workspaceId]
  )

  const handleDeleteView = useCallback(
    async (viewId: string) => {
      if (!viewId || activeModeRows.length <= 1) return

      const previousRows = viewRows
      const deletedIndex = activeModeRows.findIndex((row) => row.id === viewId)
      const fallbackRow =
        viewId === activeModeViewId
          ? (activeModeRows[deletedIndex - 1] ?? activeModeRows[deletedIndex + 1] ?? null)
          : null
      setViewBusyAction('delete')
      setViewsError(null)
      setViewRows((current) => current.filter((row) => row.id !== viewId))

      try {
        await removeMonitorView(workspaceId, viewId)
        if (fallbackRow) {
          setSelectedExecutionLogId(null)
          setActiveModeViewId(fallbackRow.id)
          setViewRows((current) =>
            compactViewRows(current).map((row) => ({
              ...row,
              isActive: row.mode === activeMode ? row.id === fallbackRow.id : row.isActive,
            }))
          )
          updateWorkingState((current) => ({
            ...current,
            activeViewIdsByMode: {
              ...current.activeViewIdsByMode,
              [activeMode]: fallbackRow.id,
            },
          }))
          if (activeMode === 'config') {
            const nextConfig = normalizeConfigMonitorViewConfig(fallbackRow.config)
            latestConfigsByModeRef.current = {
              ...latestConfigsByModeRef.current,
              config: nextConfig,
            }
            dirtyModesRef.current.delete('config')
            setConfigsByMode((current) => ({ ...current, config: nextConfig }))
          } else {
            const nextConfig = normalizeExecutionMonitorViewConfig(fallbackRow.config)
            latestConfigsByModeRef.current = {
              ...latestConfigsByModeRef.current,
              executions: nextConfig,
            }
            dirtyModesRef.current.delete('executions')
            setConfigsByMode((current) => ({ ...current, executions: nextConfig }))
          }
          await reloadViewState()
        } else {
          setViewRows((current) => compactViewRows(current))
        }
      } catch (errorValue) {
        setViewRows(previousRows)
        setViewsError(errorValue instanceof Error ? errorValue.message : 'Failed to delete view')
      } finally {
        setViewBusyAction(null)
      }
    },
    [
      activeMode,
      activeModeRows,
      activeModeViewId,
      reloadViewState,
      setActiveModeViewId,
      updateWorkingState,
      viewRows,
      workspaceId,
    ]
  )

  const handleChangeMode = useCallback(
    async (nextMode: MonitorPageMode) => {
      if (nextMode === activeMode) return true
      if (!renderableModes.includes(nextMode)) {
        setViewsError(`${nextMode === 'config' ? 'Config' : 'Execution'} views are unavailable.`)
        return false
      }
      if (nextMode === 'config' && referenceData.isLoading) {
        setViewsError('Monitor requirements are still loading.')
        return false
      }

      try {
        await persistDirtyModes()
      } catch (error) {
        setViewsError(
          error instanceof Error
            ? error.message
            : 'Failed to persist monitor views before switching modes.'
        )
        return false
      }

      if (activeMode === 'executions' && nextMode !== 'executions') {
        setSelectedExecutionLogId(null)
      }
      setActiveMode(nextMode)
      updateWorkingState((current) => ({
        ...current,
        activeMode: nextMode,
      }))
      return true
    },
    [activeMode, persistDirtyModes, referenceData.isLoading, renderableModes, updateWorkingState]
  )

  const configHeaderCards = useMemo(
    () => buildConfigMonitorCards(monitors, referenceData, {}),
    [monitors, referenceData]
  )
  const viewControlsBusy =
    Boolean(viewBusyAction) ||
    nameDialogBusy ||
    viewStateReloading ||
    isRefreshingAll ||
    viewStateMode === 'loading'
  const noRenderableModes = renderableModes.length === 0
  const shellActionsDisabled = viewControlsBusy || noRenderableModes
  const configModeDisabled = !renderableModes.includes('config') || referenceData.isLoading

  const headerLeft = (
    <div className='flex w-full flex-1 items-center gap-3'>
      <div className='hidden items-center gap-2 sm:flex'>
        <Activity className='h-[18px] w-[18px] text-muted-foreground' />
        <span className='font-medium text-sm'>Monitor</span>
      </div>
      {activeMode === 'executions' ? (
        <div className='flex w-full flex-1'>
          <AutocompleteSearch
            value={executionViewConfig.filterQuery}
            onChange={commitFilterQuery}
            queryPolicy={MONITOR_QUERY_POLICY}
            workflowsData={workflowSuggestions}
            placeholder='Search executions...'
            className='w-full'
          />
        </div>
      ) : referenceData.isLoading ? (
        <div className='flex w-full flex-1 items-center gap-2 text-muted-foreground text-sm'>
          <Loader2 className='h-4 w-4 animate-spin' />
          Loading monitor requirements...
        </div>
      ) : (
        <div className='flex w-full flex-1'>
          <ConfigMonitorSearch
            config={configViewConfig}
            cards={configHeaderCards}
            referenceData={referenceData}
            onUpdateConfig={updateConfigViewConfig}
          />
        </div>
      )}
    </div>
  )

  const layouts: LayoutTab[] = activeModeRows.map((row) => ({
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    isActive: row.id === activeModeViewId,
  }))

  const headerCenter =
    activeModeRows.length > 0 ? (
      <LayoutTabs
        layouts={layouts}
        isBusy={viewControlsBusy}
        onSelect={handleActivateView}
        onReorder={handleReorderViews}
        onCreate={handleOpenCreateViewDialog}
        onRequestRename={handleOpenRenameViewDialog}
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
      {activeMode === 'executions' ? (
        <Button
          variant='outline'
          size='default'
          className='h-9 gap-2'
          onClick={handleExportExecutionLogs}
          disabled={!renderableModes.includes('executions') || shellActionsDisabled}
        >
          <Download className='h-4 w-4' />
          Export CSV
        </Button>
      ) : null}
      <Tabs
        value={activeMode}
        onValueChange={(value) => {
          void handleChangeMode(value as MonitorPageMode)
        }}
      >
        <TabsList aria-label='Monitor mode' className='shrink-0 rounded-md'>
          {(['executions', 'config'] as const).map((mode) => (
            <TabsTrigger
              key={mode}
              value={mode}
              className='h-7 px-2 py-0 text-xs capitalize'
              disabled={
                shellActionsDisabled ||
                (mode === 'config' ? configModeDisabled : !renderableModes.includes(mode))
              }
            >
              {mode}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Button
        variant='ghost'
        size='icon'
        className='h-9 w-9'
        onClick={() => {
          void handleRefreshAll()
        }}
        disabled={isRefreshingAll || shellActionsDisabled}
      >
        {isRefreshingAll ? (
          <Loader2 className='h-4 w-4 animate-spin' />
        ) : (
          <RefreshCw className='h-4 w-4' />
        )}
        <span className='sr-only'>Refresh monitor workspace</span>
      </Button>
    </div>
  )

  const monitorActions = useMemo<MonitorRecordActions>(
    () => ({
      createMonitor: handleCreateMonitor,
      updateMonitor: handleUpdateMonitor,
      toggleMonitorState: handleToggleMonitorState,
      deleteMonitor: handleDeleteMonitor,
    }),
    [handleCreateMonitor, handleDeleteMonitor, handleToggleMonitorState, handleUpdateMonitor]
  )

  const configWorkspaceViewStateMode =
    viewStateMode === 'loading'
      ? 'loading'
      : rowStateByMode.config === 'server'
        ? 'server'
        : 'error'
  const executionWorkspaceViewStateMode =
    viewStateMode === 'loading'
      ? 'loading'
      : rowStateByMode.executions === 'server'
        ? 'server'
        : 'error'

  const configWorkspace = (
    <MonitorConfigWorkspace
      workspaceId={workspaceId}
      viewStateMode={configWorkspaceViewStateMode}
      viewStateReloading={viewStateReloading}
      viewsError={viewsError}
      effectiveConfig={configViewConfig}
      panelSizes={workingState.configPanelSizes}
      monitorRecords={monitors}
      monitorsLoading={monitorsLoading}
      monitorsError={monitorsError}
      referenceData={referenceData}
      monitorActions={monitorActions}
      onPanelLayout={(sizes) =>
        updateWorkingState((current) => ({
          ...current,
          configPanelSizes: [
            sizes[0] ?? DEFAULT_CONFIG_PANEL_SIZES[0],
            sizes[1] ?? DEFAULT_CONFIG_PANEL_SIZES[1],
          ],
        }))
      }
      onUpdateViewConfig={updateConfigViewConfig}
      onReloadViews={() => {
        void reloadViewState()
      }}
    />
  )

  const executionWorkspace = (
    <MonitorExecutionWorkspace
      viewStateMode={executionWorkspaceViewStateMode}
      viewStateReloading={viewStateReloading}
      viewsError={viewsError}
      effectiveConfig={executionViewConfig}
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
      panelSizes={workingState.executionPanelSizes}
      onPanelLayout={(sizes) =>
        updateWorkingState((current) => ({
          ...current,
          executionPanelSizes: [
            sizes[0] ?? DEFAULT_EXECUTION_PANEL_SIZES[0],
            sizes[1] ?? DEFAULT_EXECUTION_PANEL_SIZES[1],
          ],
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
      onReloadViews={() => {
        void reloadViewState()
      }}
    />
  )
  const fatalWorkspaceError = (
    <MonitorStateCard
      title='Views unavailable'
      description={viewsError ?? 'Monitor views could not be loaded for this workspace.'}
      actionLabel={
        <>
          {viewStateReloading ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : null}
          Reload views
        </>
      }
      actionDisabled={viewStateReloading}
      onAction={() => {
        void reloadViewState()
      }}
      className='h-full w-full border-0 bg-background'
    />
  )
  const configReferenceLoadingWorkspace = (
    <MonitorStateCard
      loadingLabel='Loading monitor requirements...'
      className='h-full w-full border-0 bg-transparent'
    />
  )
  const workspace =
    viewStateMode === 'error'
      ? fatalWorkspaceError
      : activeMode === 'config'
        ? referenceData.isLoading
          ? configReferenceLoadingWorkspace
          : configWorkspace
        : executionWorkspace
  const viewNameDialogMode = viewNameDialog?.mode ?? activeMode
  const viewNameDialogDescription =
    viewNameDialog?.kind === 'rename'
      ? 'Rename this saved monitor view without changing its workspace settings.'
      : viewNameDialogMode === 'config'
        ? 'Create a new saved view from the current monitor configuration workspace settings.'
        : 'Create a new saved view from the current execution workspace settings.'
  const viewNameDialogTitle = viewNameDialog?.kind === 'rename' ? 'Rename View' : 'Create View'
  const viewNameDialogSubmitLabel =
    viewNameDialog?.kind === 'rename' ? 'Rename view' : 'Create view'

  return (
    <div className='flex h-full min-h-0 w-full min-w-0 flex-col'>
      <GlobalNavbarHeader left={headerLeft} center={headerCenter} right={headerRight} />
      <div className='flex min-h-0 w-full min-w-0 flex-1 overflow-hidden'>{workspace}</div>
      <Dialog
        open={Boolean(viewNameDialog)}
        onOpenChange={(open) => !open && handleCloseNameDialog()}
      >
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>{viewNameDialogTitle}</DialogTitle>
            <DialogDescription>{viewNameDialogDescription}</DialogDescription>
          </DialogHeader>
          <Input
            value={nameDialogValue}
            onChange={(event) => setNameDialogValue(event.target.value)}
            placeholder='View name'
            disabled={nameDialogBusy}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void handleSubmitNameDialog()
              }
            }}
          />
          <DialogFooter>
            <Button variant='outline' onClick={handleCloseNameDialog} disabled={nameDialogBusy}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                void handleSubmitNameDialog()
              }}
              disabled={nameDialogBusy || !nameDialogValue.trim()}
            >
              {nameDialogBusy ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : null}
              {viewNameDialogSubmitLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
