'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useListingSelectorStore } from '@/stores/market/selector/store'
import type { ConfigBoardContext } from '../config/config-board-state'
import {
  buildBlankMonitorDraft,
  buildDraftFromMonitorWithPatch,
  buildMonitorCreatePayloadFromDraft,
  buildMonitorUpdatePayloadFromDraft,
  mergeMonitorDraftPatch,
  validateMonitorDraft,
} from '../config/config-draft'
import { resolveConfigBoardContextPatch } from '../config/config-drop'
import type {
  IndicatorMonitorRecord,
  MonitorDraft,
  MonitorRecordActions,
  MonitorReferenceData,
} from '../shared/types'
import { buildDraftFromMonitor, isAuthParamDefinition } from '../shared/utils'
import type { ConfigMonitorViewConfig } from '../view/view-config'

export type MonitorEditorState = ReturnType<typeof useMonitorEditorState>

export function useMonitorEditorState({
  workspaceId,
  monitorRecords,
  referenceData,
  monitorActions,
  viewConfig,
}: {
  workspaceId: string
  monitorRecords: IndicatorMonitorRecord[]
  referenceData: MonitorReferenceData
  monitorActions: MonitorRecordActions
  viewConfig: ConfigMonitorViewConfig
}) {
  const [selectedMonitorId, setSelectedMonitorId] = useState<string | null>(null)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState<MonitorDraft | null>(null)
  const [editingErrors, setEditingErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [togglingMonitorId, setTogglingMonitorId] = useState<string | null>(null)
  const [deletingMonitorId, setDeletingMonitorId] = useState<string | null>(null)
  const [panelError, setPanelError] = useState<string | null>(null)
  const selectionClearedRef = useRef(false)

  const ensureListingSelectorInstance = useListingSelectorStore((state) => state.ensureInstance)
  const resetListingSelectorInstance = useListingSelectorStore((state) => state.resetInstance)
  const updateListingSelectorInstance = useListingSelectorStore((state) => state.updateInstance)

  useEffect(() => {
    if (!selectedMonitorId && monitorRecords.length > 0 && !selectionClearedRef.current) {
      setSelectedMonitorId(monitorRecords[0]!.monitorId)
    }
    if (
      selectedMonitorId &&
      !monitorRecords.some((monitor) => monitor.monitorId === selectedMonitorId)
    ) {
      selectionClearedRef.current = false
      setSelectedMonitorId(monitorRecords[0]?.monitorId ?? null)
    }
    if (monitorRecords.length === 0) {
      selectionClearedRef.current = false
    }
  }, [monitorRecords, selectedMonitorId])

  const selectMonitorId = useCallback((monitorId: string | null) => {
    selectionClearedRef.current = false
    setSelectedMonitorId(monitorId)
  }, [])

  const clearSelection = useCallback(() => {
    selectionClearedRef.current = true
    setSelectedMonitorId(null)
  }, [])

  const selectedMonitor = useMemo(
    () => monitorRecords.find((monitor) => monitor.monitorId === selectedMonitorId) ?? null,
    [monitorRecords, selectedMonitorId]
  )

  const editingIndicatorInputMeta = editingDraft?.indicatorId
    ? referenceData.indicatorById[editingDraft.indicatorId]?.inputMeta
    : undefined

  const editingProviderDefinitions = useMemo(() => {
    if (!editingDraft?.providerId) return []
    return referenceData.providerParamDefinitionsByProviderId[editingDraft.providerId] ?? []
  }, [editingDraft?.providerId, referenceData.providerParamDefinitionsByProviderId])

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
      selectedListingValue: editingDraft.listing,
      selectedListing: editingDraft.listing as any,
    })
  }, [
    editingDraft?.listing,
    editingDraft?.providerId,
    editingListingInstanceId,
    updateListingSelectorInstance,
  ])

  const openDraft = useCallback(
    (key: string | null, draft: MonitorDraft, errors: Record<string, string> = {}) => {
      const instanceId = `indicator-monitor-edit-${key ?? 'new'}`
      ensureListingSelectorInstance(instanceId, {
        providerId: draft.providerId,
        selectedListingValue: draft.listing,
        selectedListing: draft.listing as any,
        query: '',
        results: [],
        error: undefined,
      })
      updateListingSelectorInstance(instanceId, {
        providerId: draft.providerId,
        selectedListingValue: draft.listing,
        selectedListing: draft.listing as any,
      })
      setEditingKey(key)
      setEditingDraft(draft)
      setEditingErrors(errors)
      setPanelError(null)
      setIsEditorOpen(true)
    },
    [ensureListingSelectorInstance, updateListingSelectorInstance]
  )

  const openCreate = useCallback(() => {
    openDraft(null, buildBlankMonitorDraft(referenceData))
  }, [openDraft, referenceData])

  const openEdit = useCallback(
    (monitor: IndicatorMonitorRecord) => {
      selectMonitorId(monitor.monitorId)
      openDraft(monitor.monitorId, buildDraftFromMonitor(monitor))
    },
    [openDraft, selectMonitorId]
  )

  const openCreateFromBoardContext = useCallback(
    (context: ConfigBoardContext) => {
      const resolution = resolveConfigBoardContextPatch({
        decodedContext: context,
        viewConfig,
        referenceData,
      })
      openDraft(
        null,
        { ...buildBlankMonitorDraft(referenceData), ...resolution.draftPatch },
        resolution.errors
      )
    },
    [openDraft, referenceData, viewConfig]
  )

  const openRejectedDropProposal = useCallback(
    (
      monitor: IndicatorMonitorRecord,
      proposal: { draftPatch: Partial<MonitorDraft>; errors: Record<string, string> }
    ) => {
      selectMonitorId(monitor.monitorId)
      openDraft(
        monitor.monitorId,
        buildDraftFromMonitorWithPatch(monitor, proposal.draftPatch, referenceData),
        proposal.errors
      )
    },
    [openDraft, referenceData, selectMonitorId]
  )

  const closeEditor = useCallback(() => {
    if (editingListingInstanceId) {
      resetListingSelectorInstance(editingListingInstanceId)
    }
    setIsEditorOpen(false)
    setEditingKey(null)
    setEditingDraft(null)
    setEditingErrors({})
  }, [editingListingInstanceId, resetListingSelectorInstance])

  const updateDraft = useCallback(
    (patch: Partial<MonitorDraft>) => {
      setEditingDraft((current) => {
        if (!current) return current

        return mergeMonitorDraftPatch({ draft: current, patch, referenceData })
      })
    },
    [referenceData]
  )

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

  const persistDraft = useCallback(async () => {
    if (!editingDraft) return

    const validation = validateMonitorDraft({ draft: editingDraft, referenceData })
    setEditingErrors(validation.errors)
    if (!validation.valid) return

    const sourceMonitor = editingKey
      ? (monitorRecords.find((monitor) => monitor.monitorId === editingKey) ?? null)
      : null
    setSaving(true)
    setPanelError(null)

    try {
      const savedMonitor = sourceMonitor
        ? await monitorActions.updateMonitor(
            sourceMonitor.monitorId,
            buildMonitorUpdatePayloadFromDraft({
              workspaceId,
              draft: editingDraft,
              originalMonitor: sourceMonitor,
              referenceData,
            })
          )
        : await monitorActions.createMonitor(
            buildMonitorCreatePayloadFromDraft({
              workspaceId,
              draft: editingDraft,
              referenceData,
            })
          )

      if (savedMonitor) selectMonitorId(savedMonitor.monitorId)
      closeEditor()
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Failed to save monitor')
    } finally {
      setSaving(false)
    }
  }, [
    editingDraft,
    editingKey,
    monitorActions,
    monitorRecords,
    referenceData,
    closeEditor,
    selectMonitorId,
    workspaceId,
  ])

  const toggleMonitorState = useCallback(
    async (monitor: IndicatorMonitorRecord) => {
      const nextIsActive = !monitor.isActive
      setTogglingMonitorId(monitor.monitorId)
      setPanelError(null)

      try {
        const savedMonitor = await monitorActions.toggleMonitorState(monitor, nextIsActive)
        if (savedMonitor) selectMonitorId(savedMonitor.monitorId)
      } catch (error) {
        setPanelError(error instanceof Error ? error.message : 'Failed to update monitor state')
      } finally {
        setTogglingMonitorId(null)
      }
    },
    [monitorActions, selectMonitorId]
  )

  const removeMonitor = useCallback(
    async (monitorId: string) => {
      setDeletingMonitorId(monitorId)
      setPanelError(null)

      try {
        await monitorActions.deleteMonitor(monitorId)
        if (selectedMonitorId === monitorId) {
          selectMonitorId(
            monitorRecords.find((monitor) => monitor.monitorId !== monitorId)?.monitorId ?? null
          )
        }
        closeEditor()
      } catch (error) {
        setPanelError(error instanceof Error ? error.message : 'Failed to delete monitor')
      } finally {
        setDeletingMonitorId(null)
      }
    },
    [closeEditor, monitorActions, monitorRecords, selectMonitorId, selectedMonitorId]
  )

  return {
    selectedMonitorId,
    selectedMonitor,
    isEditorOpen,
    editingKey,
    editingDraft,
    editingErrors,
    saving,
    togglingMonitorId,
    deletingMonitorId,
    panelError,
    editingIndicatorInputMeta,
    editingSecretDefinitions,
    editingNonSecretDefinitions,
    editingListingInstanceId,
    setSelectedMonitorId: selectMonitorId,
    clearSelection,
    openCreate,
    openEdit,
    openCreateFromBoardContext,
    openRejectedDropProposal,
    closeEditor,
    updateDraft,
    updateSecretValue,
    updateProviderParamValue,
    updateIndicatorInputs: (nextInputs: Record<string, unknown>) =>
      updateDraft({ indicatorInputs: nextInputs }),
    persistDraft,
    toggleMonitorState,
    removeMonitor,
  }
}
