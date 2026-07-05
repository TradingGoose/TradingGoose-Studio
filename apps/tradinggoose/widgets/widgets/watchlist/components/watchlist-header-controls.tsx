'use client'

import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { MarketProviderControls } from '@/components/market-selector/provider-controls'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  widgetHeaderButtonGroupClassName,
  widgetHeaderIconButtonClassName,
} from '@/components/widget-header-control'
import { useMessages } from 'next-intl'
import { formatTemplate } from '@/i18n/utils'
import { type ListingOption, toListingValue } from '@/lib/listing/identity'
import { exportWatchlistAsJson, WATCHLIST_EXPORT_SOURCE } from '@/lib/watchlists/import-export'
import type { WatchlistRecord } from '@/lib/watchlists/types'
import { saveSavedEntityField, useEntityList } from '@/lib/yjs/use-entity-fields'
import { type EntityListMember } from '@/lib/yjs/entity-session'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import { useListingSelectorStore } from '@/stores/market/selector/store'
import type { WidgetInstance } from '@/widgets/layout'
import type { PairColor } from '@/widgets/pair-colors'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { emitWatchlistParamsChange } from '@/widgets/utils/watchlist-params'
import { emitWatchlistSelectionChange } from '@/widgets/utils/watchlist-selection'
import { useWatchlistYjsDocument } from '@/widgets/utils/watchlist-yjs'
import { WidgetHeaderRefreshButton } from '@/widgets/widgets/components/widget-header-refresh-button'
import { DataChartListingSelector } from '@/widgets/widgets/data_chart/components/listing-control'
import {
  providerOptions,
  resolveSeriesMarketProviderId,
} from '@/widgets/widgets/data_chart/options'
import { WatchlistListActionsButton } from '@/widgets/widgets/watchlist/components/watchlist-list-actions-button'
import { WatchlistListSelector } from '@/widgets/widgets/watchlist/components/watchlist-list-selector'
import type { WatchlistWidgetParams } from '@/widgets/widgets/watchlist/types'

type WatchlistHeaderControlsSlotProps = {
  workspaceId?: string
  panelId?: string
  widget?: WidgetInstance | null
}

const resolveProviderId = (params: WatchlistWidgetParams | null | undefined) => {
  return resolveSeriesMarketProviderId(params?.provider, providerOptions)
}

