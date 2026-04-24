'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useListingSelectorStore } from '@/stores/market/selector/store'
import {
  getMarketLiveCapabilities,
  getMarketProviderOptionsByKind,
  getMarketProviderParamDefinitions,
  getMarketSeriesCapabilities,
} from '@/providers/market/providers'
import {
  type IndicatorMonitorMutationInput,
  type IndicatorMonitorRecord,
  type IndicatorOption,
  type MonitorDraft,
  type StreamingProviderOption,
  type WorkflowPickerOption,
  type WorkflowTargetOption,
} from '../shared/types'
import { MonitorEditorModal } from './monitor-editor-modal'
import { buildDefaultDraft, buildDraftFromMonitor, isAuthParamDefinition } from '../shared/utils'

type MonitorManagementPaneProps = {
  workspaceId: string
  monitors: IndicatorMonitorRecord[]
  monitorsLoading: boolean
  monitorsError: string | null
  referenceLoading: boolean
  referenceWarning: string | null
  indicatorOptions: IndicatorOption[]
  workflowTargets: WorkflowTargetOption[]
  workflowOptions: WorkflowPickerOption[]
  onCreateMonitor: (input: IndicatorMonitorMutationInput) => Promise<IndicatorMonitorRecord | null>
  onUpdateMonitor: (
    monitorId: string,
    input: IndicatorMonitorMutationInput
  ) => Promise<IndicatorMonitorRecord | null>
  onToggleMonitorState: (
    monitor: IndicatorMonitorRecord,
    nextIsActive: boolean
  ) => Promise<IndicatorMonitorRecord | null>
  onDeleteMonitor: (monitorId: string) => Promise<void>
}

