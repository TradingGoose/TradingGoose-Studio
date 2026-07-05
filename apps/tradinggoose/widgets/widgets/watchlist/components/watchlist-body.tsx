'use client'

import { useCallback, useMemo } from 'react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { areListingIdentitiesEqual, type ListingIdentity } from '@/lib/listing/identity'
import { useMessages } from 'next-intl'
import { useMarketQuoteSnapshots } from '@/hooks/queries/market-quote-snapshots'
import type { WidgetComponentProps } from '@/widgets/types'
import { WatchlistTable } from '@/widgets/widgets/watchlist/components/watchlist-table'
import { useWatchlistWidgetState } from '@/widgets/widgets/watchlist/hooks/use-watchlist-widget-state'

const WatchlistMessage = ({ message }: { message: string }) => (
  <div className='flex h-full items-center justify-center px-4 text-center text-muted-foreground text-xs'>
    {message}
  </div>
)

const removeSectionBlock = <T extends { id: string; type: string }>(items: T[], sectionId: string) => {
  let removingSection = false

  return items.filter((item) => {
    if (item.type === 'section') {
      removingSection = item.id === sectionId
      return !removingSection
    }

    return !removingSection
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
    watchlistMembers,
    isLoading,
    error,
    selectedDocument,
    selectedWatchlist,
  } = useWatchlistWidgetState(props)

  const quoteItems = useMemo(
    () =>
      (selectedWatchlist?.items ?? [])
        .filter((item) => item.type === 'listing')
        .map((item) => ({
          key: item.id,
          listing: item.listing,
        })),
    [selectedWatchlist]
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

  const handleRemoveSection = async (sectionId: string) => {
    await persistItems((items) => removeSectionBlock(items, sectionId))
  }

  const handleRenameSection = async (sectionId: string, label: string) => {
    await persistItems((items) =>
      items.map((item) =>
        item.type === 'section' && item.id === sectionId ? { ...item, label } : item
      )
    )
  }

  const handleReorderItems = async (orderedItemIds: string[]) => {
    await persistItems((items) => {
      const byId = new Map(items.map((item) => [item.id, item]))
      return orderedItemIds
        .map((id) => byId.get(id))
        .filter((item): item is (typeof items)[number] => Boolean(item))
    })
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

  if (!selectedWatchlist) {
    return (
      <WatchlistMessage
        message={
          watchlistMembers.length > 0 ? copy.selectWatchlist : copy.createWatchlistToGetStarted
        }
      />
    )
  }

  return (
    <WatchlistTable
      watchlist={selectedWatchlist}
      quotes={quotes}
      providerId={providerId}
      onUpdateItemListing={handleUpdateItemListing}
      onReorderItems={handleReorderItems}
      onRemoveItem={handleRemoveItem}
      onRenameSection={handleRenameSection}
      onRemoveSection={handleRemoveSection}
      isMutating={isMutating}
      selectedListing={selectedListing}
      isLinkedSelection={isLinkedToColorPair}
      onSelectListing={handleSelectListing}
    />
  )
}
