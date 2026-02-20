'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { LogDetails } from '@/app/workspace/[workspaceId]/logs/components/log-details/log-details'
import { LogsList } from '@/app/workspace/[workspaceId]/logs/components/logs-list'
import { useLogDetail, useLogsList } from '@/hooks/queries/logs'
import {
  getMarketLiveCapabilities,
  getMarketProviderOptionsByKind,
  getMarketProviderParamDefinitions,
  getMarketSeriesCapabilities,
} from '@/providers/market/providers'
import type { WorkflowLog } from '@/stores/logs/filters/types'
import { useListingSelectorStore } from '@/stores/market/selector/store'
import { loadIndicatorOptions, loadMonitors, loadWorkflowTargetOptions } from './api'
import { MonitorEditorModal } from './monitor-editor-modal'
import { MonitorTable } from './monitor-table'
import {
  type IndicatorMonitorRecord,
  type IndicatorOption,
  LOGS_PER_PAGE,
  type MonitorDraft,
  type MonitorsViewProps,
  type StreamingProviderOption,
  type WorkflowPickerOption,
  type WorkflowTargetOption,
} from './types'
import { buildDefaultDraft, buildDraftFromMonitor, parseErrorMessage } from './utils'

export type { MonitorExportContext } from './types'

export function MonitorsView({
  workspaceId,
  timeRange,
  level,
  searchQuery,
  live,
  onRefreshHandleChange,
  onAddMonitorHandleChange,
  onExportContextChange,
  onRefreshingChange,
}: MonitorsViewProps) {
  const [monitors, setMonitors] = useState<IndicatorMonitorRecord[]>([])
  const [monitorsLoading, setMonitorsLoading] = useState(true)
  const [monitorsError, setMonitorsError] = useState<string | null>(null)
  const [referenceLoading, setReferenceLoading] = useState(true)
  const [indicatorOptions, setIndicatorOptions] = useState<IndicatorOption[]>([])
  const [workflowTargets, setWorkflowTargets] = useState<WorkflowTargetOption[]>([])
  const [selectedMonitorId, setSelectedMonitorId] = useState<string | null>(null)
  const [selectedMonitorLog, setSelectedMonitorLog] = useState<WorkflowLog | null>(null)
  const [selectedMonitorLogIndex, setSelectedMonitorLogIndex] = useState(-1)
  const [isMonitorLogsPanelOpen, setIsMonitorLogsPanelOpen] = useState(false)

  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState<MonitorDraft | null>(null)
  const [editingErrors, setEditingErrors] = useState<Record<string, string>>({})

  const [saving, setSaving] = useState(false)
  const [togglingMonitorId, setTogglingMonitorId] = useState<string | null>(null)
  const [deletingMonitorId, setDeletingMonitorId] = useState<string | null>(null)
  const [panelLayout, setPanelLayout] = useState<number[] | null>(null)

  const monitorLogsLoaderRef = useRef<HTMLDivElement>(null)
  const monitorLogsScrollRef = useRef<HTMLDivElement>(null)
  const selectedMonitorLogRowRef = useRef<HTMLTableRowElement | null>(null)

  const ensureListingSelectorInstance = useListingSelectorStore((state) => state.ensureInstance)
  const updateListingSelectorInstance = useListingSelectorStore((state) => state.updateInstance)

  const streamingProviders = useMemo<StreamingProviderOption[]>(
    () =>
      getMarketProviderOptionsByKind('live').filter((option) =>
        Boolean(getMarketLiveCapabilities(option.id)?.supportsStreaming)
      ),
    []
  )

  const providerOptionById = useMemo(
    () => new Map(streamingProviders.map((option) => [option.id, option] as const)),
    [streamingProviders]
  )

  const indicatorOptionById = useMemo(
    () => new Map(indicatorOptions.map((option) => [option.id, option] as const)),
    [indicatorOptions]
  )

  const workflowTargetByKey = useMemo(
    () =>
      new Map<string, WorkflowTargetOption>(
        workflowTargets.map((target) => [`${target.workflowId}:${target.blockId}`, target])
      ),
    [workflowTargets]
  )

  const workflowPickerOptions = useMemo<WorkflowPickerOption[]>(() => {
    const grouped = new Map<
      string,
      { workflowId: string; workflowName: string; workflowColor: string }
    >()

    workflowTargets.forEach((target) => {
      if (!grouped.has(target.workflowId)) {
        grouped.set(target.workflowId, {
          workflowId: target.workflowId,
          workflowName: target.workflowName,
          workflowColor: target.workflowColor || '#3972F6',
        })
      }
    })

    return Array.from(grouped.values()).sort((a, b) => a.workflowName.localeCompare(b.workflowName))
  }, [workflowTargets])

  const selectedMonitor = useMemo(
    () => monitors.find((monitor) => monitor.monitorId === selectedMonitorId) ?? null,
    [monitors, selectedMonitorId]
  )

  const refreshMonitors = useCallback(async () => {
    setMonitorsLoading(true)
    setMonitorsError(null)

    try {
      const data = await loadMonitors(workspaceId)
      setMonitors(data)
    } catch (error) {
      setMonitorsError(error instanceof Error ? error.message : 'Failed to load monitors')
    } finally {
      setMonitorsLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setReferenceLoading(true)
      setMonitorsError(null)

      try {
        const [nextMonitors, nextIndicatorOptions, nextWorkflowTargets] = await Promise.all([
          loadMonitors(workspaceId),
          loadIndicatorOptions(workspaceId),
          loadWorkflowTargetOptions(workspaceId),
        ])

        if (cancelled) return
        setMonitors(nextMonitors)
        setIndicatorOptions(nextIndicatorOptions)
        setWorkflowTargets(nextWorkflowTargets)
      } catch (error) {
        if (!cancelled) {
          setMonitorsError(error instanceof Error ? error.message : 'Failed to load monitors')
        }
      } finally {
        if (!cancelled) {
          setMonitorsLoading(false)
          setReferenceLoading(false)
        }
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  useEffect(() => {
    if (monitors.length === 0) {
      setSelectedMonitorId(null)
      setIsMonitorLogsPanelOpen(false)
      return
    }

    const hasSelectedMonitor = Boolean(
      selectedMonitorId && monitors.some((monitor) => monitor.monitorId === selectedMonitorId)
    )

    if (!hasSelectedMonitor) {
      setSelectedMonitorId(monitors[0]?.monitorId ?? null)
      setIsMonitorLogsPanelOpen(true)
    }
  }, [monitors, selectedMonitorId])

  const monitorLogFilters = useMemo(
    () => ({
      timeRange,
      level,
      workflowIds: selectedMonitor ? [selectedMonitor.workflowId] : [],
      folderIds: [] as string[],
      triggers: [] as string[],
      searchQuery,
      limit: LOGS_PER_PAGE,
      monitorId: selectedMonitor?.monitorId,
      listing: selectedMonitor?.providerConfig.monitor.listing,
      indicatorId: selectedMonitor?.providerConfig.monitor.indicatorId,
      providerId: selectedMonitor?.providerConfig.monitor.providerId,
      interval: selectedMonitor?.providerConfig.monitor.interval,
      triggerSource: 'indicator_trigger' as const,
    }),
    [timeRange, level, searchQuery, selectedMonitor]
  )

  const monitorLogsQuery = useLogsList(workspaceId, monitorLogFilters, {
    enabled: Boolean(workspaceId && selectedMonitor && isMonitorLogsPanelOpen),
    refetchInterval: live ? 5000 : false,
  })

  const monitorLogs = useMemo(() => {
    if (!monitorLogsQuery.data?.pages) return []
    return monitorLogsQuery.data.pages.flatMap((page) => page.logs)
  }, [monitorLogsQuery.data?.pages])

  const monitorLogsHasMore = Boolean(monitorLogsQuery.hasNextPage)
  const monitorLogsFetchingMore = monitorLogsQuery.isFetchingNextPage
  const monitorLogsLoading = monitorLogsQuery.isLoading && !monitorLogsQuery.data
  const monitorLogsError =
    monitorLogsQuery.error instanceof Error
      ? monitorLogsQuery.error.message
      : monitorLogsQuery.error
        ? 'Failed to fetch monitor logs'
        : null

  const detailedMonitorLogQuery = useLogDetail(selectedMonitorLog?.id)
  const detailedMonitorLog = detailedMonitorLogQuery.data ?? selectedMonitorLog

  const refreshHandler = useCallback(async () => {
    await refreshMonitors()
    if (selectedMonitor) {
      await monitorLogsQuery.refetch()
    }
  }, [refreshMonitors, selectedMonitor, monitorLogsQuery])

  useEffect(() => {
    onRefreshHandleChange(refreshHandler)
    return () => {
      onRefreshHandleChange(null)
    }
  }, [onRefreshHandleChange, refreshHandler])

  useEffect(() => {
    if (!selectedMonitor) {
      onExportContextChange(null)
      return
    }

    onExportContextChange({
      workflowId: selectedMonitor.workflowId,
      monitorId: selectedMonitor.monitorId,
      listing: selectedMonitor.providerConfig.monitor.listing,
      indicatorId: selectedMonitor.providerConfig.monitor.indicatorId,
      providerId: selectedMonitor.providerConfig.monitor.providerId,
      interval: selectedMonitor.providerConfig.monitor.interval,
      triggerSource: 'indicator_trigger',
    })
  }, [selectedMonitor, onExportContextChange])

  const refreshing = monitorsLoading || monitorLogsQuery.isRefetching || saving

  useEffect(() => {
    onRefreshingChange(refreshing)
  }, [refreshing, onRefreshingChange])

  const editingProviderDefinitions = useMemo(() => {
    if (!editingDraft?.providerId) return []
    return getMarketProviderParamDefinitions(editingDraft.providerId, 'live')
  }, [editingDraft?.providerId])

  const editingSecretDefinitions = useMemo(
    () =>
      editingProviderDefinitions.filter(
        (definition) =>
          definition.required &&
          definition.password &&
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
          !definition.password &&
          definition.visibility !== 'hidden' &&
          definition.visibility !== 'llm-only'
      ),
    [editingProviderDefinitions]
  )

  const editingListingInstanceId =
    isEditorOpen && editingDraft ? `indicator-monitor-edit-${editingKey ?? 'new'}` : null

  useEffect(() => {
    if (!editingDraft || !editingListingInstanceId) return

    ensureListingSelectorInstance(editingListingInstanceId, {
      providerId: editingDraft.providerId,
      selectedListingValue: editingDraft.listing,
    })
    updateListingSelectorInstance(editingListingInstanceId, {
      providerId: editingDraft.providerId,
      selectedListingValue: editingDraft.listing,
    })
  }, [
    editingDraft,
    editingListingInstanceId,
    ensureListingSelectorInstance,
    updateListingSelectorInstance,
  ])

  const beginCreateMonitor = useCallback(() => {
    setEditingKey(null)
    setEditingDraft(
      buildDefaultDraft({
        providers: streamingProviders,
      })
    )
    setEditingErrors({})
    setIsEditorOpen(true)
  }, [streamingProviders])

  useEffect(() => {
    onAddMonitorHandleChange(beginCreateMonitor)
    return () => {
      onAddMonitorHandleChange(null)
    }
  }, [onAddMonitorHandleChange, beginCreateMonitor])

  const beginEditMonitor = useCallback((monitor: IndicatorMonitorRecord) => {
    setEditingKey(monitor.monitorId)
    setEditingDraft(buildDraftFromMonitor(monitor))
    setEditingErrors({})
    setIsEditorOpen(true)
  }, [])

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

    const targetKey = `${draft.workflowId}:${draft.blockId}`
    if (!workflowTargetByKey.has(targetKey)) {
      nextErrors.blockId = 'Workflow target must reference an indicator trigger block.'
    }

    const availableIntervals = getMarketSeriesCapabilities(draft.providerId)?.intervals ?? []
    if (!availableIntervals.includes(draft.interval as any)) {
      nextErrors.interval = 'Selected interval is not supported for this provider.'
    }

    const requiredSecretDefinitions = editingSecretDefinitions.filter(
      (definition) => definition.required
    )

    requiredSecretDefinitions.forEach((definition) => {
      const entered = (draft.secretValues[definition.id] || '').trim()
      const hasExisting = draft.existingEncryptedSecretFieldIds.includes(definition.id)
      if (!entered && !hasExisting) {
        nextErrors[`secret:${definition.id}`] = `${definition.title || definition.id} is required.`
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
  }, [editingDraft, workflowTargetByKey, editingSecretDefinitions, editingNonSecretDefinitions])

  const persistDraft = useCallback(async () => {
    if (!editingDraft) return

    const validation = validateDraft()
    setEditingErrors(validation.errors)
    if (!validation.valid) return

    const authPayload = (() => {
      const secrets = Object.fromEntries(
        Object.entries(editingDraft.secretValues)
          .map(([key, value]) => [key, value.trim()] as const)
          .filter(([, value]) => value.length > 0)
      )

      if (Object.keys(secrets).length === 0) {
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
      isActive: editingDraft.isActive,
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
      } else {
        const response = await fetch(`/api/indicator-monitors/${encodeURIComponent(editingKey)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        if (!response.ok) {
          throw new Error(await parseErrorMessage(response))
        }
      }

      await refreshMonitors()
      setIsEditorOpen(false)
      setEditingKey(null)
      setEditingDraft(null)
      setEditingErrors({})
    } catch (error) {
      setMonitorsError(error instanceof Error ? error.message : 'Failed to save monitor')
    } finally {
      setSaving(false)
    }
  }, [
    editingDraft,
    editingKey,
    editingNonSecretDefinitions,
    refreshMonitors,
    validateDraft,
    workspaceId,
  ])

  const toggleMonitorState = useCallback(
    async (monitor: IndicatorMonitorRecord) => {
      setTogglingMonitorId(monitor.monitorId)
      setMonitorsError(null)

      try {
        const response = await fetch(
          `/api/indicator-monitors/${encodeURIComponent(monitor.monitorId)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              workspaceId,
              isActive: !monitor.isActive,
            }),
          }
        )

        if (!response.ok) {
          throw new Error(await parseErrorMessage(response))
        }

        await refreshMonitors()
      } catch (error) {
        setMonitorsError(error instanceof Error ? error.message : 'Failed to update monitor state')
      } finally {
        setTogglingMonitorId(null)
      }
    },
    [workspaceId, refreshMonitors]
  )

  const removeMonitor = useCallback(
    async (monitorId: string) => {
      setDeletingMonitorId(monitorId)
      setMonitorsError(null)

      try {
        const response = await fetch(`/api/indicator-monitors/${encodeURIComponent(monitorId)}`, {
          method: 'DELETE',
        })

        if (!response.ok) {
          throw new Error(await parseErrorMessage(response))
        }

        await refreshMonitors()
      } catch (error) {
        setMonitorsError(error instanceof Error ? error.message : 'Failed to delete monitor')
      } finally {
        setDeletingMonitorId(null)
      }
    },
    [refreshMonitors]
  )

  const selectMonitor = useCallback((monitorId: string) => {
    setSelectedMonitorId(monitorId)
    setIsMonitorLogsPanelOpen(true)
    setSelectedMonitorLog(null)
    setSelectedMonitorLogIndex(-1)
  }, [])

  const handleMonitorLogClick = useCallback(
    (log: WorkflowLog) => {
      setSelectedMonitorLog(log)
      const index = monitorLogs.findIndex((entry) => entry.id === log.id)
      setSelectedMonitorLogIndex(index)
    },
    [monitorLogs]
  )

  const handleNavigateMonitorLogNext = useCallback(() => {
    if (selectedMonitorLogIndex < monitorLogs.length - 1) {
      const nextIndex = selectedMonitorLogIndex + 1
      setSelectedMonitorLogIndex(nextIndex)
      setSelectedMonitorLog(monitorLogs[nextIndex] ?? null)
    }
  }, [selectedMonitorLogIndex, monitorLogs])

  const handleNavigateMonitorLogPrev = useCallback(() => {
    if (selectedMonitorLogIndex > 0) {
      const prevIndex = selectedMonitorLogIndex - 1
      setSelectedMonitorLogIndex(prevIndex)
      setSelectedMonitorLog(monitorLogs[prevIndex] ?? null)
    }
  }, [selectedMonitorLogIndex, monitorLogs])

  const closeMonitorLogDetails = useCallback(() => {
    setSelectedMonitorLog(null)
    setSelectedMonitorLogIndex(-1)
  }, [])

  useEffect(() => {
    if (selectedMonitorLogRowRef.current) {
      selectedMonitorLogRowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [selectedMonitorLogIndex])

  const loadMoreMonitorLogs = useCallback(() => {
    if (monitorLogsFetchingMore || !monitorLogsHasMore) return
    void monitorLogsQuery.fetchNextPage()
  }, [monitorLogsFetchingMore, monitorLogsHasMore, monitorLogsQuery])

  useEffect(() => {
    const loader = monitorLogsLoaderRef.current
    const scrollContainer = monitorLogsScrollRef.current
    if (!loader || !scrollContainer || monitorLogsLoading || !monitorLogsHasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry?.isIntersecting) {
          loadMoreMonitorLogs()
        }
      },
      {
        root: scrollContainer,
        threshold: 0.1,
      }
    )

    observer.observe(loader)
    return () => observer.disconnect()
  }, [monitorLogsLoading, monitorLogsHasMore, loadMoreMonitorLogs])

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

  const monitorLogsList = (
    <LogsList
      logs={monitorLogs}
      selectedLogId={selectedMonitorLog?.id ?? null}
      onLogClick={handleMonitorLogClick}
      loading={monitorLogsLoading}
      error={monitorLogsError}
      hasMore={monitorLogsHasMore}
      isFetchingMore={monitorLogsFetchingMore}
      loaderRef={monitorLogsLoaderRef}
      scrollContainerRef={monitorLogsScrollRef}
      selectedRowRef={selectedMonitorLogRowRef}
    />
  )

  const showMonitorLogs = isMonitorLogsPanelOpen && Boolean(selectedMonitor)
  const showMonitorLogDetails = showMonitorLogs && Boolean(selectedMonitorLog)

  return (
    <div className='flex h-full max-h-full min-h-0 min-w-0 flex-col overflow-hidden'>
      <ResizablePanelGroup
        direction='horizontal'
        className='flex min-h-0 min-w-0 flex-1 overflow-hidden'
        onLayout={(sizes) => setPanelLayout(sizes)}
      >
        <ResizablePanel
          order={1}
          defaultSize={panelLayout?.[0] ?? 42}
          minSize={28}
          className='min-h-0 min-w-0 overflow-hidden p-1'
        >
          <MonitorTable
            monitors={monitors}
            monitorsLoading={monitorsLoading}
            referenceLoading={referenceLoading}
            monitorsError={monitorsError}
            selectedMonitorId={selectedMonitorId}
            togglingMonitorId={togglingMonitorId}
            deletingMonitorId={deletingMonitorId}
            providerOptionById={providerOptionById}
            workflowTargetByKey={workflowTargetByKey}
            indicatorOptionById={indicatorOptionById}
            onSelectMonitor={selectMonitor}
            onBeginEditMonitor={beginEditMonitor}
            onToggleMonitorState={(monitor) => {
              void toggleMonitorState(monitor)
            }}
            onRemoveMonitor={(monitorId) => {
              void removeMonitor(monitorId)
            }}
          />
        </ResizablePanel>

        {showMonitorLogs ? (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel
              order={2}
              defaultSize={
                showMonitorLogDetails ? (panelLayout?.[1] ?? 33) : (panelLayout?.[1] ?? 58)
              }
              minSize={22}
              className='min-h-0 min-w-0 overflow-hidden p-1'
            >
              {monitorLogsList}
            </ResizablePanel>
          </>
        ) : null}

        {showMonitorLogDetails ? (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel
              order={3}
              defaultSize={panelLayout?.[2] ?? 25}
              minSize={20}
              className='min-h-0 min-w-0 overflow-auto p-1'
            >
              <LogDetails
                log={detailedMonitorLog}
                isOpen={Boolean(selectedMonitorLog)}
                onClose={closeMonitorLogDetails}
                onNavigateNext={handleNavigateMonitorLogNext}
                onNavigatePrev={handleNavigateMonitorLogPrev}
                hasNext={selectedMonitorLogIndex < monitorLogs.length - 1}
                hasPrev={selectedMonitorLogIndex > 0}
              />
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>

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
