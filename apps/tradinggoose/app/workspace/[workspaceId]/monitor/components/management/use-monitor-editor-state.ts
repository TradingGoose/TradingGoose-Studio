'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { areListingIdentitiesEqual } from '@/lib/listing/identity'
import { INDICATOR_MONITOR_PROVIDER } from '@/lib/monitors/sources'
import { useListingSelectorStore } from '@/stores/market/selector/store'
import type { ConfigBoardContext } from '../config/config-board-state'
import {
  buildBlankMonitorDraft,
  buildDraftFromMonitorWithPatch,
  buildMonitorCreatePayloadFromDraft,
  buildMonitorUpdatePayloadFromDraft,
  type MonitorDraftIssues,
  mergeMonitorDraftPatch,
  validateMonitorDraft,
} from '../config/config-draft'
import { resolveConfigBoardContextPatch } from '../config/config-drop'
import type {
  MonitorDraft,
  MonitorRecord,
  MonitorRecordActions,
  MonitorReferenceData,
} from '../shared/types'
import { buildDraftFromMonitor, isAuthParamDefinition } from '../shared/utils'
import type { ConfigMonitorViewConfig } from '../view/view-config'

export type MonitorEditorState = ReturnType<typeof useMonitorEditorState>

const mergeIssues = (...groups: MonitorDraftIssues[]) => {
  const merged: MonitorDraftIssues = {}
  for (const group of groups) {
    for (const [key, messages] of Object.entries(group)) {
      merged[key] = Array.from(new Set([...(merged[key] ?? []), ...messages]))
    }
  }
  return merged
}

