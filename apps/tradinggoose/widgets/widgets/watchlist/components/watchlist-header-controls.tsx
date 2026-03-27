'use client'

import { Check } from 'lucide-react'
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { toListingValue, type ListingIdentity, type ListingOption } from '@/lib/listing/identity'
import type { WatchlistRecord } from '@/lib/watchlists/types'
import { normalizeWatchlistImportFileItems } from '@/lib/watchlists/validation'
import {
  useAddWatchlistListing,
  useAddWatchlistSection,
  useCreateWatchlist,
  useDeleteWatchlist,
  useExportWatchlist,
  useImportWatchlist,
  useRenameWatchlist,
  useWatchlists,
} from '@/hooks/queries/watchlists'
import { useListingSelectorStore } from '@/stores/market/selector/store'
import type { WidgetInstance } from '@/widgets/layout'
import { emitWatchlistParamsChange } from '@/widgets/utils/watchlist-params'
import { MarketProviderSelector } from '@/widgets/widgets/components/market-provider-selector'
import { ListingSelector } from '@/widgets/widgets/components/listing-selector'
import {
  widgetHeaderButtonGroupClassName,
  widgetHeaderIconButtonClassName,
} from '@/widgets/widgets/components/widget-header-control'
import { providerOptions } from '@/widgets/widgets/data_chart/options'
import { WatchlistListActionsButton } from '@/widgets/widgets/watchlist/components/watchlist-list-actions-button'
import { WatchlistListSelector } from '@/widgets/widgets/watchlist/components/watchlist-list-selector'
import {
  resolveWatchlistProviderCredentialDefinitions,
  WatchlistProviderSettingsButton,
} from '@/widgets/widgets/watchlist/components/provider-controls'
import { WatchlistRefreshDataButton } from '@/widgets/widgets/watchlist/components/watchlist-refresh-data-button'
import {
  resolveSelectedWatchlist,
  resolveSelectedWatchlistId,
} from '@/widgets/widgets/watchlist/components/watchlist-selection'
import type { WatchlistWidgetParams } from '@/widgets/widgets/watchlist/types'

type WatchlistHeaderControlsSlotProps = {
  workspaceId?: string
  panelId?: string
  widget?: WidgetInstance | null
}

