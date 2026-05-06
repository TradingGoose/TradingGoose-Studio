'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RefreshCw, Scroll } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { parseQuery, queryToApiParams } from '@/lib/logs/query-parser'
import { cn } from '@/lib/utils'
import { Dashboard } from '@/app/workspace/[workspaceId]/logs/components/dashboard'
import { LogDetails } from '@/app/workspace/[workspaceId]/logs/components/log-details/log-details'
import { LogsList } from '@/app/workspace/[workspaceId]/logs/components/logs-list'
import {
  AutocompleteSearch,
  LogsToolbar,
} from '@/app/workspace/[workspaceId]/logs/components/logs-toolbar'
import { useFolders } from '@/hooks/queries/folders'
import { useLogDetail, useLogsList } from '@/hooks/queries/logs'
import { useDebounce } from '@/hooks/use-debounce'
import { useFolderStore } from '@/stores/folders/store'
import { useFilterStore } from '@/stores/logs/filters/store'
import type { WorkflowLog } from '@/stores/logs/filters/types'

const LOGS_PER_PAGE = 50

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
    setWorkspaceId,
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
  }, [setWorkspaceId, workspaceId])

  const [selectedLog, setSelectedLog] = useState<WorkflowLog | null>(null)
  const [selectedLogIndex, setSelectedLogIndex] = useState(-1)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [panelLayout, setPanelLayout] = useState<number[] | null>(null)
  const selectedRowRef = useRef<HTMLTableRowElement | null>(null)
  const loaderRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isInitialized = useRef(false)
  const isSearchOpenRef = useRef(false)

  const [searchQuery, setSearchQuery] = useState(storeSearchQuery)
  const debouncedSearchQuery = useDebounce(searchQuery, 300)
  const [availableWorkflows, setAvailableWorkflows] = useState<string[]>([])
  const [availableFolders, setAvailableFolders] = useState<string[]>([])
  const [isLive, setIsLive] = useState(false)

  const logFilters = useMemo(
    () => ({
      timeRange,
      level,
      workflowIds,
      folderIds,
      triggers,
      searchQuery: debouncedSearchQuery,
      limit: LOGS_PER_PAGE,
    }),
    [debouncedSearchQuery, folderIds, level, timeRange, triggers, workflowIds]
  )

  const logsQuery = useLogsList(workspaceId, logFilters, {
    enabled: Boolean(workspaceId) && isInitialized.current,
    refetchInterval: isLive ? 5000 : false,
  })

  const logDetailQuery = useLogDetail(selectedLog?.id)

  const logs = useMemo(() => {
    if (!logsQuery.data?.pages) return []
    return logsQuery.data.pages.flatMap((page) => page.logs)
  }, [logsQuery.data?.pages])

  const detailedSelectedLog = logDetailQuery.data ?? selectedLog
  const hasMore = Boolean(logsQuery.hasNextPage)
  const isFetchingMore = logsQuery.isFetchingNextPage
  const loading = logsQuery.isLoading && !logsQuery.data
  const error =
    logsQuery.error instanceof Error
      ? logsQuery.error.message
      : logsQuery.error
        ? 'Failed to fetch logs'
        : null

  useEffect(() => {
    setSearchQuery(storeSearchQuery)
  }, [storeSearchQuery])

  const { getFolderTree } = useFolderStore()
  const foldersQuery = useFolders(workspaceId)

  useEffect(() => {
    let cancelled = false

    const fetchSuggestions = async () => {
      if (!workspaceId) {
        setAvailableWorkflows([])
        setAvailableFolders([])
        return
      }

      try {
        const res = await fetch(`/api/workflows?workspaceId=${encodeURIComponent(workspaceId)}`)

        if (res.ok) {
          const body = await res.json()
          const names: string[] = Array.isArray(body?.data)
            ? body.data.map((workflow: any) => workflow?.name).filter(Boolean)
            : []
          if (!cancelled) setAvailableWorkflows(names)
        } else if (!cancelled) {
          setAvailableWorkflows([])
        }

        const tree = getFolderTree(workspaceId)
        const flatten = (nodes: any[], parentPath = ''): string[] => {
          const paths: string[] = []

          for (const node of nodes) {
            const path = parentPath ? `${parentPath} / ${node.name}` : node.name
            paths.push(path)
            if (node.children?.length) {
              paths.push(...flatten(node.children, path))
            }
          }

          return paths
        }

        if (!cancelled) {
          setAvailableFolders(Array.isArray(tree) ? flatten(tree) : [])
        }
      } catch {
        if (!cancelled) {
          setAvailableWorkflows([])
          setAvailableFolders([])
        }
      }
    }

    void fetchSuggestions()

    return () => {
      cancelled = true
    }
  }, [foldersQuery.data, getFolderTree, workspaceId])

  useEffect(() => {
    if (isInitialized.current && debouncedSearchQuery !== storeSearchQuery) {
      setStoreSearchQuery(debouncedSearchQuery)
    }
  }, [debouncedSearchQuery, setStoreSearchQuery, storeSearchQuery])

  useEffect(() => {
    if (!isInitialized.current) {
      isInitialized.current = true
      initializeFromURL()
    }
  }, [initializeFromURL])

  useEffect(() => {
    const handlePopState = () => initializeFromURL()

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [initializeFromURL])

  useEffect(() => {
    if (selectedRowRef.current) {
      selectedRowRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    }
  }, [selectedLogIndex])

  const fetchNextPage = logsQuery.fetchNextPage

  const loadMoreLogs = useCallback(() => {
    if (isFetchingMore || !hasMore) return
    void fetchNextPage()
  }, [fetchNextPage, hasMore, isFetchingMore])

  useEffect(() => {
    if (loading || !hasMore) return

    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    const handleScroll = () => {
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
  }, [hasMore, isFetchingMore, loadMoreLogs, loading])

  useEffect(() => {
    const currentLoaderRef = loaderRef.current
    const scrollContainer = scrollContainerRef.current

    if (!currentLoaderRef || !scrollContainer || loading || !hasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry?.isIntersecting) return

        const { scrollTop, scrollHeight, clientHeight } = scrollContainer
        const scrollPercentage = (scrollTop / (scrollHeight - clientHeight)) * 100

        if (scrollPercentage > 70 && !isFetchingMore) {
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
  }, [hasMore, isFetchingMore, loadMoreLogs, loading])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isSearchOpenRef.current || logs.length === 0) return

      if (selectedLogIndex === -1 && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault()
        setSelectedLogIndex(0)
        setSelectedLog(logs[0] ?? null)
        return
      }

      if (event.key === 'ArrowUp' && !event.metaKey && !event.ctrlKey && selectedLogIndex > 0) {
        event.preventDefault()
        const prevIndex = selectedLogIndex - 1
        setSelectedLogIndex(prevIndex)
        setSelectedLog(logs[prevIndex] ?? null)
      }

      if (
        event.key === 'ArrowDown' &&
        !event.metaKey &&
        !event.ctrlKey &&
        selectedLogIndex < logs.length - 1
      ) {
        event.preventDefault()
        const nextIndex = selectedLogIndex + 1
        setSelectedLogIndex(nextIndex)
        setSelectedLog(logs[nextIndex] ?? null)
      }

      if (event.key === 'Enter' && selectedLog) {
        event.preventDefault()
        setIsSidebarOpen((current) => !current)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [logs, selectedLog, selectedLogIndex])

  const handleLogClick = useCallback(
    (log: WorkflowLog) => {
      setSelectedLog(log)
      setSelectedLogIndex(logs.findIndex((entry) => entry.id === log.id))
      setIsSidebarOpen(true)
    },
    [logs]
  )

  const handleNavigateNext = useCallback(() => {
    if (selectedLogIndex < logs.length - 1) {
      const nextIndex = selectedLogIndex + 1
      setSelectedLogIndex(nextIndex)
      setSelectedLog(logs[nextIndex] ?? null)
    }
  }, [logs, selectedLogIndex])

  const handleNavigatePrev = useCallback(() => {
    if (selectedLogIndex > 0) {
      const prevIndex = selectedLogIndex - 1
      setSelectedLogIndex(prevIndex)
      setSelectedLog(logs[prevIndex] ?? null)
    }
  }, [logs, selectedLogIndex])

  const handleCloseSidebar = useCallback(() => {
    setIsSidebarOpen(false)
    setSelectedLog(null)
    setSelectedLogIndex(-1)
  }, [])

  const handleRefresh = useCallback(async () => {
    await logsQuery.refetch()
  }, [logsQuery])

  const handleExport = useCallback(() => {
    const params = new URLSearchParams()
    params.set('workspaceId', workspaceId)

    if (level !== 'all') params.set('level', level)
    if (triggers.length > 0) params.set('triggers', triggers.join(','))
    if (workflowIds.length > 0) params.set('workflowIds', workflowIds.join(','))
    if (folderIds.length > 0) params.set('folderIds', folderIds.join(','))

    const parsed = parseQuery(debouncedSearchQuery)
    const extra = queryToApiParams(parsed)
    Object.entries(extra).forEach(([key, value]) => params.set(key, value))

    const url = `/api/logs/export?${params.toString()}`
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'logs_export.csv'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }, [debouncedSearchQuery, folderIds, level, triggers, workflowIds, workspaceId])

  const isDashboardView = viewMode === 'dashboard'
  const isRefreshing = logsQuery.isRefetching
  const showDetailsPanel = isSidebarOpen && Boolean(selectedLog)

  const header = (
    <LogsToolbar
      left={
        isDashboardView ? null : (
          <div className='flex w-full flex-1 items-center gap-3'>
            <div className='hidden items-center gap-2 sm:flex'>
              <Scroll className='h-[18px] w-[18px] text-muted-foreground' />
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
      }
      center={
        isDashboardView ? null : (
          <div className='flex flex-wrap items-center justify-center gap-3'>
            <div className='inline-flex h-9 items-center gap-1 rounded-md border bg-muted p-1 shadow-sm'>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => setIsLive((current) => !current)}
                className={cn(
                  'h-7 rounded-sm px-3 font-normal text-xs',
                  isLive
                    ? 'bg-primary text-black shadow-[0_0_0_0_var(--primary)] hover:bg-primary-hover hover:text-black'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                aria-pressed={isLive}
              >
                Live
              </Button>
            </div>

            <div className='inline-flex h-9 items-center gap-1 rounded-md border bg-muted p-1 shadow-sm'>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => setViewMode('logs')}
                className={cn(
                  'h-7 rounded-sm px-3 font-normal text-xs',
                  viewMode === 'logs'
                    ? 'bg-background text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                aria-pressed={viewMode === 'logs'}
              >
                Logs
              </Button>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => setViewMode('dashboard')}
                className={cn(
                  'h-7 rounded-sm px-3 font-normal text-xs',
                  'text-muted-foreground hover:text-foreground'
                )}
                aria-pressed={false}
              >
                Dashboard
              </Button>
            </div>
          </div>
        )
      }
      right={
        <div className='flex flex-wrap items-center gap-3'>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                onClick={() => void handleRefresh()}
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
      }
    />
  )

  const tableContent = (
    <LogsList
      logs={logs}
      selectedLogId={selectedLog?.id ?? null}
      onLogClick={handleLogClick}
      loading={loading}
      error={error}
      hasMore={hasMore}
      isFetchingMore={isFetchingMore}
      loaderRef={loaderRef}
      scrollContainerRef={scrollContainerRef}
      selectedRowRef={selectedRowRef}
    />
  )

  const logsLayout = (
    <div className='flex h-full max-h-full min-h-0 min-w-0 flex-col overflow-hidden'>
      <style jsx global>
        {selectedRowAnimation}
      </style>
      {showDetailsPanel ? (
        <ResizablePanelGroup
          direction='horizontal'
          className='flex min-h-0 min-w-0 flex-1 overflow-hidden'
          onLayout={(sizes) => setPanelLayout(sizes)}
        >
          <ResizablePanel
            order={1}
            defaultSize={panelLayout?.[0] ?? 60}
            minSize={50}
            className='flex h-full max-h-full min-h-0 min-w-0 flex-col overflow-hidden'
          >
            {tableContent}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            order={2}
            defaultSize={panelLayout?.[1] ?? 40}
            minSize={20}
            className='min-h-0 min-w-0 overflow-auto'
          >
            <LogDetails
              log={detailedSelectedLog}
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
