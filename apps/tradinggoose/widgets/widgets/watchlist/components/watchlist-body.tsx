'use client'

import { useCallback, useMemo } from 'react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { areListingIdentitiesEqual, type ListingIdentity } from '@/lib/listing/identity'
import { useMessages } from 'next-intl'
import { useMarketQuoteSnapshots } from '@/hooks/queries/market-quote-snapshots'
import type { WatchlistItem } from '@/lib/watchlists/types'
import type { WidgetComponentProps } from '@/widgets/types'
import { WatchlistTable } from '@/widgets/widgets/watchlist/components/watchlist-table'
import { useWatchlistWidgetState } from '@/widgets/widgets/watchlist/hooks/use-watchlist-widget-state'

const WatchlistMessage = ({ message }: { message: string }) => (
  <div className='flex h-full items-center justify-center px-4 text-center text-muted-foreground text-xs'>
    {message}
  </div>
)

const removeContainerPromoteChildren = <
  T extends { id: string; type: string; parentId?: string | null },
>(
  items: T[],
  containerId: string
) => {
  const removedContainer = items.find((item) => item.id === containerId)
  const nextParentId = removedContainer?.parentId ?? null

  return items
    .filter((item) => item.id !== containerId)
    .map((item) => (item.parentId === containerId ? { ...item, parentId: nextParentId } : item))
}

export const collectWatchlistViewItems = (
  items: WatchlistItem[],
  rootParentId: string | null
): WatchlistItem[] => {
  const visibleContainerIds = new Set<string>()
  let changed = true

  while (changed) {
    changed = false
    for (const item of items) {
      if (item.type !== 'section' || visibleContainerIds.has(item.id)) continue
      const parentId = item.parentId ?? null
      if (parentId === rootParentId || (parentId ? visibleContainerIds.has(parentId) : false)) {
        visibleContainerIds.add(item.id)
        changed = true
      }
    }
  }

  return items.filter((item) => {
    if (item.type === 'list') return false
    const parentId = item.parentId ?? null
    return parentId === rootParentId || (parentId ? visibleContainerIds.has(parentId) : false)
  })
}

export const WatchlistWidgetBody = (props: WidgetComponentProps) => {
  const copy = useMessages().workspace.widgets.watchlist.body
  const {
    workspaceId,
    resolvedPairColor,
    isLinkedToColorPair,
    widgetParams,
    providerId,
    refreshAt,
    pairContext,
    setPairContext,
    isLoading,
    error,
    selectedDocument,
    selectedWatchlist,
    selectedListId,
  } = useWatchlistWidgetState(props)

  const viewItems = useMemo(
    () => collectWatchlistViewItems(selectedWatchlist?.items ?? [], selectedListId),
    [selectedListId, selectedWatchlist?.items]
  )
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

  const isMutating = false

  const persistItems = async (
    updater: (items: typeof selectedDocument.items) => typeof selectedDocument.items
  ) => {
    if (!workspaceId || !selectedWatchlist) return
    selectedDocument.setItems(updater(selectedDocument.items))
    await selectedDocument.save()
  }

  const handleUpdateItemListing = async (itemId: string, listing: ListingIdentity) => {
    try {
      await persistItems((items) =>
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
    await persistItems((items) => removeContainerPromoteChildren(items, containerId))
  }

  const handleRenameContainer = async (containerId: string, label: string) => {
    await persistItems((items) =>
      items.map((item) =>
        (item.type === 'list' || item.type === 'section') && item.id === containerId
          ? { ...item, label }
          : item
      )
    )
  }

  const handleReorderItems = async (items: typeof selectedDocument.items) => {
    await persistItems(() => items)
  }
  const selectedListing = isLinkedToColorPair ? (pairContext.listing ?? null) : null

  const handleSelectListing = useCallback(
    (listing: ListingIdentity | null) => {
      if (!isLinkedToColorPair) return
      if (listing == null) {
        if (pairContext.listing == null) return
        setPairContext(resolvedPairColor, { listing: null })
        return
      }
      if (areListingIdentitiesEqual(pairContext.listing, listing)) return
      setPairContext(resolvedPairColor, { listing })
    },
    [isLinkedToColorPair, pairContext.listing, resolvedPairColor, setPairContext]
  )

  if (!workspaceId) {
    return <WatchlistMessage message={copy.selectWorkspace} />
  }

  if (isLoading || selectedDocument.isLoading) {
    return (
      <div className='flex h-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (error || selectedDocument.error) {
    const displayError = error ?? selectedDocument.error
    return (
      <WatchlistMessage
        message={displayError ? String(displayError) : copy.failedToLoadWatchlists}
      />
    )
  }

  return (
    <WatchlistTable
      watchlist={selectedWatchlist}
      rootParentId={selectedListId}
      quotes={quotes}
      providerId={providerId}
      onUpdateItemListing={handleUpdateItemListing}
      onReorderItems={handleReorderItems}
      onRemoveItem={handleRemoveItem}
      onRenameContainer={handleRenameContainer}
      onRemoveContainer={handleRemoveContainer}
      isMutating={isMutating}
      selectedListing={selectedListing}
      isLinkedSelection={isLinkedToColorPair}
      onSelectListing={handleSelectListing}
    />
  )
}
