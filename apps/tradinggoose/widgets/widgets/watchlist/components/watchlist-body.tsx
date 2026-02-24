'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
import { LoadingAgent } from '@/components/ui/loading-agent'
import type { ListingOption } from '@/lib/listing/identity'
import { toListingValue } from '@/lib/listing/identity'
import type { WatchlistSort } from '@/lib/watchlists/types'
import { useWatchlistQuotes } from '@/hooks/queries/watchlist-quotes'
import {
  useAddWatchlistListing,
  useAddWatchlistSection,
  useClearWatchlist,
  useExportWatchlist,
  useImportWatchlist,
  useRemoveWatchlistItem,
  useRemoveWatchlistSection,
  useRenameWatchlist,
  useReorderWatchlistItems,
  useWatchlists,
} from '@/hooks/queries/watchlists'
import {
  createEmptyListingSelectorInstance,
  useListingSelectorStore,
} from '@/stores/market/selector/store'
import type { WidgetComponentProps } from '@/widgets/types'
import {
  emitWatchlistParamsChange,
  useWatchlistParamsPersistence,
} from '@/widgets/utils/watchlist-params'
import { providerOptions } from '@/widgets/widgets/data_chart/options'
import { WatchlistTable } from '@/widgets/widgets/watchlist/components/watchlist-table'
import { WatchlistToolbar } from '@/widgets/widgets/watchlist/components/watchlist-toolbar'
import type { WatchlistWidgetParams } from '@/widgets/widgets/watchlist/types'

const WatchlistMessage = ({ message }: { message: string }) => (
  <div className='flex h-full items-center justify-center px-4 text-center text-muted-foreground text-xs'>
    {message}
  </div>
)

const resolveProviderId = (params: WatchlistWidgetParams | null) => {
  const fromParams = typeof params?.provider === 'string' ? params.provider.trim() : ''
  if (fromParams) return fromParams
  return providerOptions[0]?.id ?? ''
}

const resolveSelectedWatchlistId = (params: WatchlistWidgetParams | null) => {
  const raw = params?.watchlistId
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : null
}

