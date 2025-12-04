import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Fuse from 'fuse.js'
import { createLogger } from '@/lib/logs/console/logger'
import {
  fetchKnowledgeChunks,
  knowledgeKeys,
  serializeChunkParams,
  serializeDocumentParams,
  useKnowledgeBaseQuery,
  useKnowledgeBasesQuery,
  useKnowledgeChunksQuery,
  useKnowledgeDocumentsQuery,
} from '@/hooks/queries/knowledge'
import {
  type ChunkData,
  type ChunksPagination,
  type DocumentData,
  type DocumentsCache,
  type DocumentsPagination,
  type KnowledgeBaseData,
  useKnowledgeStore,
} from '@/stores/knowledge/store'

const logger = createLogger('UseKnowledgeBase')

export function useKnowledgeBase(id: string) {
  const queryClient = useQueryClient()
  const query = useKnowledgeBaseQuery(id)

  useEffect(() => {
    if (query.data) {
      const knowledgeBase = query.data
      useKnowledgeStore.setState((state) => ({
        knowledgeBases: {
          ...state.knowledgeBases,
          [knowledgeBase.id]: knowledgeBase,
        },
      }))
    }
  }, [query.data])

  const refreshKnowledgeBase = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: knowledgeKeys.detail(id),
    })
  }, [queryClient, id])

  return {
    knowledgeBase: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refresh: refreshKnowledgeBase,
  }
}

// Constants
const DEFAULT_PAGE_SIZE = 50

export function useKnowledgeBaseDocuments(
  knowledgeBaseId: string,
  options?: {
    search?: string
    limit?: number
    offset?: number
    sortBy?: string
    sortOrder?: string
    enabled?: boolean
  }
) {
  const queryClient = useQueryClient()
  const requestLimit = options?.limit ?? DEFAULT_PAGE_SIZE
  const requestOffset = options?.offset ?? 0
  const requestSearch = options?.search
  const requestSortBy = options?.sortBy
  const requestSortOrder = options?.sortOrder
  const paramsKey = serializeDocumentParams({
    knowledgeBaseId,
    limit: requestLimit,
    offset: requestOffset,
    search: requestSearch,
    sortBy: requestSortBy,
    sortOrder: requestSortOrder,
  })

  const query = useKnowledgeDocumentsQuery(
    {
      knowledgeBaseId,
      limit: requestLimit,
      offset: requestOffset,
      search: requestSearch,
      sortBy: requestSortBy,
      sortOrder: requestSortOrder,
    },
    {
      enabled: (options?.enabled ?? true) && Boolean(knowledgeBaseId),
    }
  )

  useEffect(() => {
    if (!query.data || !knowledgeBaseId) return
    const documentsCache = {
      documents: query.data.documents,
      pagination: query.data.pagination,
      searchQuery: requestSearch,
      sortBy: requestSortBy,
      sortOrder: requestSortOrder,
      lastFetchTime: Date.now(),
    }
    useKnowledgeStore.setState((state) => ({
      documents: {
        ...state.documents,
        [knowledgeBaseId]: documentsCache,
      },
    }))
  }, [query.data, knowledgeBaseId, requestSearch, requestSortBy, requestSortOrder])

  const documents = query.data?.documents ?? []
  const pagination =
    query.data?.pagination ??
    ({
      total: 0,
      limit: requestLimit,
      offset: requestOffset,
      hasMore: false,
    } satisfies DocumentsCache['pagination'])

  const refreshDocumentsData = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: knowledgeKeys.documents(knowledgeBaseId, paramsKey),
    })
  }, [queryClient, knowledgeBaseId, paramsKey])

  const updateDocumentLocal = useCallback(
    (documentId: string, updates: Partial<DocumentData>) => {
      queryClient.setQueryData<{
        documents: DocumentData[]
        pagination: DocumentsPagination
      }>(knowledgeKeys.documents(knowledgeBaseId, paramsKey), (previous) => {
        if (!previous) return previous
        return {
          ...previous,
          documents: previous.documents.map((doc) =>
            doc.id === documentId ? { ...doc, ...updates } : doc
          ),
        }
      })

      useKnowledgeStore.setState((state) => {
        const existing = state.documents[knowledgeBaseId]
        if (!existing) return state
        return {
          documents: {
            ...state.documents,
            [knowledgeBaseId]: {
              ...existing,
              documents: existing.documents.map((doc) =>
                doc.id === documentId ? { ...doc, ...updates } : doc
              ),
            },
          },
        }
      })
      logger.info(`Updated document ${documentId} for knowledge base ${knowledgeBaseId}`)
    },
    [knowledgeBaseId, paramsKey, queryClient]
  )

  return {
    documents,
    pagination,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refreshDocuments: refreshDocumentsData,
    updateDocument: updateDocumentLocal,
  }
}

