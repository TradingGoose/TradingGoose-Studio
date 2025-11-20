'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Info, Loader2, Map as MapIcon, RefreshCw } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console/logger'
import { parseQuery, queryToApiParams } from '@/lib/logs/query-parser'
import { cn } from '@/lib/utils'
import Timeline from '@/app/workspace/[workspaceId]/logs/components/filters/components/timeline'
import { AutocompleteSearch } from '@/app/workspace/[workspaceId]/logs/components/search/search'
import { Sidebar } from '@/app/workspace/[workspaceId]/logs/components/sidebar/sidebar'
import Dashboard from '@/app/workspace/[workspaceId]/logs/dashboard'
import { formatDate } from '@/app/workspace/[workspaceId]/logs/utils'
import { GlobalNavbarHeader } from '@/global-navbar'
import { useDebounce } from '@/hooks/use-debounce'
import { useFolderStore } from '@/stores/folders/store'
import { useFilterStore } from '@/stores/logs/filters/store'
import type { LogsResponse, WorkflowLog } from '@/stores/logs/filters/types'

const logger = createLogger('Logs')
const LOGS_PER_PAGE = 50

const getTriggerColor = (trigger: string | null | undefined): string => {
  if (!trigger) return '#9ca3af'

  switch (trigger.toLowerCase()) {
    case 'manual':
      return '#9ca3af' // gray-400 (matches secondary styling better)
    case 'schedule':
      return '#10b981' // green (emerald-500)
    case 'webhook':
      return '#f97316' // orange (orange-500)
    case 'chat':
      return '#8b5cf6' // purple (violet-500)
    case 'api':
      return '#3b82f6' // blue (blue-500)
    default:
      return '#9ca3af' // gray-400
  }
}

const selectedRowAnimation = `
  @keyframes borderPulse {
    0% { border-left-color: hsl(var(--primary) / 0.3) }
    50% { border-left-color: hsl(var(--primary) / 0.7) }
    100% { border-left-color: hsl(var(--primary) / 0.5) }
  }
  .selected-row {
    animation: borderPulse 1s ease-in-out
    border-left-color: hsl(var(--primary) / 0.5)
  }
`

