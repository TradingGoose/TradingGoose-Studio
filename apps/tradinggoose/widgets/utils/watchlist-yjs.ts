'use client'

import { useMemo } from 'react'
import { DEFAULT_WATCHLIST_SETTINGS } from '@/lib/watchlists/constants'
import type { WatchlistItem, WatchlistRecord, WatchlistSettings } from '@/lib/watchlists/types'
import type { EntityListMember } from '@/lib/yjs/entity-session'
import {
  useSavedEntityYjsSession,
  useYjsField,
  useYjsStringField,
} from '@/lib/yjs/use-entity-fields'

export function useWatchlistYjsDocument(args: {
  workspaceId: string | null | undefined
  watchlistId: string | null | undefined
  member?: EntityListMember | null
}) {
  const { workspaceId, watchlistId, member } = args
  const { doc, save, isLoading, error } = useSavedEntityYjsSession(
    'watchlist',
    watchlistId,
    workspaceId
  )
  const [name, setName] = useYjsStringField(doc, 'name', member?.entityName ?? 'Watchlist')
  const [settings, setSettings] = useYjsField<WatchlistSettings>(
    doc,
    'settings',
    DEFAULT_WATCHLIST_SETTINGS
  )
  const [items, setItems] = useYjsField<WatchlistItem[]>(doc, 'items', [])

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