export function useKnowledgeBasesList(
  workspaceId?: string,
  options?: {
    enabled?: boolean
  }
) {
  const queryClient = useQueryClient()
  const query = useKnowledgeBasesQuery(workspaceId, { enabled: options?.enabled ?? true })
  useEffect(() => {
    if (query.data) {
      useKnowledgeStore.setState((state) => ({
        knowledgeBasesList: query.data as KnowledgeBaseData[],
        knowledgeBasesListLoaded: true,
        loadingKnowledgeBasesList: query.isLoading,
        knowledgeBases: query.data!.reduce<Record<string, KnowledgeBaseData>>(
          (acc, kb) => {
            acc[kb.id] = kb
            return acc
          },
          { ...state.knowledgeBases }
        ),
      }))
    } else if (query.isLoading) {
      useKnowledgeStore.setState((state) => ({
        loadingKnowledgeBasesList: true,
      }))
    }
  }, [query.data, query.isLoading])

  const addKnowledgeBase = useCallback(
    (knowledgeBase: KnowledgeBaseData) => {
      queryClient.setQueryData<KnowledgeBaseData[]>(
        knowledgeKeys.list(workspaceId),
        (previous = []) => {
          if (previous.some((kb) => kb.id === knowledgeBase.id)) {
            return previous
          }
          return [knowledgeBase, ...previous]
        }
      )
      useKnowledgeStore.setState((state) => ({
        knowledgeBases: {
          ...state.knowledgeBases,
          [knowledgeBase.id]: knowledgeBase,
        },
        knowledgeBasesList: state.knowledgeBasesList.some((kb) => kb.id === knowledgeBase.id)
          ? state.knowledgeBasesList
          : [knowledgeBase, ...state.knowledgeBasesList],
      }))
    },
    [queryClient, workspaceId]
  )

  const removeKnowledgeBase = useCallback(
    (knowledgeBaseId: string) => {
      queryClient.setQueryData<KnowledgeBaseData[]>(
        knowledgeKeys.list(workspaceId),
        (previous) => previous?.filter((kb) => kb.id !== knowledgeBaseId) ?? []
      )
      useKnowledgeStore.setState((state) => ({
        knowledgeBases: Object.fromEntries(
          Object.entries(state.knowledgeBases).filter(([id]) => id !== knowledgeBaseId)
        ),
        knowledgeBasesList: state.knowledgeBasesList.filter((kb) => kb.id !== knowledgeBaseId),
      }))
    },
    [queryClient, workspaceId]
  )

  const refreshList = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: knowledgeKeys.list(workspaceId) })
  }, [queryClient, workspaceId])

  const forceRefresh = refreshList

  return {
    knowledgeBases: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refreshList,
    forceRefresh,
    addKnowledgeBase,
    removeKnowledgeBase,
  }
}

/**
 * Hook to manage chunks for a specific document with optional client-side search
 */