export function MonitorManagementPane({
  workspaceId,
  monitors,
  monitorsLoading,
  monitorsError,
  referenceLoading,
  referenceWarning,
  indicatorOptions,
  workflowTargets,
  workflowOptions,
  onCreateMonitor,
  onUpdateMonitor,
  onToggleMonitorState,
  onDeleteMonitor,
}: MonitorManagementPaneProps) {
  const [selectedMonitorId, setSelectedMonitorId] = useState<string | null>(null)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState<MonitorDraft | null>(null)
  const [editingErrors, setEditingErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [togglingMonitorId, setTogglingMonitorId] = useState<string | null>(null)
  const [deletingMonitorId, setDeletingMonitorId] = useState<string | null>(null)

  const ensureListingSelectorInstance = useListingSelectorStore((state) => state.ensureInstance)
  const updateListingSelectorInstance = useListingSelectorStore((state) => state.updateInstance)

  useEffect(() => {
    if (!selectedMonitorId && monitors.length > 0) {
      setSelectedMonitorId(monitors[0]!.monitorId)
    }
    if (selectedMonitorId && !monitors.some((monitor) => monitor.monitorId === selectedMonitorId)) {
      setSelectedMonitorId(monitors[0]?.monitorId ?? null)
    }
  }, [monitors, selectedMonitorId])

  const selectedMonitor = useMemo(
    () => monitors.find((monitor) => monitor.monitorId === selectedMonitorId) ?? null,
    [monitors, selectedMonitorId]
  )

  const streamingProviders = useMemo<StreamingProviderOption[]>(
    () =>
      getMarketProviderOptionsByKind('live').filter((option) =>
        Boolean(getMarketLiveCapabilities(option.id)?.supportsStreaming)
      ),
    []
  )

  const addMonitorDisabledReason = useMemo(() => {
    if (referenceLoading) return 'Loading monitor requirements...'
    if (workflowTargets.length > 0 && indicatorOptions.length > 0) return null
    return 'No deployed workflow with indicator trigger is available, or no trigger-capable indicator exists.'
  }, [indicatorOptions.length, referenceLoading, workflowTargets.length])

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

  const openCreate = useCallback(() => {
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

  const openEdit = useCallback(
    (monitor: IndicatorMonitorRecord) => {
      const instanceId = `indicator-monitor-edit-${monitor.monitorId}`
      ensureListingSelectorInstance(instanceId, {
        providerId: monitor.providerConfig.monitor.providerId,
        selectedListingValue: monitor.providerConfig.monitor.listing,
        selectedListing: monitor.providerConfig.monitor.listing as any,
        query: '',
        results: [],
        error: undefined,
      })
      updateListingSelectorInstance(instanceId, {
        providerId: monitor.providerConfig.monitor.providerId,
        selectedListingValue: monitor.providerConfig.monitor.listing,
        selectedListing: monitor.providerConfig.monitor.listing as any,
      })
      setEditingKey(monitor.monitorId)
      setEditingDraft(buildDraftFromMonitor(monitor))
      setEditingErrors({})
      setIsEditorOpen(true)
    },
    [ensureListingSelectorInstance, updateListingSelectorInstance]
  )

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
  }, [editingDraft, editingNonSecretDefinitions, editingSecretDefinitions])

  const persistDraft = useCallback(async () => {
    if (!editingDraft) return

    const validation = validateDraft()
    setEditingErrors(validation.errors)
    if (!validation.valid) return
    if (!editingDraft.listing) return

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
      auth: {
        secrets: Object.fromEntries(
          Object.entries(editingDraft.secretValues).map(([key, value]) => [key, value.trim()])
        ),
      },
      ...(Object.keys(providerParams).length > 0 ? { providerParams } : {}),
      isActive: editingDraft.isActive,
    } satisfies IndicatorMonitorMutationInput

    setSaving(true)

    try {
      const savedMonitor = editingKey
        ? await onUpdateMonitor(editingKey, payload)
        : await onCreateMonitor(payload)

      if (savedMonitor) {
        setSelectedMonitorId(savedMonitor.monitorId)
      }

      setIsEditorOpen(false)
      setEditingKey(null)
      setEditingDraft(null)
      setEditingErrors({})
    } catch {
      return
    } finally {
      setSaving(false)
    }
  }, [editingDraft, editingKey, editingNonSecretDefinitions, onCreateMonitor, onUpdateMonitor, validateDraft, workspaceId])

  const toggleMonitorState = useCallback(
    async (monitor: IndicatorMonitorRecord) => {
      const nextIsActive = !monitor.isActive

      setTogglingMonitorId(monitor.monitorId)

      try {
        const savedMonitor = await onToggleMonitorState(monitor, nextIsActive)
        if (savedMonitor) {
          setSelectedMonitorId(savedMonitor.monitorId)
        }
      } catch {
        return
      } finally {
        setTogglingMonitorId(null)
      }
    },
    [onToggleMonitorState]
  )

  const removeMonitor = useCallback(
    async (monitorId: string) => {
      setDeletingMonitorId(monitorId)

      try {
        await onDeleteMonitor(monitorId)
        if (selectedMonitorId === monitorId) {
          setSelectedMonitorId(monitors.find((monitor) => monitor.monitorId !== monitorId)?.monitorId ?? null)
        }
      } catch {
        return
      } finally {
        setDeletingMonitorId(null)
      }
    },
    [monitors, onDeleteMonitor, selectedMonitorId]
  )

  return (
    <>
      <div className='flex h-full max-h-full min-h-0 min-w-0 flex-col overflow-hidden p-1.5'>
        <div className='flex h-full max-h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card'>
          <div className='shrink-0 border-b px-4 py-3'>
            <div className='flex items-center justify-between gap-3'>
              <div>
                <h2 className='font-medium text-sm'>Monitors</h2>
                <p className='text-muted-foreground text-xs'>Manage live monitor configs</p>
              </div>
              <Button size='sm' onClick={openCreate} disabled={Boolean(addMonitorDisabledReason)}>
                <Plus className='mr-1 h-4 w-4' />
                Create
              </Button>
            </div>
            {addMonitorDisabledReason ? (
              <p className='mt-2 text-muted-foreground text-xs'>{addMonitorDisabledReason}</p>
            ) : null}
            {referenceWarning ? <p className='mt-2 text-amber-600 text-xs'>{referenceWarning}</p> : null}
            {monitorsError ? <p className='mt-2 text-destructive text-xs'>{monitorsError}</p> : null}
          </div>

          <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
            <ScrollArea className='min-h-0 flex-1'>
              <div className='space-y-2 p-3'>
                {monitorsLoading ? (
                  <div className='flex items-center gap-2 text-muted-foreground text-sm'>
                    <Loader2 className='h-4 w-4 animate-spin' />
                    Loading monitors…
                  </div>
                ) : monitors.length === 0 ? (
                  <div className='px-4 py-6 text-center text-muted-foreground text-sm'>
                    No monitors configured yet.
                  </div>
                ) : (
                  monitors.map((monitor) => (
                    <button
                      key={monitor.monitorId}
                      type='button'
                      className={`w-full rounded-lg border px-3 py-3 text-left ${selectedMonitorId === monitor.monitorId ? 'border-primary bg-primary/5' : 'bg-card/50'
                        }`}
                      onClick={() => setSelectedMonitorId(monitor.monitorId)}
                    >
                      <div className='flex items-start justify-between gap-3'>
                        <div className='min-w-0'>
                          <div className='truncate font-medium text-sm'>{monitor.providerConfig.monitor.indicatorId}</div>
                          <div className='truncate text-muted-foreground text-xs'>
                            {monitor.providerConfig.monitor.providerId} · {monitor.providerConfig.monitor.interval}
                          </div>
                        </div>
                        <span className='rounded bg-secondary px-2 py-0.5 text-[10px] uppercase'>
                          {monitor.isActive ? 'Active' : 'Paused'}
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>

            {selectedMonitor ? (
              <div className='shrink-0 border-t p-3'>
                <div className='space-y-1'>
                  <div className='font-medium text-sm'>{selectedMonitor.monitorId}</div>
                  <div className='text-muted-foreground text-xs'>{selectedMonitor.workflowId}</div>
                </div>
                <div className='mt-3 grid grid-cols-2 gap-2'>
                  <Button variant='outline' size='sm' onClick={() => openEdit(selectedMonitor)}>
                    <Pencil className='mr-1 h-4 w-4' />
                    Edit
                  </Button>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => void toggleMonitorState(selectedMonitor)}
                    disabled={togglingMonitorId === selectedMonitor.monitorId}
                  >
                    {selectedMonitor.isActive ? (
                      <Pause className='mr-1 h-4 w-4' />
                    ) : (
                      <Play className='mr-1 h-4 w-4' />
                    )}
                    {selectedMonitor.isActive ? 'Pause' : 'Resume'}
                  </Button>
                  <Button
                    variant='destructive'
                    size='sm'
                    className='col-span-2'
                    onClick={() => void removeMonitor(selectedMonitor.monitorId)}
                    disabled={deletingMonitorId === selectedMonitor.monitorId}
                  >
                    <Trash2 className='mr-1 h-4 w-4' />
                    Delete
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <MonitorEditorModal
        open={isEditorOpen}
        editingKey={editingKey}
        draft={editingDraft}
        errors={editingErrors}
        saving={saving}
        streamingProviders={streamingProviders}
        providerIntervals={editingDraft ? getMarketSeriesCapabilities(editingDraft.providerId)?.intervals ?? [] : []}
        workflowTargets={workflowTargets}
        workflowPickerOptions={workflowOptions}
        indicatorPickerOptions={indicatorOptions}
        nonSecretDefinitions={editingNonSecretDefinitions}
        secretDefinitions={editingSecretDefinitions}
        listingInstanceId={editingListingInstanceId}
        workspaceId={workspaceId}
        onOpenChange={(open) => {
          if (!open) {
            setIsEditorOpen(false)
            setEditingDraft(null)
          }
        }}
        onCancel={() => {
          setIsEditorOpen(false)
          setEditingDraft(null)
        }}
        onSave={() => void persistDraft()}
        onUpdateDraft={(patch) =>
          setEditingDraft((current) => (current ? { ...current, ...patch } : current))
        }
        onUpdateSecretValue={(fieldId, value) =>
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
        }
        onUpdateProviderParamValue={(fieldId, value) =>
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
        }
      />
    </>
  )
}