export const WatchlistWidgetBody = ({
  context,
  panelId,
  widget,
  params,
  onWidgetParamsChange,
}: WidgetComponentProps) => {
  const workspaceId = context?.workspaceId ?? null
  const widgetKey = widget?.key ?? 'watchlist'
  const widgetParams =
    params && typeof params === 'object' ? (params as WatchlistWidgetParams) : null
  const providerId = resolveProviderId(widgetParams)
  const refreshAt =
    typeof widgetParams?.runtime?.refreshAt === 'number' ? widgetParams.runtime.refreshAt : null
  const {
    data: watchlists = [],
    isLoading,
    isFetching,
    error,
  } = useWatchlists(workspaceId ?? undefined)
  const addListingMutation = useAddWatchlistListing()
  const addSectionMutation = useAddWatchlistSection()
  const clearMutation = useClearWatchlist()
  const renameMutation = useRenameWatchlist()
  const reorderMutation = useReorderWatchlistItems()
  const removeItemMutation = useRemoveWatchlistItem()
  const removeSectionMutation = useRemoveWatchlistSection()
  const importMutation = useImportWatchlist()
  const exportMutation = useExportWatchlist()
  const [sort, setSort] = useState<WatchlistSort | null>(null)
  const [selectedListing, setSelectedListing] = useState<ReturnType<typeof toListingValue> | null>(
    null
  )
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renameInput, setRenameInput] = useState('')
  const lastRefreshAtRef = useRef<number | null>(null)

  useWatchlistParamsPersistence({
    onWidgetParamsChange,
    panelId,
    widget,
    params: params && typeof params === 'object' ? (params as Record<string, unknown>) : null,
  })

  useEffect(() => {
    if (!providerId) return
    if (widgetParams?.provider) return
    emitWatchlistParamsChange({
      params: { provider: providerId },
      panelId,
      widgetKey,
    })
  }, [providerId, widgetParams?.provider, panelId, widgetKey])

  const selectedWatchlistId = resolveSelectedWatchlistId(widgetParams)
  const selectedWatchlistById = useMemo(
    () => watchlists.find((entry) => entry.id === selectedWatchlistId) ?? null,
    [watchlists, selectedWatchlistId]
  )
  const fallbackWatchlist = useMemo(() => watchlists[0] ?? null, [watchlists])
  const selectedWatchlist = selectedWatchlistById ?? fallbackWatchlist
  const shouldSyncFallbackWatchlistId = useMemo(() => {
    if (!fallbackWatchlist) return false
    if (!selectedWatchlistId) return true
    if (selectedWatchlistById) return false
    return !isFetching
  }, [fallbackWatchlist, isFetching, selectedWatchlistById, selectedWatchlistId])

  useEffect(() => {
    if (!fallbackWatchlist) return
    if (!shouldSyncFallbackWatchlistId) return
    if (fallbackWatchlist.id === selectedWatchlistId) return
    emitWatchlistParamsChange({
      params: { watchlistId: fallbackWatchlist.id },
      panelId,
      widgetKey,
    })
  }, [fallbackWatchlist, panelId, selectedWatchlistId, shouldSyncFallbackWatchlistId, widgetKey])

  const listingSelectorInstanceId = useMemo(
    () => `watchlist-${panelId ?? widgetKey}`,
    [panelId, widgetKey]
  )
  const ensureListingSelectorInstance = useListingSelectorStore((state) => state.ensureInstance)
  const updateListingSelectorInstance = useListingSelectorStore((state) => state.updateInstance)
  const listingSelectorInstance = useListingSelectorStore(
    (state) => state.instances[listingSelectorInstanceId]
  )
  const safeListingSelectorInstance =
    listingSelectorInstance ?? createEmptyListingSelectorInstance()

  useEffect(() => {
    ensureListingSelectorInstance(listingSelectorInstanceId)
  }, [ensureListingSelectorInstance, listingSelectorInstanceId])

  useEffect(() => {
    if (!providerId || safeListingSelectorInstance.providerId === providerId) return
    updateListingSelectorInstance(listingSelectorInstanceId, { providerId })
  }, [
    providerId,
    safeListingSelectorInstance.providerId,
    listingSelectorInstanceId,
    updateListingSelectorInstance,
  ])

  const listingsForQuotes = useMemo(
    () =>
      (selectedWatchlist?.items ?? [])
        .filter((item) => item.type === 'listing')
        .map((item) => item.listing),
    [selectedWatchlist]
  )

  const { data: quotes = {}, refetch: refetchQuotes } = useWatchlistQuotes({
    workspaceId: workspaceId ?? undefined,
    provider: providerId || undefined,
    listings: listingsForQuotes,
    auth: widgetParams?.auth,
    providerParams: widgetParams?.providerParams,
    enabled: Boolean(selectedWatchlist),
  })

  useEffect(() => {
    if (refreshAt == null) return
    if (lastRefreshAtRef.current === refreshAt) return
    lastRefreshAtRef.current = refreshAt
    void refetchQuotes()
  }, [refreshAt, refetchQuotes])

  const isMutating =
    addListingMutation.isPending ||
    addSectionMutation.isPending ||
    clearMutation.isPending ||
    renameMutation.isPending ||
    reorderMutation.isPending ||
    removeItemMutation.isPending ||
    removeSectionMutation.isPending ||
    importMutation.isPending ||
    exportMutation.isPending

  const handleListingChange = (listing: ListingOption | null) => {
    setSelectedListing(toListingValue(listing))
  }

  const handleAddListing = async () => {
    if (!workspaceId || !selectedWatchlist || !selectedListing) return
    await addListingMutation.mutateAsync({
      workspaceId,
      watchlistId: selectedWatchlist.id,
      listing: selectedListing,
    })
  }

  const handleAddSection = async (label: string) => {
    if (!workspaceId || !selectedWatchlist) return
    await addSectionMutation.mutateAsync({
      workspaceId,
      watchlistId: selectedWatchlist.id,
      label,
    })
  }

  const handleRemoveItem = async (itemId: string) => {
    if (!workspaceId || !selectedWatchlist) return
    await removeItemMutation.mutateAsync({
      workspaceId,
      watchlistId: selectedWatchlist.id,
      itemId,
    })
  }

  const handleRemoveSection = async (sectionId: string) => {
    if (!workspaceId || !selectedWatchlist) return
    await removeSectionMutation.mutateAsync({
      workspaceId,
      watchlistId: selectedWatchlist.id,
      sectionId,
    })
  }

  const handleReorderItems = async (orderedItemIds: string[]) => {
    if (!workspaceId || !selectedWatchlist) return
    await reorderMutation.mutateAsync({
      workspaceId,
      watchlistId: selectedWatchlist.id,
      orderedItemIds,
    })
  }

  const handleImportText = async (content: string) => {
    if (!workspaceId || !selectedWatchlist) return
    await importMutation.mutateAsync({
      workspaceId,
      watchlistId: selectedWatchlist.id,
      content,
    })
  }

  const handleExport = async () => {
    if (!workspaceId || !selectedWatchlist) return
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
  }

  const handleRenameWatchlist = () => {
    if (!workspaceId || !selectedWatchlist || selectedWatchlist.isSystem) return
    setRenameInput(selectedWatchlist.name)
    setRenameDialogOpen(true)
  }

  const handleRenameDialogOpenChange = (open: boolean) => {
    setRenameDialogOpen(open)
    if (!open) {
      setRenameInput('')
    }
  }

  const handleConfirmRenameWatchlist = async () => {
    if (!workspaceId || !selectedWatchlist || selectedWatchlist.isSystem) return
    const nextName = renameInput.trim()
    if (!nextName || nextName === selectedWatchlist.name) {
      setRenameDialogOpen(false)
      setRenameInput('')
      return
    }

    try {
      await renameMutation.mutateAsync({
        workspaceId,
        watchlistId: selectedWatchlist.id,
        name: nextName,
      })
      setRenameDialogOpen(false)
      setRenameInput('')
    } catch {
      // Request errors are surfaced through mutation state and existing data refresh behavior.
    }
  }

  const handleClearWatchlist = async () => {
    if (!workspaceId || !selectedWatchlist || selectedWatchlist.isSystem) return
    const confirmed = window.confirm(`Clear all symbols from "${selectedWatchlist.name}"?`)
    if (!confirmed) return

    await clearMutation.mutateAsync({
      workspaceId,
      watchlistId: selectedWatchlist.id,
    })
  }

  if (!workspaceId) {
    return <WatchlistMessage message='Select a workspace to use watchlists.' />
  }

  if (isLoading) {
    return (
      <div className='flex h-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (error) {
    return (
      <WatchlistMessage
        message={error instanceof Error ? error.message : 'Failed to load watchlists.'}
      />
    )
  }

  if (!selectedWatchlist) {
    return <WatchlistMessage message='Create a watchlist to get started.' />
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <WatchlistToolbar
        workspaceId={workspaceId}
        providerId={providerId}
        listingSelectorInstanceId={listingSelectorInstanceId}
        canManageCurrentList={!selectedWatchlist.isSystem}
        hasActiveSort={Boolean(sort)}
        onListingChange={handleListingChange}
        onAddListing={handleAddListing}
        onAddSection={handleAddSection}
        onResetSort={() => setSort(null)}
        onRenameWatchlist={handleRenameWatchlist}
        onClearWatchlist={handleClearWatchlist}
        onImportText={handleImportText}
        onExport={handleExport}
        isMutating={isMutating}
      />
      <div className='min-h-0 flex-1 p-2'>
        <WatchlistTable
          watchlist={selectedWatchlist}
          quotes={quotes}
          sort={sort}
          onSortChange={setSort}
          onReorderItems={handleReorderItems}
          onRemoveItem={handleRemoveItem}
          onRemoveSection={handleRemoveSection}
          isMutating={isMutating}
        />
      </div>
      <Dialog open={renameDialogOpen} onOpenChange={handleRenameDialogOpenChange}>
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle>Rename watchlist</DialogTitle>
            <DialogDescription>
              Enter a new name for &quot;{selectedWatchlist.name}&quot;.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameInput}
            onChange={(event) => setRenameInput(event.target.value)}
            placeholder='Watchlist name'
            disabled={renameMutation.isPending}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              void handleConfirmRenameWatchlist()
            }}
          />
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => handleRenameDialogOpenChange(false)}
              disabled={renameMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type='button'
              onClick={() => {
                void handleConfirmRenameWatchlist()
              }}
              disabled={
                renameMutation.isPending ||
                !renameInput.trim() ||
                renameInput.trim() === selectedWatchlist.name
              }
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
