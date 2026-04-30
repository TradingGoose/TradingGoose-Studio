'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { areListingIdentitiesEqual, type ListingIdentity } from '@/lib/listing/identity'
import { useMarketQuoteSnapshots } from '@/hooks/queries/market-quote-snapshots'
import {
  useRemoveWatchlistItem,
  useRemoveWatchlistSection,
  useRenameWatchlistSection,
  useReorderWatchlistItems,
  useUpdateWatchlistItemListing,
  useWatchlists,
} from '@/hooks/queries/watchlists'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'
import {
  emitWatchlistParamsChange,
  useWatchlistParamsPersistence,
} from '@/widgets/utils/watchlist-params'
import {
  providerOptions,
  resolveSeriesMarketProviderId,
} from '@/widgets/widgets/data_chart/options'
import {
  resolveSelectedWatchlist,
  resolveSelectedWatchlistId,
} from '@/widgets/widgets/watchlist/components/watchlist-selection'
import { WatchlistTable } from '@/widgets/widgets/watchlist/components/watchlist-table'
import type { WatchlistWidgetParams } from '@/widgets/widgets/watchlist/types'

const WatchlistMessage = ({ message }: { message: string }) => (
  <div className='flex h-full items-center justify-center px-4 text-center text-muted-foreground text-xs'>
    {message}
  </div>
)

const resolveProviderId = (params: WatchlistWidgetParams | null) => {
  return resolveSeriesMarketProviderId(params?.provider, providerOptions)
}

export const WatchlistWidgetBody = ({
  context,
  panelId,
  pairColor = 'gray',
  widget,
  params,
  onWidgetParamsChange,
}: WidgetComponentProps) => {
  const workspaceId = context?.workspaceId ?? null
  const widgetKey = widget?.key ?? 'watchlist'
  const resolvedPairColor = ((widget?.pairColor ?? pairColor ?? 'gray') as PairColor) ?? 'gray'
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const widgetParams =
    params && typeof params === 'object' ? (params as WatchlistWidgetParams) : null
  const providerId = resolveProviderId(widgetParams)
  const refreshAt =
    typeof widgetParams?.runtime?.refreshAt === 'number' ? widgetParams.runtime.refreshAt : null
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()
  const {
    data: watchlists = [],
    isLoading,
    isFetching,
    error,
  } = useWatchlists(workspaceId ?? undefined)
  const reorderMutation = useReorderWatchlistItems()
  const updateListingMutation = useUpdateWatchlistItemListing()
  const removeItemMutation = useRemoveWatchlistItem()
  const renameSectionMutation = useRenameWatchlistSection()
  const removeSectionMutation = useRemoveWatchlistSection()

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
  const selectedWatchlist = useMemo(
    () => resolveSelectedWatchlist(watchlists, selectedWatchlistId),
    [watchlists, selectedWatchlistId]
  )
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

  const isMutating =
    reorderMutation.isPending ||
    updateListingMutation.isPending ||
    removeItemMutation.isPending ||
    renameSectionMutation.isPending ||
    removeSectionMutation.isPending

  const handleUpdateItemListing = async (itemId: string, listing: ListingIdentity) => {
    if (!workspaceId || !selectedWatchlist || updateListingMutation.isPending) return false

    try {
      await updateListingMutation.mutateAsync({
        workspaceId,
        watchlistId: selectedWatchlist.id,
        itemId,
        listing,
      })
      return true
    } catch {
      return false
    }
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

  const handleRenameSection = async (sectionId: string, label: string) => {
    if (!workspaceId || !selectedWatchlist) return
    await renameSectionMutation.mutateAsync({
      workspaceId,
      watchlistId: selectedWatchlist.id,
      sectionId,
      label,
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