export default function Logs() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const {
    logs,
    loading,
    error,
    setLogs,
    setLoading,
    setError,
    setWorkspaceId,
    page,
    setPage,
    hasMore,
    setHasMore,
    isFetchingMore,
    setIsFetchingMore,
    initializeFromURL,
    timeRange,
    level,
    workflowIds,
    folderIds,
    searchQuery: storeSearchQuery,
    setSearchQuery: setStoreSearchQuery,
    triggers,
    viewMode,
    setViewMode,
  } = useFilterStore()

  useEffect(() => {
    setWorkspaceId(workspaceId)
  }, [workspaceId])

  const [selectedLog, setSelectedLog] = useState<WorkflowLog | null>(null)
  const [selectedLogIndex, setSelectedLogIndex] = useState<number>(-1)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [panelLayout, setPanelLayout] = useState<number[] | null>(null)
  const [isDetailsLoading, setIsDetailsLoading] = useState(false)
  const detailsCacheRef = useRef<Map<string, any>>(new Map())
  const detailsAbortRef = useRef<AbortController | null>(null)
  const currentDetailsIdRef = useRef<string | null>(null)
  const selectedRowRef = useRef<HTMLTableRowElement | null>(null)
  const loaderRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isInitialized = useRef<boolean>(false)

  const [searchQuery, setSearchQuery] = useState(storeSearchQuery)
  const debouncedSearchQuery = useDebounce(searchQuery, 300)

  const [availableWorkflows, setAvailableWorkflows] = useState<string[]>([])
  const [availableFolders, setAvailableFolders] = useState<string[]>([])

  // Live and refresh state
  const [isLive, setIsLive] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const liveIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const isSearchOpenRef = useRef<boolean>(false)

  // Sync local search query with store search query
  useEffect(() => {
    setSearchQuery(storeSearchQuery)
  }, [storeSearchQuery])

  const { fetchFolders, getFolderTree } = useFolderStore()

  useEffect(() => {
    let cancelled = false

    const fetchSuggestions = async () => {
      try {
        const res = await fetch(`/api/workflows?workspaceId=${encodeURIComponent(workspaceId)}`)
        if (res.ok) {
          const body = await res.json()
          const names: string[] = Array.isArray(body?.data)
            ? body.data.map((w: any) => w?.name).filter(Boolean)
            : []
          if (!cancelled) setAvailableWorkflows(names)
        } else {
          if (!cancelled) setAvailableWorkflows([])
        }

        await fetchFolders(workspaceId)
        const tree = getFolderTree(workspaceId)

        const flatten = (nodes: any[], parentPath = ''): string[] => {
          const out: string[] = []
          for (const n of nodes) {
            const path = parentPath ? `${parentPath} / ${n.name}` : n.name
            out.push(path)
            if (n.children?.length) out.push(...flatten(n.children, path))
          }
          return out
        }

        const folderPaths: string[] = Array.isArray(tree) ? flatten(tree) : []
        if (!cancelled) setAvailableFolders(folderPaths)
      } catch {
        if (!cancelled) {
          setAvailableWorkflows([])
          setAvailableFolders([])
        }
      }
    }

    if (workspaceId) {
      fetchSuggestions()
    }

    return () => {
      cancelled = true
    }
  }, [workspaceId, fetchFolders, getFolderTree])

  useEffect(() => {
    if (isInitialized.current && debouncedSearchQuery !== storeSearchQuery) {
      setStoreSearchQuery(debouncedSearchQuery)
    }
  }, [debouncedSearchQuery, storeSearchQuery])

  const handleLogClick = (log: WorkflowLog) => {
    setSelectedLog(log)
    const index = logs.findIndex((l) => l.id === log.id)
    setSelectedLogIndex(index)
    setIsSidebarOpen(true)
    setIsDetailsLoading(true)

    const currentId = log.id
    const prevId = index > 0 ? logs[index - 1]?.id : undefined
    const nextId = index < logs.length - 1 ? logs[index + 1]?.id : undefined

    if (detailsAbortRef.current) {
      try {
        detailsAbortRef.current.abort()
      } catch {
        /* no-op */
      }
    }
    const controller = new AbortController()
    detailsAbortRef.current = controller
    currentDetailsIdRef.current = currentId

    const idsToFetch: Array<{ id: string; merge: boolean }> = []
    const cachedCurrent = currentId ? detailsCacheRef.current.get(currentId) : undefined
    if (currentId && !cachedCurrent) idsToFetch.push({ id: currentId, merge: true })
    if (prevId && !detailsCacheRef.current.has(prevId))
      idsToFetch.push({ id: prevId, merge: false })
    if (nextId && !detailsCacheRef.current.has(nextId))
      idsToFetch.push({ id: nextId, merge: false })

    if (cachedCurrent) {
      setSelectedLog((prev) =>
        prev && prev.id === currentId
          ? ({ ...(prev as any), ...(cachedCurrent as any) } as any)
          : prev
      )
      setIsDetailsLoading(false)
    }
    if (idsToFetch.length === 0) return

    Promise.all(
      idsToFetch.map(async ({ id, merge }) => {
        try {
          const res = await fetch(`/api/logs/${id}`, { signal: controller.signal })
          if (!res.ok) return
          const body = await res.json()
          const detailed = body?.data
          if (detailed) {
            detailsCacheRef.current.set(id, detailed)
            if (merge && id === currentId) {
              setSelectedLog((prev) =>
                prev && prev.id === id ? ({ ...(prev as any), ...(detailed as any) } as any) : prev
              )
              if (currentDetailsIdRef.current === id) setIsDetailsLoading(false)
            }
          }
        } catch (e: any) {
          if (e?.name === 'AbortError') return
        }
      })
    ).catch(() => { })
  }

  const handleNavigateNext = useCallback(() => {
    if (selectedLogIndex < logs.length - 1) {
      const nextIndex = selectedLogIndex + 1
      setSelectedLogIndex(nextIndex)
      const nextLog = logs[nextIndex]
      setSelectedLog(nextLog)
      if (detailsAbortRef.current) {
        try {
          detailsAbortRef.current.abort()
        } catch {
          /* no-op */
        }
      }
      const controller = new AbortController()
      detailsAbortRef.current = controller

      const cached = detailsCacheRef.current.get(nextLog.id)
      if (cached) {
        setSelectedLog((prev) =>
          prev && prev.id === nextLog.id ? ({ ...(prev as any), ...(cached as any) } as any) : prev
        )
      } else {
        const prevId = nextIndex > 0 ? logs[nextIndex - 1]?.id : undefined
        const afterId = nextIndex < logs.length - 1 ? logs[nextIndex + 1]?.id : undefined
        const idsToFetch: Array<{ id: string; merge: boolean }> = []
        if (nextLog.id && !detailsCacheRef.current.has(nextLog.id))
          idsToFetch.push({ id: nextLog.id, merge: true })
        if (prevId && !detailsCacheRef.current.has(prevId))
          idsToFetch.push({ id: prevId, merge: false })
        if (afterId && !detailsCacheRef.current.has(afterId))
          idsToFetch.push({ id: afterId, merge: false })
        Promise.all(
          idsToFetch.map(async ({ id, merge }) => {
            try {
              const res = await fetch(`/api/logs/${id}`, { signal: controller.signal })
              if (!res.ok) return
              const body = await res.json()
              const detailed = body?.data
              if (detailed) {
                detailsCacheRef.current.set(id, detailed)
                if (merge && id === nextLog.id) {
                  setSelectedLog((prev) =>
                    prev && prev.id === id
                      ? ({ ...(prev as any), ...(detailed as any) } as any)
                      : prev
                  )
                }
              }
            } catch (e: any) {
              if (e?.name === 'AbortError') return
            }
          })
        ).catch(() => { })
      }
    }
  }, [selectedLogIndex, logs])

  const handleNavigatePrev = useCallback(() => {
    if (selectedLogIndex > 0) {
      const prevIndex = selectedLogIndex - 1
      setSelectedLogIndex(prevIndex)
      const prevLog = logs[prevIndex]
      setSelectedLog(prevLog)
      if (detailsAbortRef.current) {
        try {
          detailsAbortRef.current.abort()
        } catch {
          /* no-op */
        }
      }
      const controller = new AbortController()
      detailsAbortRef.current = controller

      const cached = detailsCacheRef.current.get(prevLog.id)
      if (cached) {
        setSelectedLog((prev) =>
          prev && prev.id === prevLog.id ? ({ ...(prev as any), ...(cached as any) } as any) : prev
        )
      } else {
        const beforeId = prevIndex > 0 ? logs[prevIndex - 1]?.id : undefined
        const afterId = prevIndex < logs.length - 1 ? logs[prevIndex + 1]?.id : undefined
        const idsToFetch: Array<{ id: string; merge: boolean }> = []
        if (prevLog.id && !detailsCacheRef.current.has(prevLog.id))
          idsToFetch.push({ id: prevLog.id, merge: true })
        if (beforeId && !detailsCacheRef.current.has(beforeId))
          idsToFetch.push({ id: beforeId, merge: false })
        if (afterId && !detailsCacheRef.current.has(afterId))
          idsToFetch.push({ id: afterId, merge: false })
        Promise.all(
          idsToFetch.map(async ({ id, merge }) => {
            try {
              const res = await fetch(`/api/logs/${id}`, { signal: controller.signal })
              if (!res.ok) return
              const body = await res.json()
              const detailed = body?.data
              if (detailed) {
                detailsCacheRef.current.set(id, detailed)
                if (merge && id === prevLog.id) {
                  setSelectedLog((prev) =>
                    prev && prev.id === id
                      ? ({ ...(prev as any), ...(detailed as any) } as any)
                      : prev
                  )
                }
              }
            } catch (e: any) {
              if (e?.name === 'AbortError') return
            }
          })
        ).catch(() => { })
      }
    }
  }, [selectedLogIndex, logs])

  const handleCloseSidebar = () => {
    setIsSidebarOpen(false)
    setSelectedLog(null)
    setSelectedLogIndex(-1)
  }

  useEffect(() => {
    if (selectedRowRef.current) {
      selectedRowRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    }
  }, [selectedLogIndex])

  const fetchLogs = useCallback(async (pageNum: number, append = false) => {
    try {
      // Don't fetch if workspaceId is not set
      const { workspaceId: storeWorkspaceId } = useFilterStore.getState()
      if (!storeWorkspaceId) {
        return
      }

      if (pageNum === 1) {
        setLoading(true)
      } else {
        setIsFetchingMore(true)
      }

      const { buildQueryParams: getCurrentQueryParams } = useFilterStore.getState()
      const queryParams = getCurrentQueryParams(pageNum, LOGS_PER_PAGE)

      const { searchQuery: currentSearchQuery } = useFilterStore.getState()
      const parsedQuery = parseQuery(currentSearchQuery)
      const enhancedParams = queryToApiParams(parsedQuery)

      const allParams = new URLSearchParams(queryParams)
      Object.entries(enhancedParams).forEach(([key, value]) => {
        if (key === 'triggers' && allParams.has('triggers')) {
          const existingTriggers = allParams.get('triggers')?.split(',') || []
          const searchTriggers = value.split(',')
          const combined = [...new Set([...existingTriggers, ...searchTriggers])]
          allParams.set('triggers', combined.join(','))
        } else {
          allParams.set(key, value)
        }
      })

      allParams.set('details', 'basic')
      const response = await fetch(`/api/logs?${allParams.toString()}`)

      if (!response.ok) {
        throw new Error(`Error fetching logs: ${response.statusText}`)
      }

      const data: LogsResponse = await response.json()

      setHasMore(data.data.length === LOGS_PER_PAGE && data.page < data.totalPages)

      setLogs(data.data, append)

      setError(null)
    } catch (err) {
      logger.error('Failed to fetch logs:', { err })
      setError(err instanceof Error ? err.message : 'An unknown error occurred')
    } finally {
      if (pageNum === 1) {
        setLoading(false)
      } else {
        setIsFetchingMore(false)
      }
    }
  }, [])

  const handleRefresh = async () => {
    if (isRefreshing) return

    setIsRefreshing(true)

    try {
      await fetchLogs(1)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred')
    } finally {
      setIsRefreshing(false)
    }
  }

  // Setup or clear the live refresh interval when isLive changes
  useEffect(() => {
    if (liveIntervalRef.current) {
      clearInterval(liveIntervalRef.current)
      liveIntervalRef.current = null
    }

    if (isLive) {
      handleRefresh()
      liveIntervalRef.current = setInterval(() => {
        handleRefresh()
      }, 5000)
    }

    return () => {
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current)
        liveIntervalRef.current = null
      }
    }
  }, [isLive])

  const toggleLive = () => {
    setIsLive(!isLive)
  }

  const handleExport = async () => {
    const params = new URLSearchParams()
    params.set('workspaceId', workspaceId)
    if (level !== 'all') params.set('level', level)
    if (triggers.length > 0) params.set('triggers', triggers.join(','))
    if (workflowIds.length > 0) params.set('workflowIds', workflowIds.join(','))
    if (folderIds.length > 0) params.set('folderIds', folderIds.join(','))

    const parsed = parseQuery(debouncedSearchQuery)
    const extra = queryToApiParams(parsed)
    Object.entries(extra).forEach(([k, v]) => params.set(k, v))

    const url = `/api/logs/export?${params.toString()}`
    const a = document.createElement('a')
    a.href = url
    a.download = 'logs_export.csv'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  useEffect(() => {
    if (!isInitialized.current) {
      isInitialized.current = true
      initializeFromURL()
    }
  }, [initializeFromURL])

  useEffect(() => {
    const handlePopState = () => {
      initializeFromURL()
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [initializeFromURL])

  useEffect(() => {
    if (!isInitialized.current) {
      return
    }

    // Don't fetch if workspaceId is not set yet
    if (!workspaceId) {
      return
    }

    setPage(1)
    setHasMore(true)

    const fetchWithFilters = async () => {
      try {
        setLoading(true)

        const params = new URLSearchParams()
        params.set('details', 'basic')
        params.set('limit', LOGS_PER_PAGE.toString())
        params.set('offset', '0') // Always start from page 1
        params.set('workspaceId', workspaceId)

        const parsedQuery = parseQuery(debouncedSearchQuery)
        const enhancedParams = queryToApiParams(parsedQuery)

        if (level !== 'all') params.set('level', level)
        if (triggers.length > 0) params.set('triggers', triggers.join(','))
        if (workflowIds.length > 0) params.set('workflowIds', workflowIds.join(','))
        if (folderIds.length > 0) params.set('folderIds', folderIds.join(','))

        Object.entries(enhancedParams).forEach(([key, value]) => {
          if (key === 'triggers' && params.has('triggers')) {
            const storeTriggers = params.get('triggers')?.split(',') || []
            const searchTriggers = value.split(',')
            const combined = [...new Set([...storeTriggers, ...searchTriggers])]
            params.set('triggers', combined.join(','))
          } else {
            params.set(key, value)
          }
        })

        if (timeRange !== 'All time') {
          const now = new Date()
          let startDate: Date
          switch (timeRange) {
            case 'Past 30 minutes':
              startDate = new Date(now.getTime() - 30 * 60 * 1000)
              break
            case 'Past hour':
              startDate = new Date(now.getTime() - 60 * 60 * 1000)
              break
            case 'Past 24 hours':
              startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000)
              break
            default:
              startDate = new Date(0)
          }
          params.set('startDate', startDate.toISOString())
        }

        const response = await fetch(`/api/logs?${params.toString()}`)

        if (!response.ok) {
          throw new Error(`Error fetching logs: ${response.statusText}`)
        }

        const data: LogsResponse = await response.json()
        setHasMore(data.data.length === LOGS_PER_PAGE && data.page < data.totalPages)
        setLogs(data.data, false)
        setError(null)
      } catch (err) {
        logger.error('Failed to fetch logs:', { err })
        setError(err instanceof Error ? err.message : 'An unknown error occurred')
      } finally {
        setLoading(false)
      }
    }

    fetchWithFilters()
  }, [workspaceId, timeRange, level, workflowIds, folderIds, debouncedSearchQuery, triggers])

  const loadMoreLogs = useCallback(() => {
    if (!isFetchingMore && hasMore) {
      const nextPage = page + 1
      setPage(nextPage)
      setIsFetchingMore(true)
      setTimeout(() => {
        fetchLogs(nextPage, true)
      }, 50)
    }
  }, [fetchLogs, isFetchingMore, hasMore, page])

  useEffect(() => {
    if (loading || !hasMore) return

    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    const handleScroll = () => {
      if (!scrollContainer) return

      const { scrollTop, scrollHeight, clientHeight } = scrollContainer

      const scrollPercentage = (scrollTop / (scrollHeight - clientHeight)) * 100

      if (scrollPercentage > 60 && !isFetchingMore && hasMore) {
        loadMoreLogs()
      }
    }

    scrollContainer.addEventListener('scroll', handleScroll)

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll)
    }
  }, [loading, hasMore, isFetchingMore, loadMoreLogs])

  useEffect(() => {
    const currentLoaderRef = loaderRef.current
    const scrollContainer = scrollContainerRef.current

    if (!currentLoaderRef || !scrollContainer || loading || !hasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        const e = entries[0]
        if (!e?.isIntersecting) return
        const { scrollTop, scrollHeight, clientHeight } = scrollContainer
        const pct = (scrollTop / (scrollHeight - clientHeight)) * 100
        if (pct > 70 && !isFetchingMore) {
          loadMoreLogs()
        }
      },
      {
        root: scrollContainer,
        threshold: 0.1,
        rootMargin: '200px 0px 0px 0px',
      }
    )

    observer.observe(currentLoaderRef)

    return () => {
      observer.unobserve(currentLoaderRef)
    }
  }, [loading, hasMore, isFetchingMore, loadMoreLogs])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isSearchOpenRef.current) return
      if (logs.length === 0) return

      if (selectedLogIndex === -1 && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        setSelectedLogIndex(0)
        setSelectedLog(logs[0])
        return
      }

      if (e.key === 'ArrowUp' && !e.metaKey && !e.ctrlKey && selectedLogIndex > 0) {
        e.preventDefault()
        handleNavigatePrev()
      }

      if (e.key === 'ArrowDown' && !e.metaKey && !e.ctrlKey && selectedLogIndex < logs.length - 1) {
        e.preventDefault()
        handleNavigateNext()
      }

      if (e.key === 'Enter' && selectedLog) {
        e.preventDefault()
        setIsSidebarOpen(!isSidebarOpen)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [logs, selectedLogIndex, isSidebarOpen, selectedLog, handleNavigateNext, handleNavigatePrev])

  const isDashboardView = viewMode === 'dashboard'

  const headerLeftContent = isDashboardView ? null : (
    <div className='flex w-full flex-1 items-center gap-3'>
      <div className='hidden items-center gap-2 sm:flex'>
        <MapIcon className='h-[18px] w-[18px] text-muted-foreground' />
        <span className='font-medium text-sm'>Logs</span>
      </div>
      <div className='flex w-full flex-1'>
        <AutocompleteSearch
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder='Search logs...'
          availableWorkflows={availableWorkflows}
          availableFolders={availableFolders}
          className='w-full'
          onOpenChange={(open) => {
            isSearchOpenRef.current = open
          }}
          showActiveFilters={false}
          showTextSearchIndicator={false}
        />
      </div>
    </div>
  )

  const headerCenterContent = isDashboardView ? null : (
    <div className='flex flex-wrap items-center justify-center gap-3'>
      <div className='inline-flex h-9 items-center rounded-md border bg-card p-1 shadow-sm'>
        <Button
          variant='ghost'
          size='sm'
          onClick={() => setIsLive((prev) => !prev)}
          className={cn(
            'h-7 rounded-sm px-3 font-normal text-xs',
            isLive
              ? 'bg-primary text-black shadow-[0_0_0_0_var(--primary)] hover:bg-primary-hover hover:text-black '
              : 'text-muted-foreground hover:text-foreground'
          )}
          aria-pressed={isLive}
        >
          Live
        </Button>
      </div>

      <div className='inline-flex h-9 items-center rounded-md border bg-card p-1 shadow-sm'>
        <Button
          variant='ghost'
          size='sm'
          onClick={() => setViewMode('logs')}
          className={cn(
            'h-7 rounded-sm px-3 font-normal text-xs',
            viewMode !== 'dashboard'
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
          aria-pressed={viewMode !== 'dashboard'}
        >
          Logs
        </Button>
        <Button
          variant='ghost'
          size='sm'
          onClick={() => setViewMode('dashboard')}
          className={cn(
            'h-7 rounded-sm px-3 font-normal text-xs',
            viewMode === 'dashboard'
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
          aria-pressed={viewMode === 'dashboard'}
        >
          Dashboard
        </Button>
      </div>
    </div>
  )

  const headerRightContent = (
    <div className='flex flex-wrap items-center gap-3'>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            onClick={handleRefresh}
            className='h-9 rounded-md hover:bg-secondary'
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <Loader2 className='h-5 w-5 animate-spin' />
            ) : (
              <RefreshCw className='h-5 w-5' />
            )}
            <span className='sr-only'>Refresh</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{isRefreshing ? 'Refreshing...' : 'Refresh'}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            onClick={handleExport}
            className='h-9 rounded-md hover:bg-secondary'
            aria-label='Export CSV'
          >
            <svg
              xmlns='http://www.w3.org/2000/svg'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              className='h-5 w-5'
            >
              <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' />
              <polyline points='7 10 12 15 17 10' />
              <line x1='12' y1='15' x2='12' y2='3' />
            </svg>
            <span className='sr-only'>Export CSV</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Export CSV</TooltipContent>
      </Tooltip>
    </div>
  )

  const tableContent = (
    <div className='flex h-full min-h-0 max-h-full flex-1 min-w-0 overflow-hidden'>
      <div className='flex h-full min-h-0 max-h-full flex-1 flex-col overflow-hidden'>
        <div className=' sm:hidden'>
          <TooltipProvider>
            <Timeline />
          </TooltipProvider>
        </div>

        <div className='flex h-full min-h-0 max-h-full flex-1 flex-col overflow-hidden'>
          <div className='w-full h-full min-h-0 max-h-full overflow-x-auto'>
            <div className='min-w-0 min-h-0 h-full max-h-full'>
              <div className='flex h-full min-h-0 max-h-full flex-1 flex-col overflow-hidden rounded-lg border-border border'>
                <div className='shrink-0 border-b bg-card/40'>
                  <table className='w-full table-fixed'>
                    <colgroup>
                      <col className='w-[28%]' />
                      <col className='w-[12%]' />
                      <col className='w-[30%]' />
                      <col className='w-[15%]' />
                    </colgroup>
                    <thead>
                      <tr>
                        <th className='px-4 pt-2 pb-3 text-left font-medium'>
                          <span className='text-muted-foreground text-xs leading-none'>Time</span>
                        </th>
                        <th className='px-4 pt-2 pb-3 text-left font-medium'>
                          <span className='text-muted-foreground text-xs leading-none'>Status</span>
                        </th>
                        <th className='px-4 pt-2 pb-3 text-left font-medium'>
                          <span className='text-muted-foreground text-xs leading-none'>
                            Workflow
                          </span>
                        </th>
                        <th className='px-4 pt-2 pb-3 text-left font-medium'>
                          <span className='text-muted-foreground text-xs leading-none'>Cost</span>
                        </th>
                        <th className='hidden px-4 pt-2 pb-3 text-left font-medium xl:table-cell'>
                          <span className='text-muted-foreground text-xs leading-none'>Trigger</span>
                        </th>
                        <th className='hidden px-4 pt-2 pb-3 text-left font-medium xl:table-cell'>
                          <span className='text-muted-foreground text-xs leading-none'>Duration</span>
                        </th>
                      </tr>
                    </thead>
                  </table>
                </div>

                <div
                  className='flex-1 h-full min-h-0 max-h-full overflow-auto'
                  ref={scrollContainerRef}
                  style={{ scrollbarGutter: 'stable' }}
                >
                  {loading && page === 1 ? (
                    <div className='flex h-full items-center justify-center p-5'>
                      <div className='flex items-center gap-2 text-muted-foreground'>
                        <Loader2 className='h-5 w-5 animate-spin' />
                        <span className='text-sm'>Loading logs...</span>
                      </div>
                    </div>
                  ) : error ? (
                    <div className='flex h-full items-center justify-center'>
                      <div className='flex items-center gap-2 text-destructive'>
                        <AlertCircle className='h-5 w-5' />
                        <span className='text-sm'>Error: {error}</span>
                      </div>
                    </div>
                  ) : logs.length === 0 ? (
                    <div className='flex h-full items-center justify-center'>
                      <div className='flex items-center gap-2 text-muted-foreground'>
                        <Info className='h-5 w-5' />
                        <span className='text-sm'>No logs found</span>
                      </div>
                    </div>
                  ) : (
                    <table className='w-full table-fixed'>
                      <colgroup>
                        <col className='w-[28%]' />
                        <col className='w-[12%]' />
                        <col className='w-[30%]' />
                        <col className='w-[15%]' />
                      </colgroup>
                      <tbody>
                        {logs.map((log) => {
                          const formattedDate = formatDate(log.createdAt)
                          const isSelected = selectedLog?.id === log.id

                          return (
                            <tr
                              key={log.id}
                              ref={isSelected ? selectedRowRef : null}
                              className={cn(
                                'cursor-pointer border-b transition-colors hover:bg-card/30',
                                isSelected && 'selected-row bg-accent/40'
                              )}
                              onClick={() => handleLogClick(log)}
                            >
                              <td className='px-4 py-3'>
                                <div className='text-[13px]'>
                                  <span className='font-sm text-muted-foreground'>
                                    {formattedDate.compactDate}
                                  </span>
                                  <span
                                    className='hidden font-medium sm:inline'
                                    style={{ marginLeft: '8px' }}
                                  >
                                    {formattedDate.compactTime}
                                  </span>
                                </div>
                              </td>
                              <td className='px-4 py-3'>
                                <div
                                  className={cn(
                                    'inline-flex items-center rounded-sm px-[6px] py-[2px] font-medium text-xs transition-all duration-200 lg:px-[8px]',
                                    log.level === 'error'
                                      ? 'bg-red-500 text-white'
                                      : 'bg-secondary text-card-foreground'
                                  )}
                                >
                                  {log.level}
                                </div>
                              </td>
                              <td className='px-4 py-3'>
                                <div className='truncate font-medium text-[13px]'>
                                  {log.workflow?.name || 'Unknown Workflow'}
                                </div>
                              </td>
                              <td className='px-4 py-3'>
                                <div className='font-medium text-muted-foreground text-xs'>
                                  {typeof (log as any)?.cost?.total === 'number'
                                    ? `$${((log as any).cost.total as number).toFixed(4)}`
                                    : '—'}
                                </div>
                              </td>
                              <td className='hidden px-4 py-3 xl:table-cell'>
                                {log.trigger ? (
                                  <div
                                    className={cn(
                                      'inline-flex items-center rounded-sm px-[6px] py-[2px] font-medium text-xs transition-all duration-200 lg:px-[8px]',
                                      log.trigger.toLowerCase() === 'manual'
                                        ? 'bg-secondary text-card-foreground'
                                        : 'text-white'
                                    )}
                                    style={
                                      log.trigger.toLowerCase() === 'manual'
                                        ? undefined
                                        : { backgroundColor: getTriggerColor(log.trigger) }
                                    }
                                  >
                                    {log.trigger}
                                  </div>
                                ) : (
                                  <div className='text-muted-foreground text-xs'>—</div>
                                )}
                              </td>
                              <td className='hidden px-4 py-3 text-muted-foreground text-xs xl:table-cell'>
                                {log.duration || '—'}
                              </td>
                            </tr>
                          )
                        })}

                        {hasMore && (
                          <tr>
                            <td colSpan={6} className='px-4 py-4'>
                              <div
                                ref={loaderRef}
                                className='flex items-center justify-center gap-2 text-muted-foreground'
                              >
                                {isFetchingMore ? (
                                  <>
                                    <Loader2 className='h-4 w-4 animate-spin' />
                                    <span className='text-sm'>Loading more...</span>
                                  </>
                                ) : (
                                  <span className='text-sm'>Scroll to load more</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  const showDetailsPanel = isSidebarOpen && !!selectedLog
  const leftPanelSize = panelLayout?.[0] ?? 60
  const rightPanelSize = panelLayout?.[1] ?? 40

  const logsLayout = (
    <div className='flex h-full min-h-0 max-h-full min-w-0 flex-col overflow-hidden'>
      <style jsx global>
        {selectedRowAnimation}
      </style>
      {showDetailsPanel ? (
        <ResizablePanelGroup
          direction='horizontal'
          className='flex flex-1 min-h-0 min-w-0 overflow-hidden'
          onLayout={(sizes) => setPanelLayout(sizes)}
        >
          <ResizablePanel
            order={1}
            defaultSize={leftPanelSize}
            minSize={50}
            className='flex h-full min-h-0 max-h-full min-w-0 flex-col p-1.5 overflow-hidden'
          >
            {tableContent}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            order={2}
            defaultSize={rightPanelSize}
            minSize={20}
            className='min-h-0 min-w-0 overflow-auto'
          >
            <Sidebar
              log={selectedLog}
              isOpen={isSidebarOpen}
              onClose={handleCloseSidebar}
              onNavigateNext={handleNavigateNext}
              onNavigatePrev={handleNavigatePrev}
              hasNext={selectedLogIndex < logs.length - 1}
              hasPrev={selectedLogIndex > 0}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        tableContent
      )}
    </div>
  )

  const header = (
    <GlobalNavbarHeader
      left={headerLeftContent}
      center={headerCenterContent}
      right={headerRightContent}
    />
  )

  if (isDashboardView) {
    return (
      <div className='flex h-full min-h-0 flex-col'>
        {header}
        <div className='min-h-0 flex-1 overflow-hidden'>
          <Dashboard />
        </div>
      </div>
    )
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      {header}
      <div className='min-h-0 flex-1 overflow-hidden'>{logsLayout}</div>
    </div>
  )
}
