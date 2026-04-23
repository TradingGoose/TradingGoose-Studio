'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { Loader2, Plus, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { LogDetails } from '@/app/workspace/[workspaceId]/logs/components/log-details/log-details'
import { useLogDetail, useLogsList } from '@/hooks/queries/logs'
import {
  getMarketLiveCapabilities,
  getMarketProviderOptionsByKind,
  getMarketProviderParamDefinitions,
  getMarketSeriesCapabilities,
} from '@/providers/market/providers'
import { useListingSelectorStore } from '@/stores/market/selector/store'
import {
  activateMonitorView,
  createMonitorView,
  loadIndicatorOptions,
  loadMonitors,
  loadWorkflowOptions,
  loadWorkflowTargetOptions,
  removeMonitorView,
  updateMonitorView,
} from './api'
import {
  buildMonitorBoardColumns,
  buildMonitorEntities,
  filterMonitorEntities,
  getDefaultPanelSizes,
  getMonitorFilterOptions,
  getMonitorStatusLabel,
  mergeVisibleStatusBoardCardOrder,
  shouldEnableTriggerControls,
} from './board-state'
import { MonitorBoard } from './monitor-board'
import { MonitorEditorModal } from './monitor-editor-modal'
import { MonitorRoadmap } from './monitor-roadmap'
import { buildMonitorRoadmapGroups } from './roadmap-state'
import { SearchableDropdown } from './searchable-dropdown'
import type {
  IndicatorMonitorRecord,
  IndicatorOption,
  MonitorDraft,
  MonitorNameDialogMode,
  StreamingProviderOption,
  WorkflowPickerOption,
  WorkflowTargetOption,
} from './types'
import {
  MAX_MONITOR_TIMELINE_ZOOM,
  MIN_MONITOR_TIMELINE_ZOOM,
  MONITOR_TIMELINE_RANGES,
  MONITOR_TIMELINE_ZOOM_STEP,
  normalizeMonitorViewConfig,
  resolveMonitorRuntimeConfig,
  type MonitorViewConfig,
  type MonitorViewRow,
} from './view-config'
import {
  buildDefaultDraft,
  buildDraftFromMonitor,
  isAuthParamDefinition,
  parseErrorMessage,
} from './utils'

const DESKTOP_INSPECTOR_BREAKPOINT = 1024

type LatestLogState =
  | { status: 'idle'; monitorId: null; logId: null }
  | { status: 'loading'; monitorId: string; logId: null }
  | { status: 'empty'; monitorId: string; logId: null }
  | { status: 'error'; monitorId: string; logId: null }
  | { status: 'ready'; monitorId: string; logId: string }

type StateSetter<T> = Dispatch<SetStateAction<T>>

type MonitorsViewState = {
  monitors: IndicatorMonitorRecord[]
  monitorsLoading: boolean
  referenceLoading: boolean
  monitorsError: string | null
  referenceWarning: string | null
  indicatorOptions: IndicatorOption[]
  workflowTargets: WorkflowTargetOption[]
  workflowOptions: WorkflowPickerOption[]
  selectedMonitorId: string | null
  search: string
  viewOptionsOpen: boolean
  viewRows: MonitorViewRow[]
  activeViewId: string | null
  viewConfig: MonitorViewConfig
  viewStateMode: 'loading' | 'server' | 'error'
  viewStateReloading: boolean
  viewsError: string | null
  nameDialogMode: MonitorNameDialogMode | null
  nameDialogValue: string
  nameDialogBusy: boolean
  deletingViewId: string | null
  isEditorOpen: boolean
  editingKey: string | null
  editingDraft: MonitorDraft | null
  editingErrors: Record<string, string>
  saving: boolean
  togglingMonitorId: string | null
  deletingMonitorId: string | null
  pendingMonitorDelete: IndicatorMonitorRecord | null
}

type MonitorsViewSetters = {
  setMonitors: StateSetter<IndicatorMonitorRecord[]>
  setMonitorsLoading: StateSetter<boolean>
  setReferenceLoading: StateSetter<boolean>
  setMonitorsError: StateSetter<string | null>
  setReferenceWarning: StateSetter<string | null>
  setIndicatorOptions: StateSetter<IndicatorOption[]>
  setWorkflowTargets: StateSetter<WorkflowTargetOption[]>
  setWorkflowOptions: StateSetter<WorkflowPickerOption[]>
  setSelectedMonitorId: StateSetter<string | null>
  setSearch: StateSetter<string>
  setViewOptionsOpen: StateSetter<boolean>
  setViewRows: StateSetter<MonitorViewRow[]>
  setActiveViewId: StateSetter<string | null>
  setViewConfig: StateSetter<MonitorViewConfig>
  setViewStateMode: StateSetter<'loading' | 'server' | 'error'>
  setViewsError: StateSetter<string | null>
  setNameDialogMode: StateSetter<MonitorNameDialogMode | null>
  setNameDialogValue: StateSetter<string>
  setNameDialogBusy: StateSetter<boolean>
  setDeletingViewId: StateSetter<string | null>
  setIsEditorOpen: StateSetter<boolean>
  setEditingKey: StateSetter<string | null>
  setEditingDraft: StateSetter<MonitorDraft | null>
  setEditingErrors: StateSetter<Record<string, string>>
  setSaving: StateSetter<boolean>
  setTogglingMonitorId: StateSetter<string | null>
  setDeletingMonitorId: StateSetter<string | null>
  setPendingMonitorDelete: StateSetter<IndicatorMonitorRecord | null>
}

export type MonitorsViewProps = {
  workspaceId: string
  reloadViewState: () => Promise<void>
  state: MonitorsViewState
  setters: MonitorsViewSetters
}

const parseMonitorResponse = async (response: Response): Promise<IndicatorMonitorRecord | null> => {
  const payload = await response.json().catch(() => null)
  const data = payload?.data
  return data && typeof data === 'object' ? (data as IndicatorMonitorRecord) : null
}

const getInitialViewName = (count: number) => `View ${count + 1}`

const toggleStringFilter = (values: string[], target: string) => {
  if (values.includes(target)) {
    return values.filter((value) => value !== target)
  }

  return [...values, target]
}

function PanelEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className='flex h-full items-center justify-center rounded-xl border bg-card/60 px-6 text-center'>
      <div className='space-y-2'>
        <div className='font-medium text-sm'>{title}</div>
        <div className='max-w-sm text-muted-foreground text-sm'>{description}</div>
      </div>
    </div>
  )
}

function InspectorState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string
  description: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <div className='flex h-full items-center justify-center rounded-xl border bg-card/60 px-6 text-center'>
      <div className='space-y-3'>
        <div className='space-y-2'>
          <div className='font-medium text-sm'>{title}</div>
          <div className='max-w-sm text-muted-foreground text-sm'>{description}</div>
        </div>
        <Button variant='outline' size='sm' onClick={onAction}>
          {actionLabel}
        </Button>
      </div>
    </div>
  )
}

