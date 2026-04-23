'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'
import {
  createMonitorView,
  listMonitorViews,
  updateMonitorView,
} from '@/app/workspace/[workspaceId]/monitor/components/api'
import { MonitorsView } from '@/app/workspace/[workspaceId]/monitor/components/monitors-view'
import type {
  IndicatorMonitorRecord,
  IndicatorOption,
  MonitorDraft,
  MonitorNameDialogMode,
  WorkflowPickerOption,
  WorkflowTargetOption,
} from '@/app/workspace/[workspaceId]/monitor/components/types'
import { bootstrapMonitorViews } from '@/app/workspace/[workspaceId]/monitor/components/view-bootstrap'
import {
  normalizeMonitorViewConfig,
  type MonitorViewConfig,
  type MonitorViewRow,
} from '@/app/workspace/[workspaceId]/monitor/components/view-config'
import {
  resolveMonitorWorkingConfig,
  writeMonitorWorkingState,
} from '@/app/workspace/[workspaceId]/monitor/components/view-preferences'

type MonitorPageProps = {
  workspaceId: string
  userId: string
}

const areConfigsEqual = (left: MonitorViewConfig, right: MonitorViewConfig) =>
  JSON.stringify(left) === JSON.stringify(right)

export function MonitorPage({ workspaceId, userId }: MonitorPageProps) {
  const initialWorkingConfig = useMemo(
    () => resolveMonitorWorkingConfig(workspaceId, userId),
    [userId, workspaceId]
  )
  const [monitors, setMonitors] = useState<IndicatorMonitorRecord[]>([])
  const [monitorsLoading, setMonitorsLoading] = useState(true)
  const [referenceLoading, setReferenceLoading] = useState(true)
  const [monitorsError, setMonitorsError] = useState<string | null>(null)
  const [referenceWarning, setReferenceWarning] = useState<string | null>(null)

  const [indicatorOptions, setIndicatorOptions] = useState<IndicatorOption[]>([])
  const [workflowTargets, setWorkflowTargets] = useState<WorkflowTargetOption[]>([])
  const [workflowOptions, setWorkflowOptions] = useState<WorkflowPickerOption[]>([])

  const [selectedMonitorId, setSelectedMonitorId] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false)
  const [viewRows, setViewRows] = useState<MonitorViewRow[]>([])
  const [activeViewId, setActiveViewId] = useState<string | null>(null)
  const [viewConfig, setViewConfig] = useState<MonitorViewConfig>(initialWorkingConfig)
  const [viewStateMode, setViewStateMode] = useState<'loading' | 'server' | 'error'>('loading')
  const [viewStateReloading, setViewStateReloading] = useState(false)
  const [viewsError, setViewsError] = useState<string | null>(null)

  const [nameDialogMode, setNameDialogMode] = useState<MonitorNameDialogMode | null>(null)
  const [nameDialogValue, setNameDialogValue] = useState('')
  const [nameDialogBusy, setNameDialogBusy] = useState(false)
  const [deletingViewId, setDeletingViewId] = useState<string | null>(null)

  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState<MonitorDraft | null>(null)
  const [editingErrors, setEditingErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [togglingMonitorId, setTogglingMonitorId] = useState<string | null>(null)
  const [deletingMonitorId, setDeletingMonitorId] = useState<string | null>(null)
  const [pendingMonitorDelete, setPendingMonitorDelete] = useState<IndicatorMonitorRecord | null>(
    null
  )
  const viewBootstrapRequestIdRef = useRef(0)
  const viewStateModeRef = useRef<'loading' | 'server' | 'error'>('loading')
  const viewConfigRef = useRef<MonitorViewConfig>(normalizeMonitorViewConfig(initialWorkingConfig))
  const persistedConfig = useMemo(() => normalizeMonitorViewConfig(viewConfig), [viewConfig])

  const setNormalizedViewConfig = useCallback(
    (next: SetStateAction<MonitorViewConfig>) => {
      setViewConfig((current) => {
        const resolved =
          typeof next === 'function'
            ? (next as (value: MonitorViewConfig) => MonitorViewConfig)(current)
            : next
        const normalized = normalizeMonitorViewConfig(resolved)
        viewConfigRef.current = normalized
        return normalized
      })
    },
    []
  )

  useEffect(() => {
    viewConfigRef.current = persistedConfig
  }, [persistedConfig])

  useEffect(() => {
    viewStateModeRef.current = viewStateMode
  }, [viewStateMode])

  const reloadViewState = useCallback(async () => {
    const requestId = ++viewBootstrapRequestIdRef.current
    const isInitialLoad = viewStateModeRef.current === 'loading'

    setViewsError(null)
    if (isInitialLoad) {
      setViewStateMode('loading')
    } else {
      setViewStateReloading(true)
    }

    const result = await bootstrapMonitorViews({
      workspaceId,
      getLocalWorkingConfig: () => viewConfigRef.current,
      listMonitorViews,
      createMonitorView,
    })

    if (viewBootstrapRequestIdRef.current !== requestId) return

    setViewRows(result.viewRows)
    setActiveViewId(result.activeViewId)
    setNormalizedViewConfig(result.viewConfig)
    setViewStateMode(result.viewStateMode)
    setViewsError(result.viewsError)
    setViewStateReloading(false)
  }, [setNormalizedViewConfig, workspaceId])

  useEffect(() => {
    void reloadViewState()

    return () => {
      viewBootstrapRequestIdRef.current += 1
    }
  }, [reloadViewState])
  const activeViewRow = useMemo(
    () => viewRows.find((row) => row.id === activeViewId) ?? null,
    [activeViewId, viewRows]
  )
  const configSignature = JSON.stringify(persistedConfig)

  useEffect(() => {
    if (viewStateMode === 'loading') return

    writeMonitorWorkingState(workspaceId, userId, persistedConfig)
  }, [
    persistedConfig.filters.attentionOnly,
    persistedConfig.filters.workflowId,
    persistedConfig.layout,
    persistedConfig.panelSizes,
    userId,
    viewStateMode,
    workspaceId,
  ])

  useEffect(() => {
    if (viewStateMode !== 'server' || !activeViewId || !activeViewRow) return
    if (areConfigsEqual(normalizeMonitorViewConfig(activeViewRow.config), persistedConfig)) return

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          await updateMonitorView(workspaceId, activeViewId, { config: persistedConfig })
          setViewRows((current) =>
            current.map((row) =>
              row.id === activeViewId
                ? {
                    ...row,
                    config: persistedConfig,
                    updatedAt: new Date().toISOString(),
                  }
                : row
            )
          )
        } catch (error) {
          setViewsError(
            error instanceof Error ? error.message : 'Failed to save monitor view changes'
          )
        }
      })()
    }, 400)

    return () => window.clearTimeout(timeoutId)
  }, [activeViewId, activeViewRow, configSignature, persistedConfig, viewStateMode, workspaceId])

  return (
    <MonitorsView
      workspaceId={workspaceId}
      reloadViewState={reloadViewState}
      state={{
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
      }}
      setters={{
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
        setViewConfig: setNormalizedViewConfig,
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
      }}
    />
  )
}
