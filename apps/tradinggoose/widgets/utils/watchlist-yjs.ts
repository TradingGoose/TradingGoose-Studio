'use client'

import { useCallback, useMemo } from 'react'
import type { ReviewAccessMode } from '@/lib/copilot/review-sessions/types'
import { DEFAULT_WATCHLIST_SETTINGS } from '@/lib/watchlists/constants'
import type { WatchlistItem, WatchlistRecord, WatchlistSettings } from '@/lib/watchlists/types'
import {
  type EntityListMember,
  readWatchlistItems,
  updateWatchlistItems,
} from '@/lib/yjs/entity-session'
import { useEntityList, useSavedEntityYjsSession, useYjsField } from '@/lib/yjs/use-entity-fields'
import { useYjsSubscription } from '@/lib/yjs/use-yjs-subscription'
import { useLatestRef } from '@/hooks/use-latest-ref'
import { resolveEntityIdFromList } from '@/widgets/widget-entity-selection'

const EMPTY_WATCHLIST_ITEMS: WatchlistItem[] = []

export function useWatchlistYjsDocument(args: {
  workspaceId: string | null | undefined
  watchlistId: string | null | undefined
  member?: EntityListMember | null
  accessMode?: ReviewAccessMode
}) {
  const { workspaceId, watchlistId, member, accessMode = 'write' } = args
  const accessModeRef = useLatestRef(accessMode)
  const { doc, save, isLoading, error } = useSavedEntityYjsSession(
    'watchlist',
    watchlistId,
    workspaceId,
    null,
    accessMode
  )
  const name = member?.entityName ?? 'Watchlist'
  const [settings] = useYjsField<WatchlistSettings>(doc, 'settings', DEFAULT_WATCHLIST_SETTINGS)
  const subscribeItems = useMemo(() => {
    if (!doc) return (callback: () => void) => () => {}
    return (callback: () => void) => {
      doc.on('update', callback)
      return () => doc.off('update', callback)
    }
  }, [doc])
  const readItems = useCallback(
    () => (doc ? readWatchlistItems(doc) : EMPTY_WATCHLIST_ITEMS),
    [doc]
  )
  const items = useYjsSubscription(subscribeItems, readItems, EMPTY_WATCHLIST_ITEMS)
  const updateItems = useCallback(
    (update: (current: WatchlistItem[]) => WatchlistItem[]) => {
      if (!doc || accessModeRef.current === 'read') return
      updateWatchlistItems(doc, update)
    },
    [accessModeRef, doc]
  )

  const record = useMemo<WatchlistRecord | null>(() => {
    if (!workspaceId || !watchlistId) return null
    return {
      id: watchlistId,
      workspaceId,
      name,
      settings,
      items: Array.isArray(items) ? items : [],
      createdAt: member?.createdAt ?? '',
      updatedAt: member?.updatedAt ?? '',
    }
  }, [items, member?.createdAt, member?.updatedAt, name, settings, watchlistId, workspaceId])

  return {
    record,
    name,
    settings,
    items: Array.isArray(items) ? items : [],
    updateItems,
    save,
    isLoading,
    error,
  }
}

export function useSelectedWatchlistYjsDocument(args: {
  workspaceId: string | null | undefined
  watchlistId?: string | null | undefined
  accessMode?: ReviewAccessMode
}) {
  const { workspaceId, watchlistId, accessMode } = args
  const watchlistList = useEntityList('watchlist', workspaceId)
  const selectedWatchlistId = resolveEntityIdFromList({
    requestedEntityId: watchlistId,
    entityIds: watchlistList.members.map((member) => member.entityId),
  })
  const member =
    watchlistList.members.find((entry) => entry.entityId === selectedWatchlistId) ?? null
  const document = useWatchlistYjsDocument({
    workspaceId,
    watchlistId: selectedWatchlistId,
    member,
    accessMode,
  })

  return {
    ...document,
    members: watchlistList.members,
    member,
    selectedWatchlistId,
    isLoading: watchlistList.isLoading || document.isLoading,
    error: watchlistList.error ?? document.error,
  }
}