export function MonitorsView({ workspaceId, reloadViewState, state, setters }: MonitorsViewProps) {
  const {
    monitors,
    monitorsLoading,
    referenceLoading,
    monitorsError,
    referenceWarning,
    indicatorOptions,
    workflowTargets,
    workflowOptions,
    selectedMonitorId,
    search,
    viewOptionsOpen,
    viewRows,
    activeViewId,
    viewConfig,
    viewStateMode,
    viewStateReloading,
    viewsError,
    nameDialogMode,
    nameDialogValue,
    nameDialogBusy,
    deletingViewId,
    isEditorOpen,
    editingKey,
    editingDraft,
    editingErrors,
    saving,
    togglingMonitorId,
    deletingMonitorId,
    pendingMonitorDelete,
  } = state
  const {
    setMonitors,
    setMonitorsLoading,
    setReferenceLoading,
    setMonitorsError,
    setReferenceWarning,
    setIndicatorOptions,
    setWorkflowTargets,
    setWorkflowOptions,
    setSelectedMonitorId,
    setSearch,
    setViewOptionsOpen,
    setViewRows,
    setActiveViewId,
    setViewConfig,
    setViewStateMode,
    setViewsError,
    setNameDialogMode,
    setNameDialogValue,
    setNameDialogBusy,
    setDeletingViewId,
    setIsEditorOpen,
    setEditingKey,
    setEditingDraft,
    setEditingErrors,
    setSaving,
    setTogglingMonitorId,
    setDeletingMonitorId,
    setPendingMonitorDelete,
  } = setters
  const hasAutoSelectedInitialMonitorRef = useRef(false)
  const [isDesktopInspector, setIsDesktopInspector] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return true
    }

    return window.matchMedia(`(min-width: ${DESKTOP_INSPECTOR_BREAKPOINT}px)`).matches
  })
  const [latestLogState, setLatestLogState] = useState<LatestLogState>({
    status: 'idle',
    monitorId: null,
    logId: null,
  })

  const ensureListingSelectorInstance = useListingSelectorStore((state) => state.ensureInstance)
  const updateListingSelectorInstance = useListingSelectorStore((state) => state.updateInstance)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const mediaQuery = window.matchMedia(`(min-width: ${DESKTOP_INSPECTOR_BREAKPOINT}px)`)
    const syncMatch = (event?: MediaQueryListEvent) => {
      setIsDesktopInspector(event ? event.matches : mediaQuery.matches)
    }

    syncMatch()
    mediaQuery.addEventListener('change', syncMatch)
    return () => mediaQuery.removeEventListener('change', syncMatch)
  }, [])

  const streamingProviders = useMemo<StreamingProviderOption[]>(
    () =>
      getMarketProviderOptionsByKind('live').filter((option) =>
        Boolean(getMarketLiveCapabilities(option.id)?.supportsStreaming)
      ),
    []
  )

  const workflowPickerOptions = useMemo<WorkflowPickerOption[]>(() => {
    const grouped = new Map<string, WorkflowPickerOption>()

    workflowTargets.forEach((target) => {
      if (!grouped.has(target.workflowId)) {
        grouped.set(target.workflowId, {
          workflowId: target.workflowId,
          workflowName: target.workflowName,
          workflowColor: target.workflowColor || '#3972F6',
        })
      }
    })

    return Array.from(grouped.values()).sort((left, right) =>
      left.workflowName.localeCompare(right.workflowName)
    )
  }, [workflowTargets])

  const addMonitorDisabledReason = useMemo(() => {
    if (referenceLoading) return 'Loading monitor requirements...'
    if (workflowTargets.length > 0 && indicatorOptions.length > 0) return null
    return 'No deployed workflow with indicator trigger is available, or no trigger-capable indicator exists.'
  }, [indicatorOptions.length, referenceLoading, workflowTargets.length])

  const canAddMonitor = addMonitorDisabledReason === null

  const loadMonitorData = useCallback(async () => {
    setMonitorsLoading(true)
    setReferenceLoading(true)
    setMonitorsError(null)
    setReferenceWarning(null)

    const [monitorsResult, indicatorOptionsResult, workflowTargetsResult, workflowOptionsResult] =
      await Promise.allSettled([
        loadMonitors(workspaceId),
        loadIndicatorOptions(workspaceId),
        loadWorkflowTargetOptions(workspaceId),
        loadWorkflowOptions(workspaceId),
      ])

    if (monitorsResult.status === 'fulfilled') {
      setMonitors(monitorsResult.value)
    } else {
      setMonitorsError(
        monitorsResult.reason instanceof Error
          ? monitorsResult.reason.message
          : 'Failed to load monitors'
      )
    }

    const nextReferenceWarnings: string[] = []

    if (indicatorOptionsResult.status === 'fulfilled') {
      setIndicatorOptions(indicatorOptionsResult.value)
    } else {
      nextReferenceWarnings.push('Indicator options are temporarily unavailable.')
    }

    if (workflowTargetsResult.status === 'fulfilled') {
      setWorkflowTargets(workflowTargetsResult.value)
    } else {
      nextReferenceWarnings.push('Workflow deployment references are temporarily unavailable.')
    }

    if (workflowOptionsResult.status === 'fulfilled') {
      setWorkflowOptions(workflowOptionsResult.value)
    } else {
      nextReferenceWarnings.push('Workflow filter options are temporarily unavailable.')
    }

    setReferenceWarning(nextReferenceWarnings.length > 0 ? nextReferenceWarnings.join(' ') : null)
    setMonitorsLoading(false)
    setReferenceLoading(false)
  }, [workspaceId])

  useEffect(() => {
    void loadMonitorData()
  }, [loadMonitorData])

  const monitorEntities = useMemo(
    () =>
      buildMonitorEntities({
        monitors,
        workflowTargets,
        workflows: workflowOptions,
        indicators: indicatorOptions,
        providers: streamingProviders,
      }),
    [indicatorOptions, monitors, streamingProviders, workflowOptions, workflowTargets]
  )

  const filterOptions = useMemo(() => getMonitorFilterOptions(monitorEntities), [monitorEntities])
  const datasetReady = !monitorsLoading
  const hasMultipleTriggers = shouldEnableTriggerControls(monitorEntities)
  const persistedConfig = useMemo(() => normalizeMonitorViewConfig(viewConfig), [viewConfig])

  const normalizedConfig = useMemo(
    () =>
      resolveMonitorRuntimeConfig(persistedConfig, {
        datasetReady,
        hasMultipleTriggers,
      }),
    [datasetReady, hasMultipleTriggers, persistedConfig]
  )
  const activeViewRow = viewRows.find((row) => row.id === activeViewId) ?? null

  const filteredEntities = useMemo(
    () => filterMonitorEntities(monitorEntities, normalizedConfig, search),
    [monitorEntities, normalizedConfig, search]
  )

  const boardColumns = useMemo(
    () => buildMonitorBoardColumns(filteredEntities, normalizedConfig),
    [filteredEntities, normalizedConfig]
  )

  const roadmapGroups = useMemo(() => buildMonitorRoadmapGroups(boardColumns), [boardColumns])

  useEffect(() => {
    if (filteredEntities.length === 0) {
      setSelectedMonitorId(null)
      return
    }

    const hasSelectedMonitor =
      selectedMonitorId !== null &&
      filteredEntities.some((entity) => entity.id === selectedMonitorId)

    if (hasSelectedMonitor) {
      return
    }

    if (selectedMonitorId !== null) {
      hasAutoSelectedInitialMonitorRef.current = true
      setSelectedMonitorId(null)
      return
    }

    if (!hasAutoSelectedInitialMonitorRef.current) {
      const firstMonitorId = filteredEntities[0]?.id ?? null
      if (!firstMonitorId) return

      hasAutoSelectedInitialMonitorRef.current = true
      setSelectedMonitorId(firstMonitorId)
    }
  }, [filteredEntities, selectedMonitorId, setSelectedMonitorId])

  const selectedMonitorEntity = useMemo(
    () => filteredEntities.find((entity) => entity.id === selectedMonitorId) ?? null,
    [filteredEntities, selectedMonitorId]
  )

  const selectedMonitor = selectedMonitorEntity?.monitor ?? null
  const selectedMonitorKey = selectedMonitor?.monitorId ?? null

  useEffect(() => {
    if (!selectedMonitorKey) {
      setLatestLogState({ status: 'idle', monitorId: null, logId: null })
      return
    }

    setLatestLogState({ status: 'loading', monitorId: selectedMonitorKey, logId: null })
  }, [selectedMonitorKey])

  const latestLogFilters = useMemo(
    () => ({
      timeRange: 'All time',
      level: 'all',
      workflowIds: selectedMonitor ? [selectedMonitor.workflowId] : [],
      folderIds: [] as string[],
      triggers: [] as string[],
      searchQuery: '',
      limit: 1,
      monitorId: selectedMonitor?.monitorId,
      listing: selectedMonitor?.providerConfig.monitor.listing,
      indicatorId: selectedMonitor?.providerConfig.monitor.indicatorId,
      providerId: selectedMonitor?.providerConfig.monitor.providerId,
      interval: selectedMonitor?.providerConfig.monitor.interval,
      triggerSource: 'indicator_trigger' as const,
    }),
    [selectedMonitor]
  )

  const latestLogQuery = useLogsList(workspaceId, latestLogFilters, {
    enabled: Boolean(workspaceId && selectedMonitorKey),
    refetchInterval: false,
  })

  const latestLogEntry = useMemo(
    () => latestLogQuery.data?.pages?.[0]?.logs?.[0] ?? null,
    [latestLogQuery.data?.pages]
  )

  useEffect(() => {
    if (!selectedMonitorKey) return

    if (latestLogQuery.isError) {
      setLatestLogState({ status: 'error', monitorId: selectedMonitorKey, logId: null })
      return
    }

    if (!latestLogQuery.isSuccess) {
      return
    }

    if (!latestLogEntry?.id) {
      setLatestLogState({ status: 'empty', monitorId: selectedMonitorKey, logId: null })
      return
    }

    setLatestLogState({
      status: 'ready',
      monitorId: selectedMonitorKey,
      logId: latestLogEntry.id,
    })
  }, [latestLogEntry?.id, latestLogQuery.isError, latestLogQuery.isSuccess, selectedMonitorKey])

  const latestLogId = latestLogState.status === 'ready' ? latestLogState.logId : undefined
  const latestLogDetailQuery = useLogDetail(latestLogId)
  const selectedMonitorLog = useMemo(() => {
    if (latestLogState.status !== 'ready') return null

    const detailedLog = latestLogDetailQuery.data
    if (detailedLog?.id === latestLogState.logId) {
      return detailedLog
    }

    return null
  }, [latestLogDetailQuery.data, latestLogState])

  const latestLogLookupError =
    latestLogQuery.error instanceof Error
      ? latestLogQuery.error.message
      : latestLogQuery.error
        ? 'Failed to fetch the latest log for this monitor.'
        : null

  const latestLogDetailError =
    latestLogDetailQuery.error instanceof Error
      ? latestLogDetailQuery.error.message
      : latestLogDetailQuery.error
        ? 'Failed to fetch log details for this monitor.'
        : null

  const refreshPage = useCallback(async () => {
    const tasks: Promise<unknown>[] = [loadMonitorData(), reloadViewState()]

    if (selectedMonitor) {
      tasks.push(latestLogQuery.refetch())
    }
    if (latestLogState.status === 'ready') {
      tasks.push(latestLogDetailQuery.refetch())
    }

    await Promise.all(tasks)
  }, [
    latestLogDetailQuery,
    latestLogQuery,
    latestLogState.status,
    loadMonitorData,
    reloadViewState,
    selectedMonitor,
  ])

  const editingProviderDefinitions = useMemo(() => {
    if (!editingDraft?.providerId) return []
    return getMarketProviderParamDefinitions(editingDraft.providerId, 'live')
  }, [editingDraft?.providerId])

  const editingSecretDefinitions = useMemo(
    () =>
      editingProviderDefinitions.filter(
        (definition) =>
          definition.required &&
          isAuthParamDefinition(definition) &&
          definition.visibility !== 'hidden' &&
          definition.visibility !== 'llm-only'
      ),
    [editingProviderDefinitions]
  )

  const editingNonSecretDefinitions = useMemo(
    () =>
      editingProviderDefinitions.filter(
        (definition) =>
          definition.required &&
          !isAuthParamDefinition(definition) &&
          definition.visibility !== 'hidden' &&
          definition.visibility !== 'llm-only'
      ),
    [editingProviderDefinitions]
  )

  const editingListingInstanceId =
    isEditorOpen && editingDraft ? `indicator-monitor-edit-${editingKey ?? 'new'}` : null

  useEffect(() => {
    if (!editingDraft?.providerId || !editingListingInstanceId) return
    updateListingSelectorInstance(editingListingInstanceId, {
      providerId: editingDraft.providerId,
    })
  }, [editingDraft?.providerId, editingListingInstanceId, updateListingSelectorInstance])

  const beginCreateMonitor = useCallback(() => {
    const instanceId = 'indicator-monitor-edit-new'
    const draft = buildDefaultDraft({ providers: streamingProviders })
    ensureListingSelectorInstance(instanceId, {
      providerId: draft.providerId,
      selectedListingValue: null,
      selectedListing: null,
      query: '',
      results: [],
      error: undefined,
    })
    setEditingKey(null)
    setEditingDraft(draft)
    setEditingErrors({})
    setIsEditorOpen(true)
  }, [ensureListingSelectorInstance, streamingProviders])

  const beginEditMonitor = useCallback(
    (monitor: IndicatorMonitorRecord) => {
      const listingValue = monitor.providerConfig.monitor.listing
      const listingWithDetails =
        listingValue &&
        typeof listingValue === 'object' &&
        (typeof (listingValue as { base?: unknown }).base === 'string' ||
          typeof (listingValue as { name?: unknown }).name === 'string' ||
          typeof (listingValue as { iconUrl?: unknown }).iconUrl === 'string')
          ? (listingValue as any)
          : null
      const instanceId = `indicator-monitor-edit-${monitor.monitorId}`

      ensureListingSelectorInstance(instanceId, {
        providerId: monitor.providerConfig.monitor.providerId,
        selectedListingValue: listingValue,
        selectedListing: listingWithDetails,
        query: '',
        results: [],
        error: undefined,
      })
      updateListingSelectorInstance(instanceId, {
        providerId: monitor.providerConfig.monitor.providerId,
        selectedListingValue: listingValue,
        selectedListing: listingWithDetails,
      })

      setEditingKey(monitor.monitorId)
      setEditingDraft(buildDraftFromMonitor(monitor))
      setEditingErrors({})
      setIsEditorOpen(true)
    },
    [ensureListingSelectorInstance, updateListingSelectorInstance]
  )

  const cancelEditing = useCallback(() => {
    setIsEditorOpen(false)
    setEditingKey(null)
    setEditingDraft(null)
    setEditingErrors({})
  }, [])

  const updateDraft = useCallback((patch: Partial<MonitorDraft>) => {
    setEditingDraft((current) => (current ? { ...current, ...patch } : current))
  }, [])

  const updateSecretValue = useCallback((fieldId: string, value: string) => {
    setEditingDraft((current) =>
      current
        ? {
            ...current,
            secretValues: {
              ...current.secretValues,
              [fieldId]: value,
            },
          }
        : current
    )
  }, [])

  const updateProviderParamValue = useCallback((fieldId: string, value: string) => {
    setEditingDraft((current) =>
      current
        ? {
            ...current,
            providerParamValues: {
              ...current.providerParamValues,
              [fieldId]: value,
            },
          }
        : current
    )
  }, [])

  const validateDraft = useCallback(() => {
    const draft = editingDraft
    if (!draft) return { valid: false, errors: { draft: 'Missing draft state.' } }

    const nextErrors: Record<string, string> = {}
    if (!draft.workflowId) nextErrors.workflowId = 'Workflow is required.'
    if (!draft.blockId) nextErrors.blockId = 'Block target is required.'
    if (!draft.providerId) nextErrors.providerId = 'Provider is required.'
    if (!draft.interval) nextErrors.interval = 'Interval is required.'
    if (!draft.indicatorId) nextErrors.indicatorId = 'Indicator is required.'
    if (!draft.listing) nextErrors.listing = 'Listing is required.'

    const targetKey = `${draft.workflowId}:${draft.blockId}` as `${string}:${string}`
    const workflowTargetByKey = new Map(
      workflowTargets.map((target) => [`${target.workflowId}:${target.blockId}`, target] as const)
    )

    if (!workflowTargetByKey.has(targetKey)) {
      nextErrors.blockId = 'Workflow target must reference an indicator trigger block.'
    }

    const availableIntervals = getMarketSeriesCapabilities(draft.providerId)?.intervals ?? []
    if (!availableIntervals.includes(draft.interval as any)) {
      nextErrors.interval = 'Selected interval is not supported for this provider.'
    }

    editingSecretDefinitions
      .filter((definition) => definition.required)
      .forEach((definition) => {
        const entered = (draft.secretValues[definition.id] || '').trim()
        const hasExisting = draft.existingEncryptedSecretFieldIds.includes(definition.id)
        if (!entered && !hasExisting) {
          nextErrors[`secret:${definition.id}`] =
            `${definition.title || definition.id} is required.`
        }
      })

    editingNonSecretDefinitions
      .filter((definition) => definition.required)
      .forEach((definition) => {
        const value = (draft.providerParamValues[definition.id] || '').trim()
        if (!value) {
          nextErrors[`param:${definition.id}`] = `${definition.title || definition.id} is required.`
        }
      })

    return {
      valid: Object.keys(nextErrors).length === 0,
      errors: nextErrors,
    }
  }, [editingDraft, editingNonSecretDefinitions, editingSecretDefinitions, workflowTargets])

  const upsertMonitor = useCallback((nextMonitor: IndicatorMonitorRecord) => {
    setMonitors((current) => [
      nextMonitor,
      ...current.filter((entry) => entry.monitorId !== nextMonitor.monitorId),
    ])
  }, [])

  const persistDraft = useCallback(async () => {
    if (!editingDraft) return

    const validation = validateDraft()
    setEditingErrors(validation.errors)
    if (!validation.valid) return

    const authPayload = (() => {
      const secrets = Object.fromEntries(
        Object.entries(editingDraft.secretValues).map(
          ([key, value]) => [key, value.trim()] as const
        )
      )

      if (!editingKey && Object.values(secrets).every((value) => value.length === 0)) {
        return undefined
      }

      return { secrets }
    })()

    const providerParams = Object.fromEntries(
      editingNonSecretDefinitions
        .map((definition) => {
          const trimmed = (editingDraft.providerParamValues[definition.id] || '').trim()
          if (!trimmed) return null
          return [definition.id, trimmed] as const
        })
        .filter((entry): entry is [string, string] => Boolean(entry))
    )

    const target = workflowTargets.find(
      (entry) =>
        entry.workflowId === editingDraft.workflowId && entry.blockId === editingDraft.blockId
    )

    const payload = {
      workspaceId,
      workflowId: editingDraft.workflowId,
      blockId: editingDraft.blockId,
      providerId: editingDraft.providerId,
      interval: editingDraft.interval,
      indicatorId: editingDraft.indicatorId,
      listing: editingDraft.listing,
      ...(authPayload ? { auth: authPayload } : {}),
      ...(Object.keys(providerParams).length > 0 ? { providerParams } : {}),
      isActive: editingDraft.isActive && target?.isDeployed === true,
    }

    setSaving(true)
    setMonitorsError(null)

    try {
      if (!editingKey) {
        const response = await fetch('/api/indicator-monitors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        if (!response.ok) {
          throw new Error(await parseErrorMessage(response))
        }

        const savedMonitor = await parseMonitorResponse(response)
        if (savedMonitor) {
          upsertMonitor(savedMonitor)
          hasAutoSelectedInitialMonitorRef.current = true
          setSelectedMonitorId(savedMonitor.monitorId)
        }
      } else {
        const response = await fetch(`/api/indicator-monitors/${encodeURIComponent(editingKey)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        if (!response.ok) {
          throw new Error(await parseErrorMessage(response))
        }

        const savedMonitor = await parseMonitorResponse(response)
        if (savedMonitor) {
          upsertMonitor(savedMonitor)
        }
      }

      cancelEditing()
    } catch (error) {
      setMonitorsError(error instanceof Error ? error.message : 'Failed to save monitor')
    } finally {
      setSaving(false)
    }
  }, [
    cancelEditing,
    editingDraft,
    editingKey,
    editingNonSecretDefinitions,
    upsertMonitor,
    validateDraft,
    workflowTargets,
    workspaceId,
  ])

  const toggleMonitorState = useCallback(
    async (monitor: IndicatorMonitorRecord) => {
      const nextIsActive = !monitor.isActive
      const entity = monitorEntities.find((entry) => entry.id === monitor.monitorId)

      if (
        nextIsActive &&
        entity &&
        (!entity.canResume || entity.needsDeploy || !entity.authConfigured)
      ) {
        setMonitorsError(
          'Resume is disabled until auth is configured and the workflow target is deployed.'
        )
        return
      }

      setTogglingMonitorId(monitor.monitorId)
      setMonitorsError(null)
      setMonitors((current) =>
        current.map((entry) =>
          entry.monitorId === monitor.monitorId ? { ...entry, isActive: nextIsActive } : entry
        )
      )

      try {
        const response = await fetch(
          `/api/indicator-monitors/${encodeURIComponent(monitor.monitorId)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              workspaceId,
              isActive: nextIsActive,
            }),
          }
        )

        if (!response.ok) {
          throw new Error(await parseErrorMessage(response))
        }

        const savedMonitor = await parseMonitorResponse(response)
        if (savedMonitor) {
          upsertMonitor(savedMonitor)
        }
      } catch (error) {
        setMonitors((current) =>
          current.map((entry) =>
            entry.monitorId === monitor.monitorId ? { ...entry, isActive: !nextIsActive } : entry
          )
        )
        setMonitorsError(error instanceof Error ? error.message : 'Failed to update monitor state')
      } finally {
        setTogglingMonitorId(null)
      }
    },
    [monitorEntities, upsertMonitor, workspaceId]
  )

  const removeMonitor = useCallback(async (monitorId: string) => {
    setDeletingMonitorId(monitorId)
    setMonitorsError(null)

    try {
      const response = await fetch(`/api/indicator-monitors/${encodeURIComponent(monitorId)}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error(await parseErrorMessage(response))
      }

      setMonitors((current) => current.filter((entry) => entry.monitorId !== monitorId))
      setPendingMonitorDelete(null)
    } catch (error) {
      setMonitorsError(error instanceof Error ? error.message : 'Failed to delete monitor')
    } finally {
      setDeletingMonitorId(null)
    }
  }, [])

  const handleMoveMonitorStatus = useCallback(
    (monitor: IndicatorMonitorRecord, nextStatus: 'running' | 'paused') => {
      if (nextStatus === 'running' && !monitor.isActive) {
        void toggleMonitorState(monitor)
      }

      if (nextStatus === 'paused' && monitor.isActive) {
        void toggleMonitorState(monitor)
      }
    },
    [toggleMonitorState]
  )

  const handleActiveViewChange = useCallback(
    async (nextViewId: string) => {
      const nextView = viewRows.find((row) => row.id === nextViewId)
      if (!nextView) return

      setViewsError(null)

      try {
        await activateMonitorView(workspaceId, nextViewId)
        setViewRows((current) =>
          current.map((row) => ({
            ...row,
            isActive: row.id === nextViewId,
          }))
        )
        setActiveViewId(nextViewId)
        setViewConfig(normalizeMonitorViewConfig(nextView.config))
      } catch (error) {
        setViewsError(error instanceof Error ? error.message : 'Failed to activate monitor view')
      }
    },
    [viewRows, workspaceId]
  )

  const openNameDialog = useCallback(
    (mode: MonitorNameDialogMode) => {
      setNameDialogMode(mode)
      setNameDialogValue(
        mode === 'rename'
          ? (activeViewRow?.name ?? '')
          : mode === 'duplicate'
            ? `${activeViewRow?.name ?? 'View'} Copy`
            : getInitialViewName(viewRows.length)
      )
    },
    [activeViewRow, viewRows.length]
  )

  const submitNameDialog = useCallback(async () => {
    if (!nameDialogMode) return

    const trimmedName = nameDialogValue.trim()
    if (!trimmedName) return

    setNameDialogBusy(true)
    setViewsError(null)

    try {
      if (nameDialogMode === 'rename' && activeViewId) {
        await updateMonitorView(workspaceId, activeViewId, { name: trimmedName })
        setViewRows((current) =>
          current.map((row) => (row.id === activeViewId ? { ...row, name: trimmedName } : row))
        )
      }

      if (nameDialogMode === 'create' || nameDialogMode === 'duplicate') {
        const makeActive = nameDialogMode === 'create'
        const createdRow = await createMonitorView(workspaceId, {
          name: trimmedName,
          config: persistedConfig,
          makeActive,
        })

        if (createdRow.isActive) {
          setViewRows((current) =>
            current
              .map((row) => ({ ...row, isActive: false }))
              .concat([{ ...createdRow, isActive: true }])
          )
          setActiveViewId(createdRow.id)
          setViewConfig(normalizeMonitorViewConfig(createdRow.config))
        } else {
          setViewRows((current) => current.concat([{ ...createdRow, isActive: false }]))
        }
      }

      setNameDialogMode(null)
      setNameDialogValue('')
    } catch (error) {
      setViewsError(error instanceof Error ? error.message : 'Failed to update monitor views')
    } finally {
      setNameDialogBusy(false)
    }
  }, [activeViewId, nameDialogMode, nameDialogValue, persistedConfig, workspaceId])

  const deletableViewOptions = useMemo(() => viewRows.filter((row) => !row.isActive), [viewRows])

  const deleteView = useCallback(
    async (viewId: string) => {
      if (!viewId) return

      setDeletingViewId(viewId)
      setViewsError(null)

      try {
        await removeMonitorView(workspaceId, viewId)
        setViewRows((current) => {
          const nextRows = current.filter((row) => row.id !== viewId)
          if (nextRows.every((row) => row.isActive)) {
            setNameDialogMode(null)
          }
          return nextRows
        })
      } catch (error) {
        setViewsError(error instanceof Error ? error.message : 'Failed to delete monitor view')
      } finally {
        setDeletingViewId(null)
      }
    },
    [workspaceId]
  )

  const updateActiveConfig = useCallback(
    (updater: (current: MonitorViewConfig) => MonitorViewConfig) => {
      setViewConfig((current) => normalizeMonitorViewConfig(updater(current)))
    },
    []
  )

  const handleUpdateStatusBoardCardOrder = useCallback(
    (nextVisibleOrder: string[]) => {
      updateActiveConfig((current) => ({
        ...current,
        board: {
          ...current.board,
          cardOrder: mergeVisibleStatusBoardCardOrder(current.board.cardOrder, nextVisibleOrder),
        },
      }))
    },
    [updateActiveConfig]
  )

  const workflowFilterOptions = useMemo(() => {
    const map = new Map(workflowOptions.map((workflow) => [workflow.workflowId, workflow] as const))

    monitorEntities.forEach((entity) => {
      if (!map.has(entity.monitor.workflowId)) {
        map.set(entity.monitor.workflowId, {
          workflowId: entity.monitor.workflowId,
          workflowName: entity.workflowName,
          workflowColor: entity.workflowColor,
        })
      }
    })

    return Array.from(map.values()).sort((left, right) =>
      left.workflowName.localeCompare(right.workflowName)
    )
  }, [monitorEntities, workflowOptions])

  const selectMonitor = useCallback((monitorId: string) => {
    hasAutoSelectedInitialMonitorRef.current = true
    setSelectedMonitorId(monitorId)
  }, [setSelectedMonitorId])

  const clearSelectedMonitor = useCallback(() => {
    hasAutoSelectedInitialMonitorRef.current = true
    setSelectedMonitorId(null)
  }, [setSelectedMonitorId])

  const editorProviderIntervals = useMemo(
    () =>
      editingDraft?.providerId
        ? (getMarketSeriesCapabilities(editingDraft.providerId)?.intervals ?? [])
        : [],
    [editingDraft?.providerId]
  )

  const handleEditorOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        setIsEditorOpen(true)
        return
      }

      cancelEditing()
    },
    [cancelEditing]
  )

  const currentPanelLayout =
    normalizedConfig.panelSizes[normalizedConfig.layout] ??
    getDefaultPanelSizes(normalizedConfig.layout)

  const isViewBootstrapPending = viewStateMode === 'loading'
  const isRefreshing =
    monitorsLoading ||
    referenceLoading ||
    saving ||
    latestLogDetailQuery.isRefetching ||
    latestLogQuery.isRefetching ||
    isViewBootstrapPending ||
    viewStateReloading
  const triggerGroupOptionVisible = monitorsLoading || hasMultipleTriggers
  const showTriggerFilterControl = monitorsLoading || filterOptions.triggers.length > 1
  const showProviderFilterControl = monitorsLoading || filterOptions.providers.length > 1
  const showIntervalFilterControl = monitorsLoading || filterOptions.intervals.length > 1
  const showAssetTypeFilterControl = monitorsLoading || filterOptions.assetTypes.length > 1
  const showProviderVisibilityToggle = monitorsLoading || filterOptions.providers.length > 1
  const showIntervalVisibilityToggle = monitorsLoading || filterOptions.intervals.length > 1
  const showAssetTypeVisibilityToggle = monitorsLoading || filterOptions.assetTypes.length > 1
  const showTriggerVisibilityToggle = monitorsLoading || hasMultipleTriggers
  const isLatestLogDetailPending =
    latestLogState.status === 'ready' &&
    !latestLogDetailError &&
    (!selectedMonitorLog ||
      (latestLogDetailQuery.isFetching && latestLogDetailQuery.data?.id !== latestLogState.logId))

  const renderPrimarySurface = () => {
    if (isViewBootstrapPending) {
      return (
        <PanelEmptyState
          title='Loading monitor views'
          description='Restoring the saved monitor layout before the control plane becomes interactive.'
        />
      )
    }

    if (monitorsLoading && monitors.length === 0) {
      return (
        <PanelEmptyState
          title='Loading monitor control plane'
          description='Fetching monitors, view configuration, and current deployment references.'
        />
      )
    }

    if (normalizedConfig.layout === 'board') {
      return (
        <MonitorBoard
          columns={boardColumns}
          groupBy={normalizedConfig.board.groupBy}
          visibleFields={normalizedConfig.visibleFields}
          selectedMonitorId={selectedMonitorId}
          togglingMonitorId={togglingMonitorId}
          deletingMonitorId={deletingMonitorId}
          onSelectMonitor={selectMonitor}
          onEditMonitor={beginEditMonitor}
          onToggleMonitorState={(monitor) => {
            void toggleMonitorState(monitor)
          }}
          onDeleteMonitor={(monitorId) => {
            const monitor = monitors.find((entry) => entry.monitorId === monitorId) ?? null
            if (monitor) {
              setPendingMonitorDelete(monitor)
            }
          }}
          onMoveMonitorStatus={handleMoveMonitorStatus}
          onUpdateStatusBoardCardOrder={handleUpdateStatusBoardCardOrder}
        />
      )
    }

    return (
      <MonitorRoadmap
        groups={roadmapGroups}
        range={normalizedConfig.roadmap.range}
        zoom={normalizedConfig.roadmap.zoom}
        selectedMonitorId={selectedMonitorId}
        onRangeChange={(range) =>
          updateActiveConfig((current) => ({
            ...current,
            roadmap: {
              ...current.roadmap,
              range,
            },
          }))
        }
        onSelectMonitor={selectMonitor}
        onZoomChange={(zoom) =>
          updateActiveConfig((current) => ({
            ...current,
            roadmap: {
              ...current.roadmap,
              zoom,
            },
          }))
        }
      />
    )
  }

  const renderInspectorBody = () => {
    if (!selectedMonitorEntity) {
      return null
    }

    if (latestLogState.status === 'loading') {
      return (
        <PanelEmptyState
          title='Loading latest log'
          description='Fetching the newest execution detail for this monitor.'
        />
      )
    }

    if (latestLogState.status === 'error') {
      return (
        <InspectorState
          title='Unable to load latest log'
          description={latestLogLookupError ?? 'Failed to fetch the latest log for this monitor.'}
          actionLabel='Retry latest log lookup'
          onAction={() => {
            void latestLogQuery.refetch()
          }}
        />
      )
    }

    if (latestLogState.status === 'empty') {
      return (
        <PanelEmptyState
          title='No log history yet'
          description='This monitor has not produced a matching execution log yet.'
        />
      )
    }

    if (latestLogState.status === 'ready' && latestLogDetailError) {
      return (
        <InspectorState
          title='Unable to load log detail'
          description={
            latestLogDetailError ?? 'Failed to fetch the selected monitor log details.'
          }
          actionLabel='Retry log detail'
          onAction={() => {
            void latestLogDetailQuery.refetch()
          }}
        />
      )
    }

    if (isLatestLogDetailPending || !selectedMonitorLog) {
      return (
        <PanelEmptyState
          title='Loading log detail'
          description='Resolving the newest execution payload for the selected monitor.'
        />
      )
    }

    return (
      <LogDetails log={selectedMonitorLog} isOpen onClose={clearSelectedMonitor} />
    )
  }

  const renderInspector = () => {
    if (!selectedMonitorEntity) {
      return null
    }

    return (
      <div className='flex h-full min-h-0 min-w-0 flex-col gap-3'>
        <div className='rounded-xl border bg-card/60 p-4'>
          <div className='flex items-start justify-between gap-3'>
            <div className='min-w-0'>
              <div className='font-medium text-sm'>{selectedMonitorEntity.listingLabel}</div>
              <div className='text-muted-foreground text-xs'>
                {selectedMonitorEntity.indicatorName}
              </div>
            </div>
            <Button
              variant='ghost'
              size='icon'
              className='h-8 w-8 shrink-0'
              onClick={clearSelectedMonitor}
            >
              <X className='h-4 w-4' />
              <span className='sr-only'>Close inspector</span>
            </Button>
          </div>

          <div className='mt-3 flex flex-wrap items-center gap-2'>
            <Badge variant='outline'>{selectedMonitorEntity.workflowName}</Badge>
            <Badge variant='outline'>{selectedMonitorEntity.providerName}</Badge>
            <Badge variant='outline'>
              {selectedMonitorEntity.monitor.providerConfig.monitor.interval}
            </Badge>
            <Badge variant='outline'>
              {getMonitorStatusLabel(selectedMonitorEntity.primaryStatus)}
            </Badge>
            {selectedMonitorEntity.secondaryStatuses.map((status) => (
              <Badge key={status} variant='outline'>
                {getMonitorStatusLabel(status)}
              </Badge>
            ))}
          </div>

          <div className='mt-3 flex flex-wrap items-center gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => beginEditMonitor(selectedMonitorEntity.monitor)}
            >
              Edit
            </Button>
            <Button
              variant='outline'
              size='sm'
              disabled={
                selectedMonitorEntity.monitor.isActive
                  ? !selectedMonitorEntity.canPause ||
                    togglingMonitorId === selectedMonitorEntity.id
                  : !selectedMonitorEntity.canResume ||
                    togglingMonitorId === selectedMonitorEntity.id
              }
              onClick={() => void toggleMonitorState(selectedMonitorEntity.monitor)}
            >
              {selectedMonitorEntity.monitor.isActive ? 'Pause' : 'Resume'}
            </Button>
            <Button
              variant='outline'
              size='sm'
              className='text-destructive hover:text-destructive'
              disabled={deletingMonitorId === selectedMonitorEntity.id}
              onClick={() => setPendingMonitorDelete(selectedMonitorEntity.monitor)}
            >
              Delete
            </Button>
          </div>
        </div>

        <div className='min-h-0 flex-1'>{renderInspectorBody()}</div>
      </div>
    )
  }

  return (
    <div className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background'>
      <div className='border-b bg-card/70 px-4 py-3'>
        <div className='flex flex-col gap-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <div className='flex items-center gap-2'>
              {isViewBootstrapPending ? (
                <Button variant='outline' className='h-9 justify-start bg-background' disabled>
                  Loading views...
                </Button>
              ) : viewStateMode === 'server' ? (
                <SearchableDropdown
                  value={activeViewId}
                  options={viewRows.map((row) => ({
                    value: row.id,
                    label: row.name,
                    searchValue: row.name,
                  }))}
                  placeholder='Select view'
                  searchPlaceholder='Search views...'
                  emptyText='No views found.'
                  disabled={isViewBootstrapPending || viewStateMode !== 'server'}
                  renderOption={(option) => {
                    const row = viewRows.find((candidate) => candidate.id === option.value) ?? null

                    return (
                      <div className='flex min-w-0 flex-1 items-center justify-between gap-2'>
                        <div className='min-w-0 truncate'>{option.label}</div>
                        {row?.isActive ? (
                          <Badge variant='outline' className='text-[10px]'>
                            Active
                          </Badge>
                        ) : null}
                      </div>
                    )
                  }}
                  onValueChange={(value) => {
                    if (viewStateMode !== 'server') return
                    void handleActiveViewChange(value)
                  }}
                  triggerClassName='h-9 w-[220px] bg-background'
                />
              ) : (
                <Button variant='outline' className='h-9 justify-start bg-background' disabled>
                  Views unavailable
                </Button>
              )}
              {viewStateMode === 'server' ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant='outline'
                      className='h-9 bg-background'
                      disabled={isViewBootstrapPending}
                    >
                      View actions
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='start'>
                    <DropdownMenuLabel>Monitor views</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => openNameDialog('create')}>
                      Create view
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => openNameDialog('rename')}
                      disabled={!activeViewId}
                    >
                      Rename active view
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openNameDialog('duplicate')}>
                      Duplicate active view
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {deletableViewOptions.length > 0 ? (
                      deletableViewOptions.map((row) => (
                        <DropdownMenuItem
                          key={row.id}
                          disabled={deletingViewId === row.id}
                          onClick={() => {
                            void deleteView(row.id)
                          }}
                        >
                          {deletingViewId === row.id
                            ? `Deleting ${row.name}...`
                            : `Delete ${row.name}`}
                        </DropdownMenuItem>
                      ))
                    ) : (
                      <DropdownMenuItem disabled>Delete view</DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>

            <div className='inline-flex h-9 items-center rounded-md border bg-background p-1'>
              <Button
                variant='ghost'
                size='sm'
                className={cn(
                  'h-7 px-3 text-xs',
                  normalizedConfig.layout === 'board'
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground'
                )}
                disabled={isViewBootstrapPending}
                onClick={() =>
                  updateActiveConfig((current) => ({
                    ...current,
                    layout: 'board',
                  }))
                }
              >
                Kanban
              </Button>
              <Button
                variant='ghost'
                size='sm'
                className={cn(
                  'h-7 px-3 text-xs',
                  normalizedConfig.layout === 'roadmap'
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground'
                )}
                disabled={isViewBootstrapPending}
                onClick={() =>
                  updateActiveConfig((current) => ({
                    ...current,
                    layout: 'roadmap',
                  }))
                }
              >
                Timeline
              </Button>
            </div>

            <div className='relative min-w-[260px] flex-1 md:max-w-md'>
              <Search className='absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder='Search listing, indicator, workflow, or provider'
                disabled={isViewBootstrapPending}
                className='h-9 bg-background pl-9'
              />
            </div>

            <SearchableDropdown
              value={normalizedConfig.filters.workflowId}
              options={[
                { value: '__all__', label: 'All workflows', searchValue: 'All workflows' },
                ...workflowFilterOptions.map((workflow) => ({
                  value: workflow.workflowId,
                  label: workflow.workflowName,
                  searchValue: workflow.workflowName,
                })),
              ]}
              placeholder='Workflow'
              searchPlaceholder='Search workflows...'
              emptyText='No workflows found.'
              disabled={isViewBootstrapPending}
              onValueChange={(value) =>
                updateActiveConfig((current) => ({
                  ...current,
                  filters: {
                    ...current.filters,
                    workflowId: value === '__all__' ? null : value,
                  },
                }))
              }
              triggerClassName='h-9 w-[220px] bg-background'
            />

            <label className='flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm'>
              <Switch
                checked={normalizedConfig.filters.attentionOnly}
                disabled={isViewBootstrapPending}
                onCheckedChange={(checked) =>
                  updateActiveConfig((current) => ({
                    ...current,
                    filters: {
                      ...current.filters,
                      attentionOnly: checked,
                    },
                  }))
                }
              />
              <span>Attention only</span>
            </label>

            <Button
              variant='outline'
              className='h-9 bg-background'
              disabled={isViewBootstrapPending}
              onClick={() => setViewOptionsOpen(true)}
            >
              <SlidersHorizontal className='mr-2 h-4 w-4' />
              View options
            </Button>

            <Button
              variant='outline'
              className='h-9 bg-background'
              disabled={isViewBootstrapPending}
              onClick={() => void refreshPage()}
            >
              {isRefreshing ? (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              ) : (
                <RefreshCw className='mr-2 h-4 w-4' />
              )}
              Refresh
            </Button>

            <Button
              className='h-9'
              onClick={beginCreateMonitor}
              disabled={!canAddMonitor || isViewBootstrapPending}
            >
              <Plus className='mr-2 h-4 w-4' />
              Add monitor
            </Button>
          </div>

          {viewsError ? <div className='text-amber-600 text-xs'>{viewsError}</div> : null}
          {referenceWarning ? (
            <div className='text-amber-600 text-xs'>{referenceWarning}</div>
          ) : null}
          {monitorsError ? <div className='text-destructive text-xs'>{monitorsError}</div> : null}
          {!canAddMonitor && addMonitorDisabledReason ? (
            <div className='text-muted-foreground text-xs'>{addMonitorDisabledReason}</div>
          ) : null}
        </div>
      </div>

      <div className='min-h-0 flex-1 overflow-hidden p-3'>
        {isDesktopInspector && selectedMonitorEntity ? (
          <ResizablePanelGroup
            key={normalizedConfig.layout}
            direction='horizontal'
            className='h-full min-h-0 min-w-0'
            onLayout={(sizes) =>
              updateActiveConfig((current) => ({
                ...current,
                panelSizes: {
                  ...current.panelSizes,
                  [current.layout]: [sizes[0] ?? 0, sizes[1] ?? 0],
                },
              }))
            }
          >
            <ResizablePanel order={1} defaultSize={currentPanelLayout[0]} minSize={45}>
              <div className='h-full min-h-0 min-w-0 pr-2'>{renderPrimarySurface()}</div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            <ResizablePanel order={2} defaultSize={currentPanelLayout[1]} minSize={24}>
              <div className='h-full min-h-0 min-w-0 pl-2'>{renderInspector()}</div>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <div className='h-full min-h-0 min-w-0'>{renderPrimarySurface()}</div>
        )}
      </div>

      {!isDesktopInspector ? (
        <Sheet
          open={Boolean(selectedMonitorEntity)}
          onOpenChange={(open) => {
            if (!open) {
              clearSelectedMonitor()
            }
          }}
        >
          <SheetContent side='right' className='w-[min(92vw,460px)] overflow-y-auto p-4 sm:max-w-[460px]'>
            {renderInspector()}
          </SheetContent>
        </Sheet>
      ) : null}

      <Dialog open={viewOptionsOpen} onOpenChange={setViewOptionsOpen}>
        <DialogContent className='max-h-[85vh] overflow-hidden sm:max-w-[560px]'>
          <DialogHeader>
            <DialogTitle>View options</DialogTitle>
            <DialogDescription>
              Personalize grouping, timeline scale, sorting, filters, and visible card metadata
              for the active monitor view.
            </DialogDescription>
          </DialogHeader>

          <div className='mt-2 space-y-6 overflow-y-auto pb-2'>
            <section className='space-y-3'>
              <div className='font-medium text-sm'>Timeline scale</div>
              <SearchableDropdown
                value={normalizedConfig.roadmap.range}
                options={MONITOR_TIMELINE_RANGES.map((range) => ({
                  value: range,
                  label:
                    range === 'daily' ? 'Day' : range === 'monthly' ? 'Month' : 'Quarter',
                }))}
                placeholder='Timeline interval'
                searchPlaceholder='Search timeline intervals...'
                emptyText='No timeline intervals found.'
                onValueChange={(value) =>
                  updateActiveConfig((current) => ({
                    ...current,
                    roadmap: {
                      ...current.roadmap,
                      range: value as MonitorViewConfig['roadmap']['range'],
                    },
                  }))
                }
              />

              <div className='space-y-2'>
                <div className='flex items-center justify-between gap-3 text-xs'>
                  <span className='text-muted-foreground'>Zoom</span>
                  <span className='font-medium'>{normalizedConfig.roadmap.zoom}%</span>
                </div>
                <Input
                  type='range'
                  min={MIN_MONITOR_TIMELINE_ZOOM}
                  max={MAX_MONITOR_TIMELINE_ZOOM}
                  step={MONITOR_TIMELINE_ZOOM_STEP}
                  value={normalizedConfig.roadmap.zoom}
                  onChange={(event) =>
                    updateActiveConfig((current) => ({
                      ...current,
                      roadmap: {
                        ...current.roadmap,
                        zoom: Number(event.target.value),
                      },
                    }))
                  }
                  className='h-3 bg-transparent px-0'
                />
              </div>
            </section>

            <Separator />

            <section className='space-y-3'>
              <div className='font-medium text-sm'>Kanban grouping</div>
              <SearchableDropdown
                value={normalizedConfig.board.groupBy}
                options={[
                  { value: 'status', label: 'Status' },
                  { value: 'workflow', label: 'Workflow' },
                  ...(triggerGroupOptionVisible ? [{ value: 'trigger', label: 'Trigger' }] : []),
                  { value: 'listing', label: 'Listing' },
                  { value: 'assetType', label: 'Asset Type' },
                  { value: 'provider', label: 'Provider' },
                  { value: 'interval', label: 'Interval' },
                ]}
                placeholder='Group by'
                searchPlaceholder='Search groupings...'
                emptyText='No grouping options found.'
                onValueChange={(value) =>
                  updateActiveConfig((current) => ({
                    ...current,
                    board: {
                      ...current.board,
                      groupBy: value as MonitorViewConfig['board']['groupBy'],
                    },
                  }))
                }
              />
              <div className='text-muted-foreground text-xs'>
                Drag-and-drop writes are only enabled when grouped by status.
              </div>
            </section>

            <Separator />

            <section className='space-y-3'>
              <div className='font-medium text-sm'>Sorting</div>
              <SearchableDropdown
                value={normalizedConfig.sort.field}
                options={[
                  { value: 'updatedAt', label: 'Updated time' },
                  { value: 'listingLabel', label: 'Listing' },
                  { value: 'workflowName', label: 'Workflow' },
                  { value: 'providerId', label: 'Provider' },
                  { value: 'interval', label: 'Interval' },
                ]}
                placeholder='Sort by'
                searchPlaceholder='Search sorting fields...'
                emptyText='No sorting options found.'
                onValueChange={(value) =>
                  updateActiveConfig((current) => ({
                    ...current,
                    sort: {
                      ...current.sort,
                      field: value as MonitorViewConfig['sort']['field'],
                    },
                  }))
                }
              />
              <div className='inline-flex h-9 items-center rounded-md border bg-background p-1'>
                <Button
                  variant='ghost'
                  size='sm'
                  className={cn(
                    'h-7 px-3 text-xs',
                    normalizedConfig.sort.direction === 'desc'
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground'
                  )}
                  onClick={() =>
                    updateActiveConfig((current) => ({
                      ...current,
                      sort: {
                        ...current.sort,
                        direction: 'desc',
                      },
                    }))
                  }
                >
                  Desc
                </Button>
                <Button
                  variant='ghost'
                  size='sm'
                  className={cn(
                    'h-7 px-3 text-xs',
                    normalizedConfig.sort.direction === 'asc'
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground'
                  )}
                  onClick={() =>
                    updateActiveConfig((current) => ({
                      ...current,
                      sort: {
                        ...current.sort,
                        direction: 'asc',
                      },
                    }))
                  }
                >
                  Asc
                </Button>
              </div>
            </section>

            <Separator />

            <section className='space-y-4'>
              <div className='font-medium text-sm'>Filters</div>

              {showTriggerFilterControl ? (
                <FilterChecklist
                  title='Trigger'
                  options={filterOptions.triggers}
                  selected={normalizedConfig.filters.triggerIds}
                  disabled={monitorsLoading}
                  loading={monitorsLoading}
                  onToggle={(value) =>
                    updateActiveConfig((current) => ({
                      ...current,
                      filters: {
                        ...current.filters,
                        triggerIds: toggleStringFilter(current.filters.triggerIds, value),
                      },
                    }))
                  }
                />
              ) : null}

              {showProviderFilterControl ? (
                <FilterChecklist
                  title='Provider'
                  options={filterOptions.providers}
                  selected={normalizedConfig.filters.providerIds}
                  disabled={monitorsLoading}
                  loading={monitorsLoading}
                  onToggle={(value) =>
                    updateActiveConfig((current) => ({
                      ...current,
                      filters: {
                        ...current.filters,
                        providerIds: toggleStringFilter(current.filters.providerIds, value),
                      },
                    }))
                  }
                />
              ) : null}

              {showIntervalFilterControl ? (
                <FilterChecklist
                  title='Interval'
                  options={filterOptions.intervals}
                  selected={normalizedConfig.filters.intervals}
                  disabled={monitorsLoading}
                  loading={monitorsLoading}
                  onToggle={(value) =>
                    updateActiveConfig((current) => ({
                      ...current,
                      filters: {
                        ...current.filters,
                        intervals: toggleStringFilter(current.filters.intervals, value),
                      },
                    }))
                  }
                />
              ) : null}

              {showAssetTypeFilterControl ? (
                <FilterChecklist
                  title='Asset type'
                  options={filterOptions.assetTypes}
                  selected={normalizedConfig.filters.assetTypes}
                  disabled={monitorsLoading}
                  loading={monitorsLoading}
                  onToggle={(value) =>
                    updateActiveConfig((current) => ({
                      ...current,
                      filters: {
                        ...current.filters,
                        assetTypes: toggleStringFilter(current.filters.assetTypes, value),
                      },
                    }))
                  }
                />
              ) : null}
            </section>

            <Separator />

            <section className='space-y-3'>
              <div className='font-medium text-sm'>Visible metadata</div>
              <VisibilityToggle
                label='Workflow'
                checked={normalizedConfig.visibleFields.workflow}
                onCheckedChange={(checked) =>
                  updateActiveConfig((current) => ({
                    ...current,
                    visibleFields: {
                      ...current.visibleFields,
                      workflow: checked,
                    },
                  }))
                }
              />
              {showProviderVisibilityToggle ? (
                <VisibilityToggle
                  label='Provider'
                  checked={normalizedConfig.visibleFields.provider}
                  disabled={monitorsLoading}
                  onCheckedChange={(checked) =>
                    updateActiveConfig((current) => ({
                      ...current,
                      visibleFields: {
                        ...current.visibleFields,
                        provider: checked,
                      },
                    }))
                  }
                />
              ) : null}
              {showIntervalVisibilityToggle ? (
                <VisibilityToggle
                  label='Interval'
                  checked={normalizedConfig.visibleFields.interval}
                  disabled={monitorsLoading}
                  onCheckedChange={(checked) =>
                    updateActiveConfig((current) => ({
                      ...current,
                      visibleFields: {
                        ...current.visibleFields,
                        interval: checked,
                      },
                    }))
                  }
                />
              ) : null}
              {showAssetTypeVisibilityToggle ? (
                <VisibilityToggle
                  label='Asset type'
                  checked={normalizedConfig.visibleFields.assetType}
                  disabled={monitorsLoading}
                  onCheckedChange={(checked) =>
                    updateActiveConfig((current) => ({
                      ...current,
                      visibleFields: {
                        ...current.visibleFields,
                        assetType: checked,
                      },
                    }))
                  }
                />
              ) : null}
              {showTriggerVisibilityToggle ? (
                <VisibilityToggle
                  label='Trigger'
                  checked={normalizedConfig.visibleFields.trigger}
                  disabled={monitorsLoading}
                  onCheckedChange={(checked) =>
                    updateActiveConfig((current) => ({
                      ...current,
                      visibleFields: {
                        ...current.visibleFields,
                        trigger: checked,
                      },
                    }))
                  }
                />
              ) : null}
              <VisibilityToggle
                label='Auth health'
                checked={normalizedConfig.visibleFields.authHealth}
                onCheckedChange={(checked) =>
                  updateActiveConfig((current) => ({
                    ...current,
                    visibleFields: {
                      ...current.visibleFields,
                      authHealth: checked,
                    },
                  }))
                }
              />
              <VisibilityToggle
                label='Deploy health'
                checked={normalizedConfig.visibleFields.deployHealth}
                onCheckedChange={(checked) =>
                  updateActiveConfig((current) => ({
                    ...current,
                    visibleFields: {
                      ...current.visibleFields,
                      deployHealth: checked,
                    },
                  }))
                }
              />
              <VisibilityToggle
                label='Updated time'
                checked={normalizedConfig.visibleFields.updatedAt}
                onCheckedChange={(checked) =>
                  updateActiveConfig((current) => ({
                    ...current,
                    visibleFields: {
                      ...current.visibleFields,
                      updatedAt: checked,
                    },
                  }))
                }
              />
            </section>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={nameDialogMode !== null}
        onOpenChange={(open) => {
          if (!open) {
            setNameDialogMode(null)
            setNameDialogValue('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {nameDialogMode === 'rename'
                ? 'Rename monitor view'
                : nameDialogMode === 'duplicate'
                  ? 'Duplicate monitor view'
                  : 'Create monitor view'}
            </DialogTitle>
            <DialogDescription>
              {nameDialogMode === 'rename'
                ? 'Update the name of the current personal monitor view.'
                : 'Save the current monitor configuration as a personal view.'}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={nameDialogValue}
            onChange={(event) => setNameDialogValue(event.target.value)}
            placeholder='View name'
          />
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => {
                setNameDialogMode(null)
                setNameDialogValue('')
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void submitNameDialog()}
              disabled={nameDialogBusy || !nameDialogValue.trim()}
            >
              {nameDialogBusy ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingMonitorDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingMonitorDelete(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete monitor</DialogTitle>
            <DialogDescription>
              This permanently removes the monitor configuration and stops future
              indicator-triggered executions for it.
            </DialogDescription>
          </DialogHeader>
          <div className='rounded-md border bg-muted/40 px-3 py-2 text-sm'>
            {pendingMonitorDelete ? (
              <span>
                {pendingMonitorDelete.providerConfig.monitor.providerId} ·{' '}
                {pendingMonitorDelete.providerConfig.monitor.interval}
              </span>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setPendingMonitorDelete(null)}>
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={() => {
                if (pendingMonitorDelete) {
                  void removeMonitor(pendingMonitorDelete.monitorId)
                }
              }}
              disabled={
                !pendingMonitorDelete || deletingMonitorId === pendingMonitorDelete?.monitorId
              }
            >
              {deletingMonitorId === pendingMonitorDelete?.monitorId ? (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              ) : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MonitorEditorModal
        open={isEditorOpen}
        editingKey={editingKey}
        draft={editingDraft}
        errors={editingErrors}
        saving={saving}
        streamingProviders={streamingProviders}
        providerIntervals={editorProviderIntervals}
        workflowTargets={workflowTargets}
        workflowPickerOptions={workflowPickerOptions}
        indicatorPickerOptions={indicatorOptions}
        nonSecretDefinitions={editingNonSecretDefinitions}
        secretDefinitions={editingSecretDefinitions}
        listingInstanceId={editingListingInstanceId}
        workspaceId={workspaceId}
        onOpenChange={handleEditorOpenChange}
        onCancel={cancelEditing}
        onSave={() => {
          void persistDraft()
        }}
        onUpdateDraft={updateDraft}
        onUpdateSecretValue={updateSecretValue}
        onUpdateProviderParamValue={updateProviderParamValue}
      />
    </div>
  )
}

function FilterChecklist({
  title,
  options,
  selected,
  disabled = false,
  loading = false,
  onToggle,
}: {
  title: string
  options: Array<{ value: string; label: string }>
  selected: string[]
  disabled?: boolean
  loading?: boolean
  onToggle: (value: string) => void
}) {
  return (
    <div className='space-y-2'>
      <div className='text-muted-foreground text-xs uppercase tracking-[0.12em]'>{title}</div>
      {loading ? (
        <div className='text-muted-foreground text-xs'>Loading options...</div>
      ) : options.length === 0 ? (
        <div className='text-muted-foreground text-xs'>No options available.</div>
      ) : (
        <div className='space-y-2'>
          {options.map((option) => (
            <label key={option.value} className='flex items-center gap-3 text-sm'>
              <Checkbox
                disabled={disabled}
                checked={selected.includes(option.value)}
                onCheckedChange={() => onToggle(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function VisibilityToggle({
  label,
  checked,
  disabled = false,
  onCheckedChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label className='flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm'>
      <span>{label}</span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </label>
  )
}
