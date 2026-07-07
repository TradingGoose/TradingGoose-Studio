'use client'

import { useMemo } from 'react'
import type { ReviewAccessMode } from '@/lib/copilot/review-sessions/types'
import { DEFAULT_WATCHLIST_SETTINGS } from '@/lib/watchlists/constants'
import type { WatchlistItem, WatchlistRecord, WatchlistSettings } from '@/lib/watchlists/types'
import type { EntityListMember } from '@/lib/yjs/entity-session'
import {
  useEntityList,
  useSavedEntityYjsSession,
  useYjsField,
  useYjsStringField,
} from '@/lib/yjs/use-entity-fields'
import { resolveEntityIdFromList } from '@/widgets/widget-entity-selection'

const EMPTY_WATCHLIST_ITEMS: WatchlistItem[] = []

export function useWatchlistYjsDocument(args: {
  workspaceId: string | null | undefined
  watchlistId: string | null | undefined
  member?: EntityListMember | null
  accessMode?: ReviewAccessMode
}) {
  const { workspaceId, watchlistId, member, accessMode = 'write' } = args
  const { doc, save, isLoading, error } = useSavedEntityYjsSession(
    'watchlist',
    watchlistId,
    workspaceId,
    null,
    accessMode
  )
  const [name, setName] = useYjsStringField(doc, 'name', member?.entityName ?? 'Watchlist')
  const [settings, setSettings] = useYjsField<WatchlistSettings>(
    doc,
    'settings',
    DEFAULT_WATCHLIST_SETTINGS
  )
  const [items, setItems] = useYjsField<WatchlistItem[]>(doc, 'items', EMPTY_WATCHLIST_ITEMS)

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
    doc,
    record,
    name,
    settings,
    items: Array.isArray(items) ? items : [],
    setName,
    setSettings,
    setItems,
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
    useDefaultEntity: false,
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
