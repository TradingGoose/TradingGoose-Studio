'use client'

import { type ChangeEvent, useMemo, useRef, useState } from 'react'
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
import type { ListingIdentity } from '@/lib/listing/identity'
import {
  useAddWatchlistListing,
  useAddWatchlistSection,
  useClearWatchlist,
  useCreateWatchlist,
  useDeleteWatchlist,
  useExportWatchlist,
  useImportWatchlist,
  useRenameWatchlist,
  useWatchlists,
} from '@/hooks/queries/watchlists'
import type { WidgetInstance } from '@/widgets/layout'
import { emitWatchlistParamsChange } from '@/widgets/utils/watchlist-params'
import { MarketProviderSelector } from '@/widgets/widgets/components/market-provider-selector'
import { widgetHeaderButtonGroupClassName } from '@/widgets/widgets/components/widget-header-control'
import { providerOptions } from '@/widgets/widgets/data_chart/options'
import { ListingSelectorAddButton } from '@/widgets/widgets/watchlist/components/listing-selector-add-button'
import { WatchlistAddSectionButton } from '@/widgets/widgets/watchlist/components/watchlist-add-section-button'
import { WatchlistListActionsButton } from '@/widgets/widgets/watchlist/components/watchlist-list-actions-button'
import { WatchlistListSelector } from '@/widgets/widgets/watchlist/components/watchlist-list-selector'
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

  return (
    <div className={widgetHeaderButtonGroupClassName()}>
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
  const [sectionOpen, setSectionOpen] = useState(false)
  const [sectionName, setSectionName] = useState('')

  const widgetKey = widget?.key ?? 'watchlist'
  const params = resolveWatchlistParams(widget)
  const selectedWatchlistId = resolveSelectedWatchlistId(params)
  const providerId = resolveProviderId(params)

  const { watchlists, selectedWatchlist } = useWatchlistSelection(workspaceId, selectedWatchlistId)

  const createMutation = useCreateWatchlist()
  const addListingMutation = useAddWatchlistListing()
  const addSectionMutation = useAddWatchlistSection()
  const renameMutation = useRenameWatchlist()
  const deleteMutation = useDeleteWatchlist()

  const orderedWatchlists = useMemo(
    () =>
      [...watchlists].sort((left, right) => toEpochMs(right.createdAt) - toEpochMs(left.createdAt)),
    [watchlists]
  )

  const hasSelectedWatchlist = Boolean(selectedWatchlist)
  const isMutating =
    createMutation.isPending ||
    addListingMutation.isPending ||
    addSectionMutation.isPending ||
    renameMutation.isPending ||
    deleteMutation.isPending

  const listingSelectorInstanceId = useMemo(
    () => `watchlist-add-${panelId ?? widgetKey}`,
    [panelId, widgetKey]
  )

  const handleSelectWatchlist = (watchlistId: string) => {
    emitWatchlistParamsChange({
      params: {
        watchlistId,
      },
      panelId,
      widgetKey,
    })
  }

  const handleCreateWatchlist = async (name: string) => {
    if (!workspaceId || createMutation.isPending) return false
    const nextName = name.trim()
    if (!nextName) return false

    try {
      const watchlist = await createMutation.mutateAsync({
        workspaceId,
        name: nextName,
      })
      emitWatchlistParamsChange({
        params: {
          watchlistId: watchlist.id,
        },
        panelId,
        widgetKey,
      })
      return true
    } catch {
      // Request errors are surfaced through mutation state and existing data refresh behavior.
      return false
    }
  }

  const handleAddListing = async (listing: ListingIdentity) => {
    if (!workspaceId || !selectedWatchlist || addListingMutation.isPending) return false
    try {
      await addListingMutation.mutateAsync({
        workspaceId,
        watchlistId: selectedWatchlist.id,
        listing,
      })
      return true
    } catch {
      // Request errors are surfaced through mutation state and existing data refresh behavior.
      return false
    }
  }

  const handleAddSection = async () => {
    if (!workspaceId || !selectedWatchlist || addSectionMutation.isPending) return
    const label = sectionName.trim()
    if (!label) return
    try {
      await addSectionMutation.mutateAsync({
        workspaceId,
        watchlistId: selectedWatchlist.id,
        label,
      })
      setSectionName('')
      setSectionOpen(false)
    } catch {
      // Request errors are surfaced through mutation state and existing data refresh behavior.
    }
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

  const handleDeleteWatchlist = async (watchlistId: string) => {
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

  return (
    <div className={widgetHeaderButtonGroupClassName()}>
      <WatchlistListSelector
        watchlists={orderedWatchlists}
        selectedWatchlist={selectedWatchlist}
        onSelect={handleSelectWatchlist}
        onCreateFromSearch={handleCreateWatchlist}
        onRenameWatchlist={handleRenameWatchlist}
        onDeleteWatchlist={handleDeleteWatchlist}
        isRenamingWatchlist={renameMutation.isPending}
        isDeletingWatchlist={deleteMutation.isPending}
        disabled={!workspaceId}
        isCreating={createMutation.isPending}
      />

      <ListingSelectorAddButton
        instanceId={listingSelectorInstanceId}
        workspaceId={hasSelectedWatchlist ? workspaceId : undefined}
        providerId={providerId}
        isMutating={isMutating}
        onAddListing={handleAddListing}
      />

      <WatchlistAddSectionButton
        open={sectionOpen}
        onOpenChange={setSectionOpen}
        sectionName={sectionName}
        onSectionNameChange={setSectionName}
        onSubmit={handleAddSection}
        disabled={!workspaceId || !hasSelectedWatchlist || isMutating}
        isMutating={isMutating}
      />
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
  const hasActiveSort = Boolean(params?.sort)

  const { selectedWatchlist } = useWatchlistSelection(workspaceId, selectedWatchlistId)

  const deleteMutation = useDeleteWatchlist()
  const clearMutation = useClearWatchlist()
  const importMutation = useImportWatchlist()
  const exportMutation = useExportWatchlist()

  const hasSelectedWatchlist = Boolean(selectedWatchlist)
  const canManageCurrentList = Boolean(selectedWatchlist && !selectedWatchlist.isSystem)
  const canDeleteCurrent = Boolean(selectedWatchlist && !selectedWatchlist.isSystem)
  const isMutating =
    deleteMutation.isPending ||
    clearMutation.isPending ||
    importMutation.isPending ||
    exportMutation.isPending

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
      await importMutation.mutateAsync({
        workspaceId,
        watchlistId: selectedWatchlist.id,
        content,
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

      const blob = new Blob([result.content], { type: 'text/plain;charset=utf-8;' })
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

  const handleClearWatchlist = async () => {
    if (
      !workspaceId ||
      !selectedWatchlist ||
      selectedWatchlist.isSystem ||
      clearMutation.isPending
    ) {
      return
    }

    const confirmed = window.confirm(`Clear all symbols from "${selectedWatchlist.name}"?`)
    if (!confirmed) return

    try {
      await clearMutation.mutateAsync({
        workspaceId,
        watchlistId: selectedWatchlist.id,
      })
    } catch {
      // Request errors are surfaced through mutation state and existing data refresh behavior.
    }
  }

  const handleResetOrder = () => {
    emitWatchlistParamsChange({
      params: {
        sort: null,
      },
      panelId,
      widgetKey,
    })
  }

  const handleDeleteWatchlist = async () => {
    if (!workspaceId || !selectedWatchlist || selectedWatchlist.isSystem) return
    try {
      await deleteMutation.mutateAsync({
        workspaceId,
        watchlistId: selectedWatchlist.id,
      })
      setDeleteDialogOpen(false)
    } catch {
      // Request errors are surfaced through mutation state and existing data refresh behavior.
    }
  }

  return (
    <div className={widgetHeaderButtonGroupClassName()}>
      <WatchlistListActionsButton
        open={listActionsOpen}
        onOpenChange={setListActionsOpen}
        disabled={!workspaceId}
        importDisabled={!workspaceId || !hasSelectedWatchlist || isMutating}
        exportDisabled={!workspaceId || !hasSelectedWatchlist || isMutating}
        clearListDisabled={!workspaceId || !canManageCurrentList || isMutating}
        resetOrderDisabled={!canManageCurrentList || !hasActiveSort || isMutating}
        deleteWatchlistDisabled={!workspaceId || !canDeleteCurrent || isMutating}
        onImport={handleImportClick}
        onExport={() => {
          void handleExport()
        }}
        onClearList={() => {
          void handleClearWatchlist()
        }}
        onResetOrder={handleResetOrder}
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
        accept='.txt,text/plain'
        className='hidden'
        onChange={handleImportChange}
      />
    </div>
  )
}