export function useMonitorEditorState({
  workspaceId,
  monitorRecords,
  referenceData,
  monitorActions,
  viewConfig,
  onClearOperationMessage,
}: {
  workspaceId: string
  monitorRecords: MonitorRecord[]
  referenceData: MonitorReferenceData
  monitorActions: MonitorRecordActions
  viewConfig: ConfigMonitorViewConfig
  onClearOperationMessage: () => void
}) {
  const [selectedMonitorId, setSelectedMonitorId] = useState<string | null>(null)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState<MonitorDraft | null>(null)
  const [showValidationIssues, setShowValidationIssues] = useState(false)
  const [editingProposalIssues, setEditingProposalIssues] = useState<MonitorDraftIssues>({})
  const [saving, setSaving] = useState(false)
  const [togglingMonitorId, setTogglingMonitorId] = useState<string | null>(null)
  const [deletingMonitorId, setDeletingMonitorId] = useState<string | null>(null)

  const ensureListingSelectorInstance = useListingSelectorStore((state) => state.ensureInstance)
  const resetListingSelectorInstance = useListingSelectorStore((state) => state.resetInstance)
  const updateListingSelectorInstance = useListingSelectorStore((state) => state.updateInstance)

  useEffect(() => {
    if (
      selectedMonitorId &&
      !monitorRecords.some((monitor) => monitor.monitorId === selectedMonitorId)
    ) {
      setSelectedMonitorId(null)
    }
  }, [monitorRecords, selectedMonitorId])

  const selectMonitorId = useCallback(
    (monitorId: string | null) => {
      onClearOperationMessage()
      setSelectedMonitorId(monitorId)
    },
    [onClearOperationMessage]
  )

  const clearSelection = useCallback(() => {
    selectMonitorId(null)
  }, [selectMonitorId])

  const selectedMonitor = useMemo(
    () => monitorRecords.find((monitor) => monitor.monitorId === selectedMonitorId) ?? null,
    [monitorRecords, selectedMonitorId]
  )
  const editingValidation = useMemo(
    () =>
      editingDraft
        ? validateMonitorDraft({ draft: editingDraft, referenceData })
        : { valid: true, issues: {} },
    [editingDraft, referenceData]
  )
  const editingIssues = useMemo(
    () => mergeIssues(editingProposalIssues, showValidationIssues ? editingValidation.issues : {}),
    [editingProposalIssues, editingValidation.issues, showValidationIssues]
  )

  const editingIndicatorInputMeta = editingDraft?.indicatorId
    ? referenceData.indicatorById[editingDraft.indicatorId]?.inputMeta
    : undefined

  const editingProviderDefinitions = useMemo(() => {
    if (!editingDraft?.providerId) return []
    return referenceData.providerParamDefinitionsByProviderId[editingDraft.providerId] ?? []
  }, [editingDraft?.providerId, referenceData.providerParamDefinitionsByProviderId])

  const [editingSecretDefinitions, editingNonSecretDefinitions] = useMemo(() => {
    const definitions = editingProviderDefinitions.filter(
      (definition) =>
        definition.required &&
        definition.visibility !== 'hidden' &&
        definition.visibility !== 'llm-only'
    )
    return [
      definitions.filter(isAuthParamDefinition),
      definitions.filter((definition) => !isAuthParamDefinition(definition)),
    ]
  }, [editingProviderDefinitions])

  const editingListingInstanceId =
    isEditorOpen && editingDraft?.source === INDICATOR_MONITOR_PROVIDER
      ? `monitor-edit-${editingKey ?? 'new'}`
      : null

  useEffect(() => {
    if (
      editingDraft?.source !== INDICATOR_MONITOR_PROVIDER ||
      !editingDraft.providerId ||
      !editingListingInstanceId
    ) {
      return
    }
    updateListingSelectorInstance(editingListingInstanceId, {
      providerId: editingDraft.providerId,
      selectedListingValue: editingDraft.listing,
      selectedListing: editingDraft.listing as any,
    })
  }, [
    editingDraft?.listing,
    editingDraft?.providerId,
    editingDraft?.source,
    editingListingInstanceId,
    updateListingSelectorInstance,
  ])

  const openDraft = useCallback(
    (
      key: string | null,
      draft: MonitorDraft,
      proposalIssues: MonitorDraftIssues = {},
      showCurrentValidation = false
    ) => {
      if (draft.source === INDICATOR_MONITOR_PROVIDER) {
        const instanceId = `monitor-edit-${key ?? 'new'}`
        ensureListingSelectorInstance(instanceId, {
          providerId: draft.providerId,
          selectedListingValue: draft.listing,
          selectedListing: draft.listing as any,
          query: '',
          results: [],
          error: undefined,
        })
      }
      setEditingKey(key)
      setEditingDraft(draft)
      setShowValidationIssues(showCurrentValidation)
      setEditingProposalIssues(proposalIssues)
      onClearOperationMessage()
      setIsEditorOpen(true)
    },
    [ensureListingSelectorInstance, onClearOperationMessage]
  )

  const openEdit = useCallback(
    (monitor: MonitorRecord) => {
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
        resolution.issues
      )
    },
    [openDraft, referenceData, viewConfig]
  )

  const openRejectedDropProposal = useCallback(
    (
      monitor: MonitorRecord,
      proposal: {
        draftPatch: Partial<MonitorDraft>
        proposalIssues?: MonitorDraftIssues
        showValidationIssues?: boolean
      }
    ) => {
      selectMonitorId(monitor.monitorId)
      openDraft(
        monitor.monitorId,
        buildDraftFromMonitorWithPatch(monitor, proposal.draftPatch, referenceData),
        proposal.proposalIssues,
        proposal.showValidationIssues
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
    setShowValidationIssues(false)
    setEditingProposalIssues({})
    onClearOperationMessage()
  }, [editingListingInstanceId, onClearOperationMessage, resetListingSelectorInstance])

  const updateDraft = useCallback(
    (patch: Partial<MonitorDraft>) => {
      if (!editingDraft) return
      const nextDraft = mergeMonitorDraftPatch({ draft: editingDraft, patch, referenceData })
      const resolvedKeys = new Set<string>()
      if (
        nextDraft.workflowId !== editingDraft.workflowId ||
        nextDraft.blockId !== editingDraft.blockId
      ) {
        resolvedKeys.add('workflowTarget')
      }
      if (nextDraft.providerId !== editingDraft.providerId) {
        resolvedKeys.add('providerId')
      }
      if (nextDraft.indicatorId !== editingDraft.indicatorId) resolvedKeys.add('indicatorId')
      if (
        nextDraft.listing !== editingDraft.listing &&
        !areListingIdentitiesEqual(nextDraft.listing, editingDraft.listing)
      ) {
        resolvedKeys.add('listing')
      }
      if (nextDraft.interval !== editingDraft.interval) resolvedKeys.add('interval')
      if (
        nextDraft.serviceId !== editingDraft.serviceId ||
        nextDraft.credentialId !== editingDraft.credentialId ||
        nextDraft.accountId !== editingDraft.accountId
      ) {
        resolvedKeys.add('tradingAccount')
      }

      setEditingDraft(nextDraft)
      if (nextDraft.source !== editingDraft.source) {
        setEditingProposalIssues({})
      } else if (resolvedKeys.size > 0) {
        setEditingProposalIssues((current) =>
          Object.fromEntries(Object.entries(current).filter(([key]) => !resolvedKeys.has(key)))
        )
      }
    },
    [editingDraft, referenceData]
  )

  const updateSecretValue = useCallback(
    (fieldId: string, value: string) =>
      updateDraft({ secretValues: { ...editingDraft?.secretValues, [fieldId]: value } }),
    [editingDraft?.secretValues, updateDraft]
  )

  const updateProviderParamValue = useCallback(
    (fieldId: string, value: string) =>
      updateDraft({
        providerParamValues: { ...editingDraft?.providerParamValues, [fieldId]: value },
      }),
    [editingDraft?.providerParamValues, updateDraft]
  )

  const persistDraft = useCallback(async () => {
    if (!editingDraft) return

    setShowValidationIssues(true)
    if (!editingValidation.valid || Object.keys(editingProposalIssues).length > 0) return

    const sourceMonitor = editingKey
      ? (monitorRecords.find((monitor) => monitor.monitorId === editingKey) ?? null)
      : null
    setSaving(true)

    try {
      const savedMonitor = sourceMonitor
        ? await monitorActions.updateMonitor(
            sourceMonitor.monitorId,
            buildMonitorUpdatePayloadFromDraft({
              workspaceId,
              draft: editingDraft,
              originalMonitor: sourceMonitor,
            })
          )
        : await monitorActions.createMonitor(
            buildMonitorCreatePayloadFromDraft({
              workspaceId,
              draft: editingDraft,
            })
          )

      if (savedMonitor) selectMonitorId(savedMonitor.monitorId)
      closeEditor()
    } catch {
      return
    } finally {
      setSaving(false)
    }
  }, [
    editingDraft,
    editingProposalIssues,
    editingValidation.valid,
    editingKey,
    monitorActions,
    monitorRecords,
    closeEditor,
    selectMonitorId,
    workspaceId,
  ])

  const toggleMonitorState = useCallback(
    async (monitor: MonitorRecord) => {
      const nextIsActive = !monitor.isActive
      setTogglingMonitorId(monitor.monitorId)

      try {
        const savedMonitor = await monitorActions.toggleMonitorState(monitor, nextIsActive)
        if (savedMonitor) selectMonitorId(savedMonitor.monitorId)
      } catch {
        return
      } finally {
        setTogglingMonitorId(null)
      }
    },
    [monitorActions, selectMonitorId]
  )

  const removeMonitor = useCallback(
    async (monitorId: string) => {
      setDeletingMonitorId(monitorId)

      try {
        await monitorActions.deleteMonitor(monitorId)
        if (selectedMonitorId === monitorId) {
          selectMonitorId(null)
        }
        closeEditor()
      } catch {
        return
      } finally {
        setDeletingMonitorId(null)
      }
    },
    [closeEditor, monitorActions, selectMonitorId, selectedMonitorId]
  )

  return {
    selectedMonitorId,
    selectedMonitor,
    isEditorOpen,
    editingKey,
    editingDraft,
    editingIssues,
    saving,
    togglingMonitorId,
    deletingMonitorId,
    editingIndicatorInputMeta,
    editingSecretDefinitions,
    editingNonSecretDefinitions,
    editingListingInstanceId,
    setSelectedMonitorId: selectMonitorId,
    clearSelection,
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
