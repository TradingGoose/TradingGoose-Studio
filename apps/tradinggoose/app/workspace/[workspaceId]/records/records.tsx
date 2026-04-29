'use client'

import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Database, Download, Filter, Loader2, RefreshCw, Search } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { LOGS_QUERY_POLICY } from '@/lib/logs/query-policy'
import type { FolderData, WorkflowData } from '@/lib/logs/search-suggestions'
import {
  DEFAULT_ORDERS_FILTER_STATE,
  normalizeOrdersFilterState,
  type OrdersFilterState,
} from '@/lib/records/order-filters'
import { cn } from '@/lib/utils'
import { LogDetails } from '@/app/workspace/[workspaceId]/records/components/log-details/log-details'
import { LogsList } from '@/app/workspace/[workspaceId]/records/components/logs-list'
import {
  AutocompleteSearch,
  LogsToolbar,
} from '@/app/workspace/[workspaceId]/records/components/logs-toolbar'
import {
  OrderFilterMenu,
  OrderDetails,
  OrderFilters,
  OrdersTable,
  type RecordsOrder,
  type RecordsOrderDetailMode,
} from '@/app/workspace/[workspaceId]/records/components/orders'
import { Stats } from '@/app/workspace/[workspaceId]/records/components/stats'
import { LogsFilters as StatsLogFilters } from '@/app/workspace/[workspaceId]/records/components/stats/components/logs-filters/logs-filters'
import {
  parseOrdersUrlState,
  parseRecordsTab,
  type RecordsTab,
  syncOrdersStateToUrl,
  syncRecordsTabToUrl,
} from '@/app/workspace/[workspaceId]/records/utils'
import { useFolders } from '@/hooks/queries/folders'
import { buildLogsRequestParams, useLogDetail, useLogsList } from '@/hooks/queries/logs'
import {
  buildOrdersRequestParams,
  useOrderDetail,
  useOrdersList,
} from '@/hooks/queries/records-orders'
import { useDebounce } from '@/hooks/use-debounce'
import { useFolderStore } from '@/stores/folders/store'
import { useFilterStore } from '@/stores/logs/filters/store'
import type { WorkflowLog } from '@/stores/logs/filters/types'

const PAGE_SIZE = 50

const selectedRowAnimation = `
  @keyframes borderPulse {
    0% { border-left-color: hsl(var(--primary) / 0.3) }
    50% { border-left-color: hsl(var(--primary) / 0.7) }
    100% { border-left-color: hsl(var(--primary) / 0.5) }
  }
  .selected-row {
    animation: borderPulse 1s ease-in-out;
    border-left-color: hsl(var(--primary) / 0.5);
  }
`