export function useDocumentChunks(
  knowledgeBaseId: string,
  documentId: string,
  urlPage = 1,
  urlSearch = '',
  options: { enableClientSearch?: boolean } = {}
) {
  const { enableClientSearch = false } = options
  const queryClient = useQueryClient()

  // Client-side search state (used in client search mode)
  const [searchQuery, setSearchQuery] = useState('')
  const [clientCurrentPage, setClientCurrentPage] = useState(urlPage)

  // Server-side params
  const paramsKey = serializeChunkParams({
    knowledgeBaseId,
    documentId,
    search: enableClientSearch ? undefined : urlSearch,
    limit: 50,
    offset: (urlPage - 1) * 50,
  })

  // Client-side search mode (e.g., for knowledge-debug tool)
  if (enableClientSearch) {
    const [chunks, setChunks] = useState<ChunkData[]>([])
    const [allChunks, setAllChunks] = useState<ChunkData[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [isMounted, setIsMounted] = useState(false)

    useEffect(() => {
      setIsMounted(true)
      return () => setIsMounted(false)
    }, [])

    useEffect(() => {
      setClientCurrentPage(urlPage)
    }, [urlPage])

    const loadAllChunks = useCallback(async () => {
      if (!knowledgeBaseId || !documentId || !isMounted) return

      try {
        setIsLoading(true)
        setError(null)

        const allChunksData: ChunkData[] = []
        let hasMore = true
        let offset = 0
        const limit = 50

        while (hasMore && isMounted) {
          const response = await fetch(
            `/api/knowledge/${knowledgeBaseId}/documents/${documentId}/chunks?limit=${limit}&offset=${offset}`
          )

          if (!response.ok) {
            throw new Error('Failed to fetch chunks')
          }

          const result = await response.json()

          if (result.success) {
            allChunksData.push(...result.data)
            hasMore = result.pagination.hasMore
            offset += limit
          } else {
            throw new Error(result.error || 'Failed to fetch chunks')
          }
        }

        if (isMounted) {
          setAllChunks(allChunksData)
          setChunks(allChunksData)
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load chunks')
          logger.error(`Failed to load chunks for document ${documentId}:`, err)
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }, [knowledgeBaseId, documentId, isMounted])

    useEffect(() => {
      if (isMounted) {
        loadAllChunks()
      }
    }, [isMounted, loadAllChunks])

    const filteredChunks = useMemo(() => {
      if (!isMounted || !searchQuery.trim()) return allChunks

      const fuse = new Fuse(allChunks, {
        keys: ['content'],
        threshold: 0.3,
        includeScore: true,
        includeMatches: true,
        minMatchCharLength: 2,
        ignoreLocation: true,
      })

      const results = fuse.search(searchQuery)
      return results.map((result) => result.item)
    }, [allChunks, searchQuery, isMounted])

    const CHUNKS_PER_PAGE = 50
    const totalPages = Math.max(1, Math.ceil(filteredChunks.length / CHUNKS_PER_PAGE))
    const hasNextPage = clientCurrentPage < totalPages
    const hasPrevPage = clientCurrentPage > 1

    const paginatedChunks = useMemo(() => {
      const startIndex = (clientCurrentPage - 1) * CHUNKS_PER_PAGE
      const endIndex = startIndex + CHUNKS_PER_PAGE
      return filteredChunks.slice(startIndex, endIndex)
    }, [filteredChunks, clientCurrentPage])

    useEffect(() => {
      if (clientCurrentPage > 1) {
        setClientCurrentPage(1)
      }
    }, [searchQuery])

    useEffect(() => {
      if (clientCurrentPage > totalPages && totalPages > 0) {
        setClientCurrentPage(totalPages)
      }
    }, [clientCurrentPage, totalPages])

    const goToPage = useCallback(
      (page: number) => {
        if (page >= 1 && page <= totalPages) {
          setClientCurrentPage(page)
        }
      },
      [totalPages]
    )

    const nextPage = useCallback(() => {
      if (hasNextPage) {
        setClientCurrentPage((prev) => prev + 1)
      }
    }, [hasNextPage])

    const prevPage = useCallback(() => {
      if (hasPrevPage) {
        setClientCurrentPage((prev) => prev - 1)
      }
    }, [hasPrevPage])

    const refreshChunksData = useCallback(async () => {
      await loadAllChunks()
    }, [loadAllChunks])

    const updateChunkLocal = useCallback((chunkId: string, updates: Partial<ChunkData>) => {
      setAllChunks((prev) => prev.map((chunk) => (chunk.id === chunkId ? { ...chunk, ...updates } : chunk)))
      setChunks((prev) => prev.map((chunk) => (chunk.id === chunkId ? { ...chunk, ...updates } : chunk)))
    }, [])

    return {
      chunks: paginatedChunks,
      allChunks,
      filteredChunks,
      paginatedChunks,
      searchQuery,
      setSearchQuery,
      currentPage: clientCurrentPage,
      totalPages,
      hasNextPage,
      hasPrevPage,
      goToPage,
      nextPage,
      prevPage,
      isLoading,
      error,
      pagination: {
        total: filteredChunks.length,
        limit: CHUNKS_PER_PAGE,
        offset: (clientCurrentPage - 1) * CHUNKS_PER_PAGE,
        hasMore: hasNextPage,
      },
      refreshChunks: refreshChunksData,
      searchChunks: async (newSearchQuery: string) => {
        setSearchQuery(newSearchQuery)
        return paginatedChunks
      },
      updateChunk: updateChunkLocal,
      clearChunks: () => {
        setAllChunks([])
        setChunks([])
      },
    }
  }

  // Server-side search/pagination mode
  const query = useKnowledgeChunksQuery({
    knowledgeBaseId,
    documentId,
    search: urlSearch,
    limit: 50,
    offset: (urlPage - 1) * 50,
  })

  const chunks = query.data?.chunks ?? []
  const pagination = query.data?.pagination ?? {
    total: 0,
    limit: 50,
    offset: 0,
    hasMore: false,
  }

  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.limit))
  const serverCurrentPage = urlPage
  const hasNextPage = serverCurrentPage < totalPages
  const hasPrevPage = serverCurrentPage > 1

  const goToPage = useCallback(
    (page: number) => {
      if (page < 1 || page > totalPages) return
    },
    [totalPages]
  )

  const nextPage = useCallback(() => {
    if (hasNextPage) {
      goToPage(serverCurrentPage + 1)
    }
  }, [goToPage, hasNextPage, serverCurrentPage])

  const prevPage = useCallback(() => {
    if (hasPrevPage) {
      goToPage(serverCurrentPage - 1)
    }
  }, [goToPage, hasPrevPage, serverCurrentPage])

  const refreshChunksData = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: knowledgeKeys.chunks(knowledgeBaseId, documentId, paramsKey),
    })
  }, [queryClient, knowledgeBaseId, documentId, paramsKey])

  const searchChunks = useCallback(
    async (search: string) => {
      try {
        const result = await fetchKnowledgeChunks({
          knowledgeBaseId,
          documentId,
          search,
          limit: 50,
          offset: 0,
        })
        return result.chunks
      } catch (error) {
        logger.error('Failed to search chunks', error)
        return []
      }
    },
    [knowledgeBaseId, documentId]
  )

  const updateChunkLocal = useCallback(
    (chunkId: string, updates: Partial<ChunkData>) => {
      queryClient.setQueryData<{
        chunks: ChunkData[]
        pagination: ChunksPagination
      }>(knowledgeKeys.chunks(knowledgeBaseId, documentId, paramsKey), (previous) => {
        if (!previous) return previous
        return {
          ...previous,
          chunks: previous.chunks.map((chunk) =>
            chunk.id === chunkId ? { ...chunk, ...updates } : chunk
          ),
        }
      })
      useKnowledgeStore.getState().updateChunk(documentId, chunkId, updates)
    },
    [documentId, knowledgeBaseId, queryClient]
  )

  const clearChunksLocal = useCallback(() => {
    useKnowledgeStore.getState().clearChunks(documentId)
    queryClient.removeQueries({
      queryKey: knowledgeKeys.chunks(knowledgeBaseId, documentId, paramsKey),
    })
  }, [documentId, knowledgeBaseId, paramsKey, queryClient])

  return {
    chunks,
    allChunks: chunks,
    filteredChunks: chunks,
    paginatedChunks: chunks,
    searchQuery: urlSearch,
    setSearchQuery: () => {},
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    pagination,
    currentPage: serverCurrentPage,
    totalPages,
    hasNextPage,
    hasPrevPage,
    goToPage,
    nextPage,
    prevPage,
    refreshChunks: refreshChunksData,
    searchChunks,
    updateChunk: updateChunkLocal,
    clearChunks: clearChunksLocal,
  }
}
