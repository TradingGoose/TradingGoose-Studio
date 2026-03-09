import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ListingIdentity } from '@/lib/listing/identity'
import type { WatchlistRecord, WatchlistSettings } from '@/lib/watchlists/types'

export const watchlistKeys = {
  all: ['watchlists'] as const,
  lists: () => [...watchlistKeys.all, 'list'] as const,
  list: (workspaceId: string | undefined) => [...watchlistKeys.lists(), workspaceId ?? ''] as const,
}

const parseJson = async <T>(response: Response): Promise<T> => (await response.json()) as T

async function fetchWatchlists(workspaceId: string): Promise<WatchlistRecord[]> {
  const response = await fetch(`/api/watchlists?workspaceId=${workspaceId}`)
  if (!response.ok) {
    const payload = await parseJson<{ error?: string }>(response).catch(
      (): { error?: string } => ({})
    )
    throw new Error(payload.error || 'Failed to fetch watchlists')
  }
  const payload = await parseJson<{ watchlists?: WatchlistRecord[] }>(response)
  return Array.isArray(payload.watchlists) ? payload.watchlists : []
}

export function useWatchlists(workspaceId?: string) {
  return useQuery({
    queryKey: watchlistKeys.list(workspaceId),
    queryFn: () => fetchWatchlists(workspaceId as string),
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  })
}

export function useCreateWatchlist() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, name }: { workspaceId: string; name: string }) => {
      const response = await fetch('/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, name }),
      })

      const payload = await parseJson<{ watchlist?: WatchlistRecord; error?: string }>(response)
      if (!response.ok || !payload.watchlist) {
        throw new Error(payload.error || 'Failed to create watchlist')
      }
      return payload.watchlist
    },
    onSuccess: (watchlist, variables) => {
      queryClient.setQueryData<WatchlistRecord[]>(
        watchlistKeys.list(variables.workspaceId),
        (current) => {
          if (!Array.isArray(current) || current.length === 0) {
            return [watchlist]
          }
          if (current.some((entry) => entry.id === watchlist.id)) {
            return current
          }
          return [...current, watchlist]
        }
      )
      queryClient.invalidateQueries({ queryKey: watchlistKeys.list(variables.workspaceId) })
    },
  })
}

export function useRenameWatchlist() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId,
      watchlistId,
      name,
    }: {
      workspaceId: string
      watchlistId: string
      name: string
    }) => {
      const response = await fetch(`/api/watchlists/${watchlistId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, action: 'rename', name }),
      })

      const payload = await parseJson<{ watchlist?: WatchlistRecord; error?: string }>(response)
      if (!response.ok || !payload.watchlist) {
        throw new Error(payload.error || 'Failed to rename watchlist')
      }
      return payload.watchlist
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: watchlistKeys.list(variables.workspaceId) })
    },
  })
}

export function useClearWatchlist() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId,
      watchlistId,
    }: {
      workspaceId: string
      watchlistId: string
    }) => {
      const response = await fetch(`/api/watchlists/${watchlistId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, action: 'clear' }),
      })

      const payload = await parseJson<{ watchlist?: WatchlistRecord; error?: string }>(response)
      if (!response.ok || !payload.watchlist) {
        throw new Error(payload.error || 'Failed to clear watchlist')
      }
      return payload.watchlist
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: watchlistKeys.list(variables.workspaceId) })
    },
  })
}

export function useDeleteWatchlist() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId,
      watchlistId,
    }: {
      workspaceId: string
      watchlistId: string
    }) => {
      const response = await fetch(
        `/api/watchlists/${watchlistId}?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: 'DELETE',
        }
      )
      const payload = await parseJson<{ success?: boolean; error?: string }>(response).catch(
        (): { success?: boolean; error?: string } => ({})
      )
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to delete watchlist')
      }
      return true
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: watchlistKeys.list(variables.workspaceId) })
    },
  })
}

export function useUpdateWatchlistSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId,
      watchlistId,
      settings,
    }: {
      workspaceId: string
      watchlistId: string
      settings: Partial<WatchlistSettings>
    }) => {
      const response = await fetch(`/api/watchlists/${watchlistId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, action: 'settings', settings }),
      })

      const payload = await parseJson<{ watchlist?: WatchlistRecord; error?: string }>(response)
      if (!response.ok || !payload.watchlist) {
        throw new Error(payload.error || 'Failed to update settings')
      }
      return payload.watchlist
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: watchlistKeys.list(variables.workspaceId) })
    },
  })
}