export default function Records() {
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
  } = useFilterStore()

  const isInitialized = useRef(false)
  const [urlHydrated, setUrlHydrated] = useState(false)
  const [activeTab, setActiveTab] = useState<RecordsTab>('orders')
  const [ordersState, setOrdersState] = useState<OrdersFilterState>(DEFAULT_ORDERS_FILTER_STATE)
  const [orderSearchInput, setOrderSearchInput] = useState('')
  const debouncedOrderSearch = useDebounce(orderSearchInput, 300)

  const [selectedOrder, setSelectedOrder] = useState<RecordsOrder | null>(null)
  const [selectedOrderIndex, setSelectedOrderIndex] = useState(-1)
  const [isOrderDetailOpen, setIsOrderDetailOpen] = useState(false)
  const [orderDetailMode, setOrderDetailMode] = useState<RecordsOrderDetailMode>('order')
  const ordersLoaderRef = useRef<HTMLDivElement | null>(null)
  const ordersScrollContainerRef = useRef<HTMLDivElement | null>(null)
  const selectedOrderRowRef = useRef<HTMLTableRowElement | null>(null)

  const [selectedLog, setSelectedLog] = useState<WorkflowLog | null>(null)
  const [selectedLogIndex, setSelectedLogIndex] = useState(-1)
  const [isLogDetailOpen, setIsLogDetailOpen] = useState(false)
  const logsLoaderRef = useRef<HTMLDivElement | null>(null)
  const logsScrollContainerRef = useRef<HTMLDivElement | null>(null)
  const selectedLogRowRef = useRef<HTMLTableRowElement | null>(null)

  const [panelLayout, setPanelLayout] = useState<number[] | null>(null)
  const isSearchOpenRef = useRef(false)
  const [logSearchQuery, setLogSearchQuery] = useState(storeSearchQuery)
  const debouncedLogSearchQuery = useDebounce(logSearchQuery, 300)
  const [availableWorkflows, setAvailableWorkflows] = useState<WorkflowData[]>([])
  const [availableFolders, setAvailableFolders] = useState<FolderData[]>([])
  const [isLive, setIsLive] = useState(false)
  const [statsSearchQuery, setStatsSearchQuery] = useState('')
  const [statsLive, setStatsLive] = useState(false)
  const [statsRefreshRequest, setStatsRefreshRequest] = useState(0)
  const [statsIsRefetching, setStatsIsRefetching] = useState(false)

  useEffect(() => {
    setWorkspaceId(workspaceId)
    setSelectedOrder(null)
    setSelectedOrderIndex(-1)
    setIsOrderDetailOpen(false)
    setSelectedLog(null)
    setSelectedLogIndex(-1)
    setIsLogDetailOpen(false)
  }, [setWorkspaceId, workspaceId])

  useEffect(() => {
    if (isInitialized.current) return

    const params = new URLSearchParams(window.location.search)
    const initialTab = parseRecordsTab(params.get('tab'))
    const initialOrdersState = parseOrdersUrlState(params)

    initializeFromURL()
    setActiveTab(initialTab)
    setOrdersState(initialOrdersState)
    setOrderSearchInput(initialOrdersState.orderSearch)
    isInitialized.current = true
    setUrlHydrated(true)
  }, [initializeFromURL])

  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search)
      initializeFromURL()
      const nextOrdersState = parseOrdersUrlState(params)
      setActiveTab(parseRecordsTab(params.get('tab')))
      setOrdersState(nextOrdersState)
      setOrderSearchInput(nextOrdersState.orderSearch)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [initializeFromURL])

  useEffect(() => {
    if (!urlHydrated || !isInitialized.current) return
    syncRecordsTabToUrl(activeTab)
  }, [activeTab, urlHydrated])

  useEffect(() => {
    if (!urlHydrated || !isInitialized.current) return
    syncOrdersStateToUrl(ordersState)
  }, [ordersState, urlHydrated])

  const updateOrdersState = useCallback((patch: Partial<OrdersFilterState>) => {
    setOrdersState((current) => normalizeOrdersFilterState({ ...current, ...patch }))
  }, [])

  useEffect(() => {
    if (!urlHydrated || debouncedOrderSearch === ordersState.orderSearch) return
    updateOrdersState({ orderSearch: debouncedOrderSearch })
  }, [debouncedOrderSearch, ordersState.orderSearch, updateOrdersState, urlHydrated])

  useEffect(() => {
    setLogSearchQuery(storeSearchQuery)
  }, [storeSearchQuery])

  useEffect(() => {
    if (urlHydrated && debouncedLogSearchQuery !== storeSearchQuery) {
      setStoreSearchQuery(debouncedLogSearchQuery)
    }
  }, [debouncedLogSearchQuery, setStoreSearchQuery, storeSearchQuery, urlHydrated])

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
          const workflowData: WorkflowData[] = Array.isArray(body?.data)
            ? body.data
                .filter((workflow: any) => workflow?.id && workflow?.name)
                .map((workflow: any) => ({
                  id: workflow.id,
                  name: workflow.name,
                  description: workflow.description ?? undefined,
                }))
            : []
          if (!cancelled) setAvailableWorkflows(workflowData)
        } else if (!cancelled) {
          setAvailableWorkflows([])
        }

        const tree = getFolderTree(workspaceId)
        const flatten = (nodes: any[], parentPath = ''): FolderData[] => {
          const paths: FolderData[] = []
          for (const node of nodes) {
            const path = parentPath ? `${parentPath} / ${node.name}` : node.name
            paths.push({ id: node.id ?? path, name: path })
            if (node.children?.length) paths.push(...flatten(node.children, path))
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

  const normalizedOrdersState = useMemo(
    () => normalizeOrdersFilterState(ordersState),
    [ordersState]
  )

  const ordersQuery = useOrdersList(workspaceId, normalizedOrdersState, {
    enabled: Boolean(workspaceId) && urlHydrated && activeTab === 'orders',
    limit: PAGE_SIZE,
  })

  const orders = useMemo(
    () => ordersQuery.data?.pages.flatMap((page) => page.orders) ?? [],
    [ordersQuery.data?.pages]
  )
  const ordersTotal = ordersQuery.data?.pages.at(-1)?.total ?? 0
  const ordersHasMore = Boolean(ordersQuery.hasNextPage)
  const ordersLoading = ordersQuery.isLoading && !ordersQuery.data
  const ordersError =
    ordersQuery.error instanceof Error
      ? ordersQuery.error.message
      : ordersQuery.error
        ? 'Failed to fetch orders'
        : null

  const orderDetailQuery = useOrderDetail(workspaceId, selectedOrder?.id)
  const orderLogDetailQuery = useLogDetail(
    selectedOrder?.workflowLogId && isOrderDetailOpen ? selectedOrder.workflowLogId : undefined
  )

  useEffect(() => {
    if (!urlHydrated || !selectedOrder) return

    const currentIndex = orders.findIndex((entry) => entry.id === selectedOrder.id)
    if (currentIndex >= 0) {
      if (selectedOrderIndex !== currentIndex) {
        setSelectedOrderIndex(currentIndex)
      }
      if (orders[currentIndex] !== selectedOrder) {
        setSelectedOrder(orders[currentIndex]!)
      }
      return
    }

    if (ordersQuery.data && !ordersQuery.isFetching && !ordersHasMore) {
      setSelectedOrder(null)
      setSelectedOrderIndex(-1)
      setIsOrderDetailOpen(false)
    }
  }, [
    orders,
    ordersHasMore,
    ordersQuery.data,
    ordersQuery.isFetching,
    selectedOrder,
    selectedOrderIndex,
    urlHydrated,
  ])

  const logFilters = useMemo(
    () => ({
      timeRange,
      level,
      workflowIds,
      folderIds,
      triggers,
      searchQuery: debouncedLogSearchQuery,
      limit: PAGE_SIZE,
      queryPolicy: LOGS_QUERY_POLICY,
      queryPolicyKey: 'logs' as const,
    }),
    [debouncedLogSearchQuery, folderIds, level, timeRange, triggers, workflowIds]
  )

  const logsQuery = useLogsList(workspaceId, logFilters, {
    enabled: Boolean(workspaceId) && urlHydrated && activeTab === 'logs',
    refetchInterval: activeTab === 'logs' && isLive ? 5000 : false,
  })
  const logDetailQuery = useLogDetail(selectedLog?.id)

  const logs = useMemo(
    () => logsQuery.data?.pages.flatMap((page) => page.logs) ?? [],
    [logsQuery.data?.pages]
  )
  const logsHasMore = Boolean(logsQuery.hasNextPage)
  const logsLoading = logsQuery.isLoading && !logsQuery.data
  const logsError =
    logsQuery.error instanceof Error
      ? logsQuery.error.message
      : logsQuery.error
        ? 'Failed to fetch logs'
        : null

  useEffect(() => {
    if (activeTab === 'orders' && selectedOrderRowRef.current) {
      selectedOrderRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [activeTab, selectedOrderIndex])

  useEffect(() => {
    if (activeTab === 'logs' && selectedLogRowRef.current) {
      selectedLogRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [activeTab, selectedLogIndex])

  const loadMoreOrders = useCallback(() => {
    if (ordersQuery.isFetchingNextPage || !ordersHasMore) return
    void ordersQuery.fetchNextPage()
  }, [ordersHasMore, ordersQuery])

  const loadMoreLogs = useCallback(() => {
    if (logsQuery.isFetchingNextPage || !logsHasMore) return
    void logsQuery.fetchNextPage()
  }, [logsHasMore, logsQuery])

  useEffect(() => {
    if (activeTab !== 'orders' || ordersLoading || !ordersHasMore) return
    const scrollContainer = ordersScrollContainerRef.current
    if (!scrollContainer) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer
      const scrollPercentage = (scrollTop / Math.max(1, scrollHeight - clientHeight)) * 100
      if (scrollPercentage > 60) loadMoreOrders()
    }

    scrollContainer.addEventListener('scroll', handleScroll)
    return () => scrollContainer.removeEventListener('scroll', handleScroll)
  }, [activeTab, loadMoreOrders, ordersHasMore, ordersLoading])

  useEffect(() => {
    if (activeTab !== 'orders' || ordersLoading || !ordersHasMore) return
    const loader = ordersLoaderRef.current
    const scrollContainer = ordersScrollContainerRef.current
    if (!loader || !scrollContainer) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMoreOrders()
      },
      { root: scrollContainer, threshold: 0.1, rootMargin: '200px 0px 0px 0px' }
    )

    observer.observe(loader)
    return () => observer.unobserve(loader)
  }, [activeTab, loadMoreOrders, ordersHasMore, ordersLoading])

  useEffect(() => {
    if (activeTab !== 'logs' || logsLoading || !logsHasMore) return
    const scrollContainer = logsScrollContainerRef.current
    if (!scrollContainer) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer
      const scrollPercentage = (scrollTop / Math.max(1, scrollHeight - clientHeight)) * 100
      if (scrollPercentage > 60) loadMoreLogs()
    }

    scrollContainer.addEventListener('scroll', handleScroll)
    return () => scrollContainer.removeEventListener('scroll', handleScroll)
  }, [activeTab, loadMoreLogs, logsHasMore, logsLoading])

  useEffect(() => {
    if (activeTab !== 'logs' || logsLoading || !logsHasMore) return
    const loader = logsLoaderRef.current
    const scrollContainer = logsScrollContainerRef.current
    if (!loader || !scrollContainer) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMoreLogs()
      },
      { root: scrollContainer, threshold: 0.1, rootMargin: '200px 0px 0px 0px' }
    )

    observer.observe(loader)
    return () => observer.unobserve(loader)
  }, [activeTab, loadMoreLogs, logsHasMore, logsLoading])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement
      const isEditable =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement?.hasAttribute('contenteditable')
      if (isEditable || isSearchOpenRef.current || activeTab === 'stats') return

      if (activeTab === 'orders') {
        if (orders.length === 0) return
        if (selectedOrderIndex === -1 && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault()
          setSelectedOrderIndex(0)
          setSelectedOrder(orders[0] ?? null)
          return
        }
        if (event.key === 'ArrowUp' && selectedOrderIndex > 0) {
          event.preventDefault()
          const nextIndex = selectedOrderIndex - 1
          setSelectedOrderIndex(nextIndex)
          setSelectedOrder(orders[nextIndex] ?? null)
        }
        if (event.key === 'ArrowDown' && selectedOrderIndex < orders.length - 1) {
          event.preventDefault()
          const nextIndex = selectedOrderIndex + 1
          setSelectedOrderIndex(nextIndex)
          setSelectedOrder(orders[nextIndex] ?? null)
        }
        if (event.key === 'Enter' && selectedOrder) {
          event.preventDefault()
          setIsOrderDetailOpen((current) => !current)
        }
        return
      }

      if (logs.length === 0) return
      if (selectedLogIndex === -1 && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault()
        setSelectedLogIndex(0)
        setSelectedLog(logs[0] ?? null)
        return
      }
      if (event.key === 'ArrowUp' && selectedLogIndex > 0) {
        event.preventDefault()
        const nextIndex = selectedLogIndex - 1
        setSelectedLogIndex(nextIndex)
        setSelectedLog(logs[nextIndex] ?? null)
      }
      if (event.key === 'ArrowDown' && selectedLogIndex < logs.length - 1) {
        event.preventDefault()
        const nextIndex = selectedLogIndex + 1
        setSelectedLogIndex(nextIndex)
        setSelectedLog(logs[nextIndex] ?? null)
      }
      if (event.key === 'Enter' && selectedLog) {
        event.preventDefault()
        setIsLogDetailOpen((current) => !current)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeTab, logs, orders, selectedLog, selectedLogIndex, selectedOrder, selectedOrderIndex])

  const selectOrder = useCallback(
    (order: RecordsOrder, mode: RecordsOrderDetailMode = order.workflowLogId ? 'log' : 'order') => {
      setSelectedOrder(order)
      setSelectedOrderIndex(orders.findIndex((entry) => entry.id === order.id))
      setOrderDetailMode(mode)
      setIsOrderDetailOpen(true)
    },
    [orders]
  )

  const selectLog = useCallback(
    (log: WorkflowLog) => {
      setSelectedLog(log)
      setSelectedLogIndex(logs.findIndex((entry) => entry.id === log.id))
      setIsLogDetailOpen(true)
    },
    [logs]
  )

  const handleOrderSortChange = useCallback(
    (orderSortBy: OrdersFilterState['orderSortBy']) => {
      updateOrdersState({
        orderSortBy,
        orderSortOrder:
          normalizedOrdersState.orderSortBy === orderSortBy &&
          normalizedOrdersState.orderSortOrder === 'desc'
            ? 'asc'
            : 'desc',
      })
    },
    [normalizedOrdersState.orderSortBy, normalizedOrdersState.orderSortOrder, updateOrdersState]
  )

  const handleRefresh = useCallback(async () => {
    if (activeTab === 'orders') {
      await ordersQuery.refetch()
    } else if (activeTab === 'logs') {
      await logsQuery.refetch()
    }
  }, [activeTab, logsQuery, ordersQuery])

  const handleStatsRefresh = useCallback(() => {
    setStatsRefreshRequest((current) => current + 1)
  }, [])

  const resetOrdersFilters = useCallback(() => {
    setOrderSearchInput('')
    setOrdersState(DEFAULT_ORDERS_FILTER_STATE)
  }, [])

  const handleExport = useCallback(() => {
    const anchor = document.createElement('a')
    if (activeTab === 'orders') {
      const queryParams = buildOrdersRequestParams(workspaceId, normalizedOrdersState, {
        includePagination: false,
      })
      anchor.href = `/api/orders/export?${queryParams}`
      anchor.download = 'orders_export.csv'
    } else if (activeTab === 'logs') {
      const queryParams = buildLogsRequestParams(
        workspaceId,
        {
          timeRange,
          level,
          workflowIds,
          folderIds,
          triggers,
          searchQuery: logSearchQuery,
          limit: PAGE_SIZE,
          queryPolicy: LOGS_QUERY_POLICY,
          queryPolicyKey: 'logs',
        },
        { includePagination: false, includeDetails: false }
      )
      anchor.href = `/api/logs/export?${queryParams}`
      anchor.download = 'logs_export.csv'
    } else {
      return
    }
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }, [
    activeTab,
    folderIds,
    level,
    logSearchQuery,
    normalizedOrdersState,
    timeRange,
    triggers,
    workflowIds,
    workspaceId,
  ])

  const tabButton = (tab: RecordsTab, label: string) => (
    <Button
      key={tab}
      variant='ghost'
      size='sm'
      onClick={() => setActiveTab(tab)}
      className={cn(
        'h-7 rounded-sm px-3 font-normal text-xs',
        activeTab === tab
          ? 'bg-background text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      )}
      aria-pressed={activeTab === tab}
    >
      {label}
    </Button>
  )

  const header = (
    <LogsToolbar
      left={
        <div className='flex min-w-0 flex-1 items-center gap-3'>
          <div className='hidden shrink-0 items-center gap-2 sm:flex'>
            <Database className='h-[18px] w-[18px] text-muted-foreground' />
            <span className='font-medium text-sm'>Records</span>
          </div>
          {activeTab === 'orders' ? (
            <OrderFilters
              searchValue={orderSearchInput}
              onSearchChange={setOrderSearchInput}
            />
          ) : activeTab === 'logs' ? (
            <AutocompleteSearch
              value={logSearchQuery}
              onChange={setLogSearchQuery}
              queryPolicy={LOGS_QUERY_POLICY}
              placeholder='Search logs...'
              workflowsData={availableWorkflows}
              foldersData={availableFolders}
              className='w-full'
              onOpenChange={(open) => {
                isSearchOpenRef.current = open
              }}
              showActiveFilters={false}
              showTextSearchIndicator={false}
            />
          ) : activeTab === 'stats' ? (
            <div className='flex w-full flex-1'>
              <div className='relative flex h-9 w-full items-center rounded-md border border-border bg-card/60 px-2 text-sm transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring'>
                <Search className='mr-2 h-4 w-4 flex-shrink-0 text-muted-foreground' />
                <input
                  value={statsSearchQuery}
                  onChange={(event) => setStatsSearchQuery(event.target.value)}
                  placeholder='Search workflows'
                  className='h-full min-w-[120px] flex-1 bg-transparent outline-none placeholder:text-muted-foreground'
                  autoComplete='off'
                  autoCorrect='off'
                  autoCapitalize='off'
                  spellCheck='false'
                />
              </div>
            </div>
          ) : null}
        </div>
      }
      center={
        <div className='inline-flex h-9 items-center gap-1 rounded-md border bg-muted p-1 shadow-sm'>
          {tabButton('orders', 'Orders')}
          {tabButton('logs', 'Logs')}
          {tabButton('stats', 'Stats')}
        </div>
      }
      right={
        <div className='flex items-center gap-2'>
          {activeTab === 'orders' ? (
            <OrderFilterMenu
              state={normalizedOrdersState}
              searchValue={orderSearchInput}
              loadedCount={orders.length}
              totalCount={ordersTotal}
              onChange={updateOrdersState}
              onReset={resetOrdersFilters}
            />
          ) : activeTab === 'logs' ? (
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setIsLive((current) => !current)}
              className={cn(
                'h-9 rounded-md px-3 font-normal text-xs',
                isLive
                  ? 'bg-primary text-black hover:bg-primary-hover hover:text-black'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              aria-pressed={isLive}
            >
              Live
            </Button>
          ) : activeTab === 'stats' ? (
            <>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant='outline'
                    size='sm'
                    className='h-9 gap-2 rounded-md border-border bg-background px-3'
                  >
                    <Filter className='h-4 w-4' />
                    <span className='hidden lg:inline'>Filters</span>
                    <span className='sr-only lg:hidden'>Filters</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className='w-[320px] p-0' align='end'>
                  <div className='h-[360px]'>
                    <StatsLogFilters />
                  </div>
                </PopoverContent>
              </Popover>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => setStatsLive((current) => !current)}
                className={cn(
                  'h-9 rounded-md px-3 font-normal text-xs',
                  statsLive
                    ? 'bg-primary text-black hover:bg-primary-hover hover:text-black'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                aria-pressed={statsLive}
              >
                Live
              </Button>
            </>
          ) : null}
          {activeTab === 'stats' ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={handleStatsRefresh}
                  className='h-9 rounded-md hover:bg-secondary'
                  disabled={statsIsRefetching}
                >
                  {statsIsRefetching ? (
                    <Loader2 className='h-5 w-5 animate-spin' />
                  ) : (
                    <RefreshCw className='h-5 w-5' />
                  )}
                  <span className='sr-only'>Refresh stats</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{statsIsRefetching ? 'Refreshing...' : 'Refresh'}</TooltipContent>
            </Tooltip>
          ) : (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='icon'
                    onClick={() => void handleRefresh()}
                    className='h-9 rounded-md hover:bg-secondary'
                    disabled={ordersQuery.isRefetching || logsQuery.isRefetching}
                  >
                    {ordersQuery.isRefetching || logsQuery.isRefetching ? (
                      <Loader2 className='h-5 w-5 animate-spin' />
                    ) : (
                      <RefreshCw className='h-5 w-5' />
                    )}
                    <span className='sr-only'>Refresh</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Refresh</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='icon'
                    onClick={handleExport}
                    className='h-9 rounded-md hover:bg-secondary'
                  >
                    <Download className='h-5 w-5' />
                    <span className='sr-only'>Export CSV</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Export CSV</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      }
    />
  )

  const orderContent = (
    <OrdersTable
      orders={orders}
      total={ordersTotal}
      selectedOrderId={selectedOrder?.id ?? null}
      loading={ordersLoading}
      error={ordersError}
      hasMore={ordersHasMore}
      isFetchingMore={ordersQuery.isFetchingNextPage}
      sortBy={normalizedOrdersState.orderSortBy}
      sortOrder={normalizedOrdersState.orderSortOrder}
      onSortChange={handleOrderSortChange}
      onOrderClick={selectOrder}
      onOpenOrder={(order) => selectOrder(order, 'order')}
      onOpenLog={(order) => selectOrder(order, 'log')}
      onOpenProvider={(order) => selectOrder(order, 'provider')}
      loaderRef={ordersLoaderRef}
      scrollContainerRef={ordersScrollContainerRef}
      selectedRowRef={selectedOrderRowRef}
    />
  )

  const logsContent = (
    <LogsList
      logs={logs}
      selectedLogId={selectedLog?.id ?? null}
      onLogClick={selectLog}
      loading={logsLoading}
      error={logsError}
      hasMore={logsHasMore}
      isFetchingMore={logsQuery.isFetchingNextPage}
      loaderRef={logsLoaderRef}
      scrollContainerRef={logsScrollContainerRef}
      selectedRowRef={selectedLogRowRef}
    />
  )

  const renderWithPanel = (primary: React.ReactNode, detail: React.ReactNode, open: boolean) => {
    if (!open) return primary
    return (
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
          {primary}
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel order={2} defaultSize={panelLayout?.[1] ?? 40} minSize={20}>
          {detail}
        </ResizablePanel>
      </ResizablePanelGroup>
    )
  }

  const ordersLayout = renderWithPanel(
    orderContent,
    selectedOrder ? (
      <OrderDetails
        workspaceId={workspaceId}
        order={selectedOrder}
        detail={orderDetailQuery.data ?? null}
        detailsLoading={orderDetailQuery.isLoading && !orderDetailQuery.data}
        detailsError={
          orderDetailQuery.error instanceof Error
            ? orderDetailQuery.error.message
            : orderDetailQuery.error
              ? 'Failed to load order detail'
              : null
        }
        linkedLog={orderLogDetailQuery.data ?? null}
        linkedLogLoading={orderLogDetailQuery.isLoading && !orderLogDetailQuery.data}
        linkedLogError={
          orderLogDetailQuery.error instanceof Error
            ? orderLogDetailQuery.error.message
            : orderLogDetailQuery.error
              ? 'Failed to load workflow log'
              : null
        }
        mode={orderDetailMode}
        onModeChange={setOrderDetailMode}
        onClose={() => setIsOrderDetailOpen(false)}
        onNavigateNext={() => {
          if (selectedOrderIndex < orders.length - 1) selectOrder(orders[selectedOrderIndex + 1]!)
        }}
        onNavigatePrev={() => {
          if (selectedOrderIndex > 0) selectOrder(orders[selectedOrderIndex - 1]!)
        }}
        hasNext={selectedOrderIndex < orders.length - 1}
        hasPrev={selectedOrderIndex > 0}
        onRetryDetails={() => void orderDetailQuery.refetch()}
        onRetryLog={() => void orderLogDetailQuery.refetch()}
      />
    ) : null,
    isOrderDetailOpen && Boolean(selectedOrder)
  )

  const logsLayout = renderWithPanel(
    logsContent,
    selectedLog && logDetailQuery.data ? (
      <LogDetails
        log={logDetailQuery.data}
        isOpen={isLogDetailOpen}
        onClose={() => setIsLogDetailOpen(false)}
        onNavigateNext={() => {
          if (selectedLogIndex < logs.length - 1) selectLog(logs[selectedLogIndex + 1]!)
        }}
        onNavigatePrev={() => {
          if (selectedLogIndex > 0) selectLog(logs[selectedLogIndex - 1]!)
        }}
        hasNext={selectedLogIndex < logs.length - 1}
        hasPrev={selectedLogIndex > 0}
      />
    ) : (
      <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
        {logDetailQuery.isLoading ? 'Loading log details...' : 'Log details unavailable'}
      </div>
    ),
    isLogDetailOpen && Boolean(selectedLog)
  )

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <style jsx global>
        {selectedRowAnimation}
      </style>
      {header}
      <div className='min-h-0 flex-1 overflow-hidden'>
        {activeTab === 'orders' ? (
          ordersLayout
        ) : activeTab === 'logs' ? (
          logsLayout
        ) : (
          <Stats
            searchQuery={statsSearchQuery}
            live={statsLive}
            refreshRequest={statsRefreshRequest}
            onRefetchingChange={setStatsIsRefetching}
          />
        )}
      </div>
    </div>
  )
}