const toEpochMs = (value?: string | null) => {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const resolveWatchlistParams = (widget?: WidgetInstance | null): WatchlistWidgetParams | null => {
  return widget?.params && typeof widget.params === 'object'
    ? (widget.params as WatchlistWidgetParams)
    : null
}

const resolvePairColor = (widget?: WidgetInstance | null): PairColor =>
  ((widget?.pairColor ?? 'gray') as PairColor) ?? 'gray'

const resolveHeaderSelectedWatchlistId = ({
  params,
  pairColor,
  pairWatchlistId,
}: {
  params: WatchlistWidgetParams | null
  pairColor: PairColor
  pairWatchlistId?: string | null
}) => {
  if (pairColor !== 'gray') return pairWatchlistId ?? null
  const raw = params?.watchlistId
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : null
}

const buildWatchlistHeaderListingSelectorId = (panelId: string | undefined, widgetKey: string) =>
  `watchlist-header-listing-${panelId ?? 'panel'}-${widgetKey}`

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const resolveNextWatchlistName = (
  watchlists: Array<{ name: string }>,
  baseName = 'Watchlist'
) => {
  const usedNumbers = new Set<number>()

  for (const watchlist of watchlists) {
    const match = watchlist.name
      .trim()
      .match(new RegExp(`^${escapeRegExp(baseName)}\\s+(\\d+)$`, 'i'))
    if (!match) continue

    const value = Number.parseInt(match[1] ?? '', 10)
    if (Number.isInteger(value) && value > 0) {
      usedNumbers.add(value)
    }
  }

  let nextNumber = 1
  while (usedNumbers.has(nextNumber)) {
    nextNumber += 1
  }

  return `${baseName} ${nextNumber}`
}

export const resolveNextSectionName = (
  watchlist: Pick<WatchlistRecord, 'items'> | null | undefined,
  baseName = 'Section'
) => {
  const usedNumbers = new Set<number>()

  for (const item of watchlist?.items ?? []) {
    if (item.type !== 'section') continue

    const match = item.label.trim().match(new RegExp(`^${escapeRegExp(baseName)}\\s+(\\d+)$`, 'i'))
    if (!match) continue

    const value = Number.parseInt(match[1] ?? '', 10)
    if (Number.isInteger(value) && value > 0) {
      usedNumbers.add(value)
    }
  }

  let nextNumber = 1
  while (usedNumbers.has(nextNumber)) {
    nextNumber += 1
  }

  return `${baseName} ${nextNumber}`
}

const useWatchlistSelection = (
  workspaceId?: string,
  selectedWatchlistId?: string | null,
  selectFirstWhenUnspecified = true
) => {
  const { members } = useEntityList('watchlist', workspaceId)
  const selectedMember = useMemo(() => {
    if (selectedWatchlistId) {
      return members.find((entry) => entry.entityId === selectedWatchlistId) ?? null
    }
    return selectFirstWhenUnspecified ? (members[0] ?? null) : null
  }, [members, selectedWatchlistId, selectFirstWhenUnspecified])

  return {
    watchlists: members,
    selectedMember,
  }
}

export const WatchlistHeaderLeftControls = ({
  workspaceId,
  panelId,
  widget,
}: WatchlistHeaderControlsSlotProps) => {
  const widgetKey = widget?.key ?? 'watchlist'
  const params = resolveWatchlistParams(widget)
  const providerId = resolveProviderId(params)

  const handleProviderChange = (nextProvider: string) => {
    if (!nextProvider || nextProvider === providerId) return
    emitWatchlistParamsChange({
      params: {
        provider: nextProvider,
      },
      panelId,
      widgetKey,
    })
  }

  const handleSaveProviderSettings = ({
    providerParams,
    auth,
  }: {
    providerParams?: Record<string, unknown>
    auth?: Record<string, unknown>
  }) => {
    emitWatchlistParamsChange({
      params: {
        providerParams,
        auth: auth as WatchlistWidgetParams['auth'],
        runtime: {
          refreshAt: Date.now(),
        },
      },
      panelId,
      widgetKey,
    })
  }

  return (
    <MarketProviderControls
      className='min-w-0'
      value={providerId}
      options={providerOptions}
      onChange={handleProviderChange}
      disabled={!workspaceId}
      providerParams={params?.providerParams}
      authParams={params?.auth}
      workspaceId={workspaceId}
      onSettingsSave={handleSaveProviderSettings}
    />
  )
}

export const WatchlistHeaderCenterControls = ({
  workspaceId,
  panelId,
  widget,
}: WatchlistHeaderControlsSlotProps) => {
  const copy = useMessages().workspace.widgets.watchlist.header
  const widgetKey = widget?.key ?? 'watchlist'
  const params = resolveWatchlistParams(widget)
  const providerId = resolveProviderId(params)
  const pairColor = resolvePairColor(widget)
  const pairContext = usePairColorContext(pairColor)
  const selectedWatchlistId = resolveHeaderSelectedWatchlistId({
    params,
    pairColor,
    pairWatchlistId: pairContext.watchlistId,
  })
  const { selectedMember } = useWatchlistSelection(
    workspaceId,
    selectedWatchlistId,
    pairColor === 'gray'
  )
  const selectedDocument = useWatchlistYjsDocument({
    workspaceId,
    watchlistId: selectedMember?.entityId,
    member: selectedMember,
  })
  const selectedWatchlist = selectedDocument.record
  const selectorInstanceId = useMemo(
    () => buildWatchlistHeaderListingSelectorId(panelId, widgetKey),
    [panelId, widgetKey]
  )
  const ensureSelectorInstance = useListingSelectorStore((state) => state.ensureInstance)
  const updateSelectorInstance = useListingSelectorStore((state) => state.updateInstance)
  const selectorInstance = useListingSelectorStore((state) => state.instances[selectorInstanceId])
  const [isAddingListing, setIsAddingListing] = useState(false)
  const pendingListing = selectorInstance?.selectedListingValue ?? null
  const selectorProviderId = workspaceId && selectedWatchlist ? providerId : undefined

  const clearPendingListing = useCallback(
    (nextProviderId = providerId) => {
      updateSelectorInstance(selectorInstanceId, {
        providerId: nextProviderId || undefined,
        query: '',
        results: [],
        isLoading: false,
        error: undefined,
        selectedListingValue: null,
        selectedListing: null,
      })
    },
    [providerId, selectorInstanceId, updateSelectorInstance]
  )

  useEffect(() => {
    ensureSelectorInstance(selectorInstanceId, { providerId: providerId || undefined })
  }, [ensureSelectorInstance, providerId, selectorInstanceId])

  const previousProviderIdRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const previousProviderId = previousProviderIdRef.current
    const normalizedProviderId = providerId || undefined
    if (previousProviderId !== undefined && previousProviderId !== normalizedProviderId) {
      clearPendingListing(normalizedProviderId)
    } else {
      updateSelectorInstance(selectorInstanceId, { providerId: normalizedProviderId })
    }
    previousProviderIdRef.current = normalizedProviderId
  }, [clearPendingListing, providerId, selectorInstanceId, updateSelectorInstance])

  const previousWatchlistIdRef = useRef<string | null>(null)
  useEffect(() => {
    const nextWatchlistId = selectedWatchlist?.id ?? null
    if (previousWatchlistIdRef.current !== nextWatchlistId) {
      clearPendingListing()
    }
    previousWatchlistIdRef.current = nextWatchlistId
  }, [clearPendingListing, selectedWatchlist?.id])

  const handleListingChange = (listing: ListingOption | null) => {
    updateSelectorInstance(selectorInstanceId, {
      selectedListingValue: toListingValue(listing),
      selectedListing: listing,
    })
  }

  const handleAddListing = async () => {
    if (!workspaceId || !selectedWatchlist || !pendingListing || isAddingListing) {
      return
    }

    try {
      setIsAddingListing(true)
      const item = {
        id: crypto.randomUUID(),
        type: 'listing' as const,
        listing: pendingListing,
      }
      const firstSectionIndex = selectedDocument.items.findIndex((entry) => entry.type === 'section')
      const nextItems =
        firstSectionIndex === -1
          ? [...selectedDocument.items, item]
          : [
              ...selectedDocument.items.slice(0, firstSectionIndex),
              item,
              ...selectedDocument.items.slice(firstSectionIndex),
            ]
      selectedDocument.setItems(nextItems)
      await selectedDocument.save()
      clearPendingListing()
    } catch {
      // Save errors leave the selector state intact so the user can retry.
    } finally {
      setIsAddingListing(false)
    }
  }

  const addListingDisabled =
    !workspaceId || !providerId || !selectedWatchlist || !pendingListing || isAddingListing

  return (
    <div className={widgetHeaderButtonGroupClassName('min-w-0')}>
      <DataChartListingSelector
        instanceId={selectorInstanceId}
        providerId={selectorProviderId}
        onListingChange={handleListingChange}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='inline-flex'>
            <button
              type='button'
              className={widgetHeaderIconButtonClassName()}
              onClick={() => {
                void handleAddListing()
              }}
              disabled={addListingDisabled}
            >
              <Check className='h-3.5 w-3.5' />
              <span className='sr-only'>{copy.addListingAriaLabel}</span>
            </button>
          </span>
        </TooltipTrigger>
        <TooltipContent side='top'>{copy.addListingTooltip}</TooltipContent>
      </Tooltip>
    </div>
  )
}

