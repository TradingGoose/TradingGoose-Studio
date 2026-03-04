'use client'

import { useEffect, useMemo, useRef } from 'react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import type { WatchlistSort } from '@/lib/watchlists/types'
import { useWatchlistQuotes } from '@/hooks/queries/watchlist-quotes'
import {
  useRemoveWatchlistItem,
  useRenameWatchlistSection,
  useRemoveWatchlistSection,
  useReorderWatchlistItems,
  useWatchlists,
} from '@/hooks/queries/watchlists'
import type { WidgetComponentProps } from '@/widgets/types'
import {
  emitWatchlistParamsChange,
  useWatchlistParamsPersistence,
} from '@/widgets/utils/watchlist-params'
import { providerOptions } from '@/widgets/widgets/data_chart/options'
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
  const fromParams = typeof params?.provider === 'string' ? params.provider.trim() : ''
  if (fromParams) return fromParams
  return providerOptions[0]?.id ?? ''
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
  const reorderMutation = useReorderWatchlistItems()
  const removeItemMutation = useRemoveWatchlistItem()
  const renameSectionMutation = useRenameWatchlistSection()
  const removeSectionMutation = useRemoveWatchlistSection()
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
    reorderMutation.isPending ||
    removeItemMutation.isPending ||
    renameSectionMutation.isPending ||
    removeSectionMutation.isPending
  const sort: WatchlistSort | null = widgetParams?.sort ?? null

  const handleSortChange = (next: WatchlistSort | null) => {
    emitWatchlistParamsChange({
      params: {
        sort: next,
      },
      panelId,
      widgetKey,
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
      <div className='min-h-0 flex-1'>
        <WatchlistTable
          watchlist={selectedWatchlist}
          quotes={quotes}
          sort={sort}
          onSortChange={handleSortChange}
          onReorderItems={handleReorderItems}
          onRemoveItem={handleRemoveItem}
          onRenameSection={handleRenameSection}
          onRemoveSection={handleRemoveSection}
          isMutating={isMutating}
        />
      </div>
    </div>
  )
}