export function useReorderWatchlistItems() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId,
      watchlistId,
      orderedItemIds,
    }: {
      workspaceId: string
      watchlistId: string
      orderedItemIds: string[]
    }) => {
      const response = await fetch(`/api/watchlists/${watchlistId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, action: 'reorder', orderedItemIds }),
      })

      const payload = await parseJson<{ watchlist?: WatchlistRecord; error?: string }>(response)
      if (!response.ok || !payload.watchlist) {
        throw new Error(payload.error || 'Failed to reorder watchlist')
      }
      return payload.watchlist
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: watchlistKeys.list(variables.workspaceId) })
    },
  })
}

export function useAddWatchlistListing() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId,
      watchlistId,
      listing,
    }: {
      workspaceId: string
      watchlistId: string
      listing: ListingIdentity
    }) => {
      const response = await fetch(`/api/watchlists/${watchlistId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          action: 'addListing',
          listing,
        }),
      })

      const payload = await parseJson<{ watchlist?: WatchlistRecord; error?: string }>(response)
      if (!response.ok || !payload.watchlist) {
        throw new Error(payload.error || 'Failed to add listing')
      }
      return payload.watchlist
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: watchlistKeys.list(variables.workspaceId) })
    },
  })
}

export function useAddWatchlistSection() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId,
      watchlistId,
      label,
    }: {
      workspaceId: string
      watchlistId: string
      label: string
    }) => {
      const response = await fetch(`/api/watchlists/${watchlistId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          action: 'addSection',
          label,
        }),
      })

      const payload = await parseJson<{ watchlist?: WatchlistRecord; error?: string }>(response)
      if (!response.ok || !payload.watchlist) {
        throw new Error(payload.error || 'Failed to add section')
      }
      return payload.watchlist
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: watchlistKeys.list(variables.workspaceId) })
    },
  })
}

export function useRenameWatchlistSection() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId,
      watchlistId,
      sectionId,
      label,
    }: {
      workspaceId: string
      watchlistId: string
      sectionId: string
      label: string
    }) => {
      const response = await fetch(`/api/watchlists/${watchlistId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          action: 'renameSection',
          sectionId,
          label,
        }),
      })

      const payload = await parseJson<{ watchlist?: WatchlistRecord; error?: string }>(response)
      if (!response.ok || !payload.watchlist) {
        throw new Error(payload.error || 'Failed to rename section')
      }
      return payload.watchlist
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: watchlistKeys.list(variables.workspaceId) })
    },
  })
}

export function useRemoveWatchlistItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId,
      watchlistId,
      itemId,
    }: {
      workspaceId: string
      watchlistId: string
      itemId: string
    }) => {
      const response = await fetch(`/api/watchlists/${watchlistId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          action: 'removeItem',
          itemId,
        }),
      })

      const payload = await parseJson<{ watchlist?: WatchlistRecord; error?: string }>(response)
      if (!response.ok || !payload.watchlist) {
        throw new Error(payload.error || 'Failed to remove item')
      }
      return payload.watchlist
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: watchlistKeys.list(variables.workspaceId) })
    },
  })
}

export function useRemoveWatchlistSection() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId,
      watchlistId,
      sectionId,
    }: {
      workspaceId: string
      watchlistId: string
      sectionId: string
    }) => {
      const response = await fetch(`/api/watchlists/${watchlistId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          action: 'removeSection',
          sectionId,
        }),
      })

      const payload = await parseJson<{ watchlist?: WatchlistRecord; error?: string }>(response)
      if (!response.ok || !payload.watchlist) {
        throw new Error(payload.error || 'Failed to remove section')
      }
      return payload.watchlist
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: watchlistKeys.list(variables.workspaceId) })
    },
  })
}

export function useImportWatchlist() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId,
      watchlistId,
      listings,
    }: {
      workspaceId: string
      watchlistId: string
      listings: ListingIdentity[]
    }) => {
      const response = await fetch(`/api/watchlists/${watchlistId}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          listings,
        }),
      })

      const payload = await parseJson<{
        watchlist?: WatchlistRecord
        import?: { addedCount: number; skippedCount: number }
        error?: string
      }>(response)
      if (!response.ok || !payload.watchlist || !payload.import) {
        throw new Error(payload.error || 'Failed to import watchlist')
      }
      return payload
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: watchlistKeys.list(variables.workspaceId) })
    },
  })
}

const parseExportFileName = (value: string | null): string => {
  if (!value) return 'watchlist.json'
  const match = value.match(/filename="([^"]+)"/i)
  if (match?.[1]) return match[1]
  return 'watchlist.json'
}

export function useExportWatchlist() {
  return useMutation({
    mutationFn: async ({
      workspaceId,
      watchlistId,
    }: {
      workspaceId: string
      watchlistId: string
    }) => {
      const response = await fetch(
        `/api/watchlists/${watchlistId}/export?workspaceId=${encodeURIComponent(workspaceId)}`
      )

      const content = await response.text()
      if (!response.ok) {
        throw new Error(content || 'Failed to export watchlist')
      }
      return {
        content,
        fileName: parseExportFileName(response.headers.get('Content-Disposition')),
      }
    },
  })
}
