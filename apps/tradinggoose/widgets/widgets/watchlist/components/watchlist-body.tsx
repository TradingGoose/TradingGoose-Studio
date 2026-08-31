'use client'

import { useCallback, useMemo } from 'react'
import { useMessages } from 'next-intl'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { areListingIdentitiesEqual, type ListingIdentity } from '@/lib/listing/identity'
import { useMarketQuoteSnapshots } from '@/hooks/queries/market-quote-snapshots'
import type { WidgetComponentProps } from '@/widgets/types'
import { WidgetStateMessage } from '@/widgets/widgets/editor_indicator/components/widget-state-message'
import { moveWatchlistItem } from '@/widgets/widgets/watchlist/components/watchlist-reorder'
import { WatchlistTable } from '@/widgets/widgets/watchlist/components/watchlist-table'
import { useWatchlistWidgetState } from '@/widgets/widgets/watchlist/hooks/use-watchlist-widget-state'

export const WatchlistWidgetBody = (props: WidgetComponentProps) => {
  const copy = useMessages().workspace.widgets.watchlist.body
  const {
    workspaceId,
    canWrite,
    widgetParams,
    providerId,
    refreshAt,
    isLoading,
    error,
    selectedDocument,
    selectedWatchlist,
  } = useWatchlistWidgetState(props)

  const canEditWidgetParams = Boolean(props.onWidgetLinkedParamsPatch)
  const viewItems = selectedWatchlist?.items ?? []
  const quoteItems = useMemo(
    () =>
      viewItems
        .filter((item) => item.type === 'listing')
        .map((item) => ({
          key: item.id,
          listing: item.listing,
        })),
    [viewItems]
  )

  const { data: quotes = {} } = useMarketQuoteSnapshots({
    workspaceId: workspaceId ?? undefined,
    provider: providerId || undefined,
    items: quoteItems,
    auth: widgetParams?.auth,
    providerParams: widgetParams?.providerParams,
    refreshKey: refreshAt,
    enabled: Boolean(providerId && selectedWatchlist),
  })

  const isMutating = !canWrite

  const persistItems = (
    updater: (items: typeof selectedDocument.items) => typeof selectedDocument.items
  ) => {
    if (!workspaceId || !selectedWatchlist || !canWrite) return
    selectedDocument.updateItems(updater)
  }

  const handleUpdateItemListing = async (itemId: string, listing: ListingIdentity) => {
    if (!canWrite) return false
    try {
      persistItems((items) =>
        items.map((item) =>
          item.type === 'listing' && item.id === itemId ? { ...item, listing } : item
        )
      )
      return true
    } catch {
      return false
    }
  }

  const handleRemoveItem = async (itemId: string) => {
    await persistItems((items) => items.filter((item) => item.id !== itemId))
  }

  const handleRemoveContainer = async (containerId: string) => {
    await persistItems((items) =>
      items.filter((item) => item.id !== containerId && item.parentId !== containerId)
    )
  }

  const handleRenameContainer = async (containerId: string, label: string) => {
    await persistItems((items) =>
      items.map((item) =>
        item.type === 'section' && item.id === containerId ? { ...item, label } : item
      )
    )
  }

  const handleMoveItem = async (activeSortableId: string, overSortableId: string) => {
    await persistItems(
      (currentItems) =>
        moveWatchlistItem(currentItems, activeSortableId, overSortableId) ?? currentItems
    )
  }
  const selectedListing = widgetParams?.listing ?? null

  const handleSelectListing = useCallback(
    (listing: ListingIdentity | null) => {
      if (!canEditWidgetParams) return
      if (listing == null) {
        if (selectedListing == null) return
        props.onWidgetLinkedParamsPatch?.({ listing: null })
        return
      }
      if (areListingIdentitiesEqual(selectedListing, listing)) return
      props.onWidgetLinkedParamsPatch?.({ listing })
    },
    [canEditWidgetParams, props.onWidgetLinkedParamsPatch, selectedListing]
  )

  if (!workspaceId) {
    return <WidgetStateMessage message={copy.selectWorkspace} />
  }

  if (isLoading || selectedDocument.isLoading) {
    return (
      <div
        className='flex h-full items-center justify-center'
        role='status'
        aria-live='polite'
        aria-atomic='true'
        aria-busy='true'
      >
        <LoadingAgent size='md' />
        <span className='sr-only'>{copy.loadingWatchlists}</span>
      </div>
    )
  }

  if (error || selectedDocument.error) {
    return (
      <WidgetStateMessage
        message={copy.failedToLoadWatchlists}
        variant='error'
        onRetry={selectedDocument.retry}
        isRetrying={selectedDocument.isRetrying}
      />
    )
  }

  if (selectedDocument.members.length === 0) {
    return <WidgetStateMessage message={copy.createWatchlistToGetStarted} />
  }

  if (!selectedWatchlist) {
    return <WidgetStateMessage message={copy.watchlistNotFound} />
  }

  return (
    <WatchlistTable
      watchlist={selectedWatchlist}
      quotes={quotes}
      providerId={providerId}
      onUpdateItemListing={handleUpdateItemListing}
      onMoveItem={handleMoveItem}
      onRemoveItem={handleRemoveItem}
      onRenameContainer={handleRenameContainer}
      onRemoveContainer={handleRemoveContainer}
      isMutating={isMutating}
      selectedListing={selectedListing}
      onSelectListing={canEditWidgetParams ? handleSelectListing : undefined}
    />
  )
}