const resolveProviderId = (params: WatchlistWidgetParams | null | undefined) => {
  const fromParams = typeof params?.provider === 'string' ? params.provider.trim() : ''
  if (fromParams) return fromParams
  return providerOptions[0]?.id ?? ''
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

const buildWatchlistHeaderListingSelectorId = (panelId: string | undefined, widgetKey: string) =>
  `watchlist-header-listing-${panelId ?? 'panel'}-${widgetKey}`

export const resolveNextWatchlistName = (watchlists: Array<{ name: string }>) => {
  const usedNumbers = new Set<number>()

  for (const watchlist of watchlists) {
    const match = watchlist.name.trim().match(/^Watchlist\s+(\d+)$/i)
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

  return `Watchlist ${nextNumber}`
}

export const resolveNextSectionName = (
  watchlist: Pick<WatchlistRecord, 'items'> | null | undefined
) => {
  const usedNumbers = new Set<number>()

  for (const item of watchlist?.items ?? []) {
    if (item.type !== 'section') continue

    const match = item.label.trim().match(/^Section\s+(\d+)$/i)
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

  return `Section ${nextNumber}`
}

const useWatchlistSelection = (workspaceId?: string, selectedWatchlistId?: string | null) => {
  const { data: watchlists = [] } = useWatchlists(workspaceId)
  const selectedWatchlist = useMemo(
    () => resolveSelectedWatchlist(watchlists, selectedWatchlistId ?? null),
    [watchlists, selectedWatchlistId]
  )

  return {
    watchlists,
    selectedWatchlist,
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
  const credentialDefinitions = useMemo(
    () => resolveWatchlistProviderCredentialDefinitions(providerId),
    [providerId]
  )

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
    <div className={widgetHeaderButtonGroupClassName()}>
      <WatchlistProviderSettingsButton
        providerId={providerId}
        providerParams={params?.providerParams}
        authParams={params?.auth}
        definitions={credentialDefinitions}
        workspaceId={workspaceId}
        onSave={handleSaveProviderSettings}
      />
      <MarketProviderSelector
        value={providerId}
        options={providerOptions}
        onChange={handleProviderChange}
        disabled={!workspaceId}
      />

      <WatchlistRefreshDataButton
        onClick={handleRefreshData}
        disabled={!workspaceId || !providerId}
      />
    </div>
  )
}

export const WatchlistHeaderCenterControls = ({
  workspaceId,
  panelId,
  widget,
}: WatchlistHeaderControlsSlotProps) => {
  const widgetKey = widget?.key ?? 'watchlist'
  const params = resolveWatchlistParams(widget)
  const providerId = resolveProviderId(params)
  const selectedWatchlistId = resolveSelectedWatchlistId(params)
  const { selectedWatchlist } = useWatchlistSelection(workspaceId, selectedWatchlistId)
  const selectorInstanceId = useMemo(
    () => buildWatchlistHeaderListingSelectorId(panelId, widgetKey),
    [panelId, widgetKey]
  )
  const ensureSelectorInstance = useListingSelectorStore((state) => state.ensureInstance)
  const updateSelectorInstance = useListingSelectorStore((state) => state.updateInstance)
  const addListingMutation = useAddWatchlistListing()
  const [pendingListing, setPendingListing] = useState<ListingIdentity | null>(null)

  const clearPendingListing = useCallback(
    (nextProviderId = providerId) => {
      setPendingListing(null)
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
    setPendingListing(toListingValue(listing))
  }

  const handleAddListing = async () => {
    if (
      !workspaceId ||
      !selectedWatchlist ||
      !pendingListing ||
      addListingMutation.isPending
    ) {
      return
    }

    try {
      await addListingMutation.mutateAsync({
        workspaceId,
        watchlistId: selectedWatchlist.id,
        listing: pendingListing,
      })
      clearPendingListing()
    } catch {
      // Request errors are surfaced through mutation state and existing data refresh behavior.
    }
  }

  const addListingDisabled =
    !workspaceId ||
    !providerId ||
    !selectedWatchlist ||
    !pendingListing ||
    addListingMutation.isPending

  return (
    <div className={widgetHeaderButtonGroupClassName()}>
      <div className='min-w-[240px]'>
        <ListingSelector
          instanceId={selectorInstanceId}
          disabled={!workspaceId || !providerId || !selectedWatchlist}
          onListingChange={handleListingChange}
        />
      </div>
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
              <span className='sr-only'>Add listing to watchlist</span>
            </button>
          </span>
        </TooltipTrigger>
        <TooltipContent side='top'>Add listing to watchlist</TooltipContent>
      </Tooltip>
    </div>
  )
}

export const WatchlistHeaderRightControls = ({
  workspaceId,
  panelId,
  widget,
}: WatchlistHeaderControlsSlotProps) => {
  const [listActionsOpen, setListActionsOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const widgetKey = widget?.key ?? 'watchlist'
  const params = resolveWatchlistParams(widget)
  const selectedWatchlistId = resolveSelectedWatchlistId(params)

  const { watchlists, selectedWatchlist } = useWatchlistSelection(workspaceId, selectedWatchlistId)

  const renameMutation = useRenameWatchlist()
  const createMutation = useCreateWatchlist()
  const addSectionMutation = useAddWatchlistSection()
  const deleteMutation = useDeleteWatchlist()
  const importMutation = useImportWatchlist()
  const exportMutation = useExportWatchlist()
  const orderedWatchlists = useMemo(
    () =>
      [...watchlists].sort((left, right) => toEpochMs(right.createdAt) - toEpochMs(left.createdAt)),
    [watchlists]
  )

  const hasSelectedWatchlist = Boolean(selectedWatchlist)
  const canManageSections = hasSelectedWatchlist
  const canDeleteCurrent = Boolean(selectedWatchlist && !selectedWatchlist.isSystem)
  const isMutating =
    createMutation.isPending ||
    addSectionMutation.isPending ||
    deleteMutation.isPending ||
    importMutation.isPending ||
    exportMutation.isPending

  const handleSelectWatchlist = (watchlistId: string) => {
    emitWatchlistParamsChange({
      params: {
        watchlistId,
      },
      panelId,
      widgetKey,
    })
  }

  const handleRenameWatchlist = async (watchlistId: string, nextName: string) => {
    if (!workspaceId || renameMutation.isPending) {
      return false
    }

    const target = watchlists.find((entry) => entry.id === watchlistId)
    if (!target || target.isSystem) return false

    const trimmed = nextName.trim()
    if (!trimmed || trimmed === target.name) {
      return true
    }

    try {
      await renameMutation.mutateAsync({
        workspaceId,
        watchlistId: target.id,
        name: trimmed,
      })
      return true
    } catch {
      // Request errors are surfaced through mutation state and existing data refresh behavior.
      return false
    }
  }

  const handleDeleteWatchlistById = async (watchlistId: string) => {
    if (!workspaceId || deleteMutation.isPending) return false
    const target = watchlists.find((entry) => entry.id === watchlistId)
    if (!target || target.isSystem) return false

    try {
      await deleteMutation.mutateAsync({
        workspaceId,
        watchlistId: target.id,
      })
      return true
    } catch {
      // Request errors are surfaced through mutation state and existing data refresh behavior.
      return false
    }
  }

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleImportChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !workspaceId || !selectedWatchlist || importMutation.isPending) {
      event.target.value = ''
      return
    }

    try {
      const content = await file.text()
      const parsed = JSON.parse(content) as unknown
      if (!Array.isArray(parsed)) {
        throw new Error('Invalid watchlist import file')
      }

      const items = normalizeWatchlistImportFileItems(parsed)
      if (items.length !== parsed.length) {
        throw new Error('Invalid watchlist import file')
      }
      await importMutation.mutateAsync({
        workspaceId,
        watchlistId: selectedWatchlist.id,
        items,
      })
    } catch {
      // Request errors are surfaced through mutation state and existing data refresh behavior.
    } finally {
      event.target.value = ''
    }
  }

  const handleExport = async () => {
    if (!workspaceId || !selectedWatchlist || exportMutation.isPending) return
    try {
      const result = await exportMutation.mutateAsync({
        workspaceId,
        watchlistId: selectedWatchlist.id,
      })

      const blob = new Blob([result.content], { type: 'application/json;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = result.fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch {
      // Request errors are surfaced through mutation state and existing data refresh behavior.
    }
  }

  const handleCreateWatchlist = async () => {
    if (!workspaceId || createMutation.isPending) return

    try {
      const watchlist = await createMutation.mutateAsync({
        workspaceId,
        name: resolveNextWatchlistName(watchlists),
      })
      emitWatchlistParamsChange({
        params: {
          watchlistId: watchlist.id,
        },
        panelId,
        widgetKey,
      })
    } catch {
      // Request errors are surfaced through mutation state and existing data refresh behavior.
    }
  }

  const handleCreateSection = async () => {
    if (!workspaceId || !selectedWatchlist || addSectionMutation.isPending) {
      return
    }

    try {
      await addSectionMutation.mutateAsync({
        workspaceId,
        watchlistId: selectedWatchlist.id,
        label: resolveNextSectionName(selectedWatchlist),
      })
    } catch {
      // Request errors are surfaced through mutation state and existing data refresh behavior.
    }
  }

  const handleDeleteWatchlist = async () => {
    if (!workspaceId || !selectedWatchlist || selectedWatchlist.isSystem) return
    const deleted = await handleDeleteWatchlistById(selectedWatchlist.id)
    if (!deleted) return
    setDeleteDialogOpen(false)
  }

  return (
    <div className={widgetHeaderButtonGroupClassName()}>
      <WatchlistListSelector
        watchlists={orderedWatchlists}
        selectedWatchlist={selectedWatchlist}
        onSelect={handleSelectWatchlist}
        onRenameWatchlist={handleRenameWatchlist}
        onDeleteWatchlist={handleDeleteWatchlistById}
        isRenamingWatchlist={renameMutation.isPending}
        isDeletingWatchlist={deleteMutation.isPending}
        disabled={!workspaceId}
        align='end'
      />
      <WatchlistListActionsButton
        open={listActionsOpen}
        onOpenChange={setListActionsOpen}
        disabled={!workspaceId}
        createWatchlistDisabled={!workspaceId || createMutation.isPending}
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

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete watchlist?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedWatchlist
                ? `This action will permanently delete "${selectedWatchlist.name}".`
                : 'This action will permanently delete this watchlist.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isMutating}
              onClick={(event) => {
                event.preventDefault()
                void handleDeleteWatchlist()
              }}
            >
              Delete
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