export const WatchlistHeaderRightControls = ({
  workspaceId,
  panelId,
  widget,
}: WatchlistHeaderControlsSlotProps) => {
  const copy = useMessages().workspace.widgets.watchlist
  const [listActionsOpen, setListActionsOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const widgetKey = widget?.key ?? 'watchlist'
  const params = resolveWatchlistParams(widget)
  const providerId = resolveProviderId(params)
  const pairColor = resolvePairColor(widget)
  const pairContext = usePairColorContext(pairColor)
  const setPairContext = useSetPairColorContext()
  const selectedWatchlistId = resolveHeaderSelectedWatchlistId({
    params,
    pairColor,
    pairWatchlistId: pairContext.watchlistId,
  })

  const { watchlists, selectedMember } = useWatchlistSelection(
    workspaceId,
    selectedWatchlistId,
    pairColor === 'gray'
  )
  const selectedDocument = useWatchlistYjsDocument({
    workspaceId,
    watchlistId: selectedMember?.entityId,
    member: selectedMember,
  })
  const selectedWatchlist = selectedDocument.record
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const orderedWatchlists = useMemo(
    () =>
      [...watchlists].sort((left, right) => toEpochMs(right.createdAt) - toEpochMs(left.createdAt)),
    [watchlists]
  )

  const hasSelectedWatchlist = Boolean(selectedWatchlist)
  const canManageSections = hasSelectedWatchlist
  const canDeleteCurrent = Boolean(selectedWatchlist)
  const isMutating = Boolean(pendingAction)

  const handleSelectWatchlist = (watchlistId: string | null) => {
    if (pairColor !== 'gray') {
      setPairContext(pairColor, { watchlistId })
    }
    emitWatchlistSelectionChange({
      watchlistId,
      panelId,
      widgetKey,
    })
  }

  const handleRenameWatchlist = async (watchlistId: string, nextName: string) => {
    if (!workspaceId || pendingAction) {
      return false
    }

    const target = watchlists.find((entry) => entry.entityId === watchlistId)
    if (!target) return false

    const trimmed = nextName.trim()
    if (!trimmed || trimmed === target.entityName) {
      return true
    }

    try {
      setPendingAction('rename')
      await saveSavedEntityField('watchlist', target.entityId, workspaceId, 'name', trimmed)
      return true
    } catch {
      return false
    } finally {
      setPendingAction(null)
    }
  }

  const handleDeleteWatchlistById = async (watchlistId: string) => {
    if (!workspaceId || pendingAction) return false
    const target = watchlists.find((entry) => entry.entityId === watchlistId)
    if (!target) return false

    try {
      setPendingAction('delete')
      const response = await fetch(
        `/api/watchlists/${encodeURIComponent(target.entityId)}?workspaceId=${encodeURIComponent(workspaceId)}`,
        { method: 'DELETE' }
      )
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error || 'Failed to delete watchlist')
      }
      if (selectedWatchlist?.id === target.entityId) {
        handleSelectWatchlist(null)
      }
      return true
    } catch {
      return false
    } finally {
      setPendingAction(null)
    }
  }

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleImportChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !workspaceId || !selectedWatchlist || pendingAction) {
      event.target.value = ''
      return
    }

    try {
      setPendingAction('import')
      const content = await file.text()
      const parsed = JSON.parse(content) as unknown
      const response = await fetch(
        `/api/watchlists/${encodeURIComponent(selectedWatchlist.id)}/import`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId, file: parsed }),
        }
      )
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error || 'Failed to import watchlist')
      }
    } catch {
      // Invalid files or save errors leave the existing watchlist unchanged.
    } finally {
      setPendingAction(null)
      event.target.value = ''
    }
  }

  const handleExport = async () => {
    if (!workspaceId || !selectedWatchlist || pendingAction) return
    try {
      setPendingAction('export')
      const content = exportWatchlistAsJson({
        fields: {
          name: selectedDocument.name,
          settings: selectedDocument.settings,
          items: selectedDocument.items,
        },
        exportedFrom: WATCHLIST_EXPORT_SOURCE,
      })
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const safeName =
        selectedWatchlist.name
          .trim()
          .replace(/[^a-z0-9._-]+/gi, '-')
          .replace(/^-+|-+$/g, '') || selectedWatchlist.id

      const blob = new Blob([content], { type: 'application/json;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${safeName}-${timestamp}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch {
      // Export errors are non-destructive.
    } finally {
      setPendingAction(null)
    }
  }

  const handleCreateWatchlist = async () => {
    if (!workspaceId || pendingAction) return

    try {
      setPendingAction('create')
      const response = await fetch('/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          name: resolveNextWatchlistName(
            watchlists.map((entry) => ({ name: entry.entityName })),
            copy.header.defaultWatchlistPrefix
          ),
        }),
      })
      const payload = (await response.json().catch(() => null)) as {
        watchlist?: WatchlistRecord
        error?: string
      } | null
      if (!response.ok || !payload?.watchlist) {
        throw new Error(payload?.error || 'Failed to create watchlist')
      }
      handleSelectWatchlist(payload.watchlist.id)
    } catch {
      // Create errors are surfaced by keeping the current selection unchanged.
    } finally {
      setPendingAction(null)
    }
  }

  const handleCreateSection = async () => {
    if (!workspaceId || !selectedWatchlist || pendingAction) {
      return
    }

    try {
      setPendingAction('section')
      selectedDocument.setItems([
        ...selectedDocument.items,
        {
          id: crypto.randomUUID(),
          type: 'section',
          label: resolveNextSectionName(selectedWatchlist, copy.header.defaultSectionPrefix),
        },
      ])
      await selectedDocument.save()
    } catch {
      // Save errors leave the existing sections unchanged.
    } finally {
      setPendingAction(null)
    }
  }

  const handleRefreshData = () => {
    if (!providerId) return
    emitWatchlistParamsChange({
      params: {
        runtime: {
          refreshAt: Date.now(),
        },
      },
      panelId,
      widgetKey,
    })
  }

  const handleDeleteWatchlist = async () => {
    if (!workspaceId || !selectedWatchlist) return
    const deleted = await handleDeleteWatchlistById(selectedWatchlist.id)
    if (!deleted) return
    setDeleteDialogOpen(false)
  }

  return (
    <div className={widgetHeaderButtonGroupClassName('min-w-0')}>
      <div className='w-full min-w-0 max-w-[220px]'>
        <WatchlistListSelector
          watchlists={orderedWatchlists}
          selectedWatchlist={selectedMember}
          onSelect={handleSelectWatchlist}
          onRenameWatchlist={handleRenameWatchlist}
          onDeleteWatchlist={handleDeleteWatchlistById}
          isRenamingWatchlist={pendingAction === 'rename'}
          isDeletingWatchlist={pendingAction === 'delete'}
          disabled={!workspaceId}
          align='end'
        />
      </div>
      <WatchlistListActionsButton
        open={listActionsOpen}
        onOpenChange={setListActionsOpen}
        disabled={!workspaceId}
        createWatchlistDisabled={!workspaceId || isMutating}
        createSectionDisabled={!workspaceId || !canManageSections || isMutating}
        importDisabled={!workspaceId || !hasSelectedWatchlist || isMutating}
        exportDisabled={!workspaceId || !hasSelectedWatchlist || isMutating}
        deleteWatchlistDisabled={!workspaceId || !canDeleteCurrent || isMutating}
        onCreateWatchlist={() => {
          void handleCreateWatchlist()
        }}
        onCreateSection={() => {
          void handleCreateSection()
        }}
        onImport={handleImportClick}
        onExport={() => {
          void handleExport()
        }}
        onDeleteWatchlist={() => {
          setDeleteDialogOpen(true)
        }}
      />

      <WidgetHeaderRefreshButton
        label={copy.header.refresh}
        onClick={handleRefreshData}
        disabled={!workspaceId || !providerId}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.listSelector.deleteDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedWatchlist
                ? formatTemplate(copy.listSelector.deleteDialogDescription, {
                    name: selectedWatchlist.name,
                  })
                : copy.listSelector.deleteDialogDescriptionFallback}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>{copy.listSelector.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isMutating}
              onClick={(event) => {
                event.preventDefault()
                void handleDeleteWatchlist()
              }}
            >
              {copy.listSelector.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <input
        ref={fileInputRef}
        type='file'
        accept='.json,application/json'
        className='hidden'
        onChange={handleImportChange}
      />
    </div>
  )
}

export const renderWatchlistHeader: DashboardWidgetDefinition['renderHeader'] = ({
  context,
  panelId,
  widget,
}) => ({
  left: (
    <WatchlistHeaderLeftControls
      workspaceId={context?.workspaceId}
      panelId={panelId}
      widget={widget}
    />
  ),
  center: (
    <WatchlistHeaderCenterControls
      workspaceId={context?.workspaceId}
      panelId={panelId}
      widget={widget}
    />
  ),
  right: (
    <WatchlistHeaderRightControls
      workspaceId={context?.workspaceId}
      panelId={panelId}
      widget={widget}
    />
  ),
})
