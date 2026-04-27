import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { OrdersFilterState } from '@/lib/records/order-filters'

export const recordsOrderKeys = {
  all: ['records-orders'] as const,
  lists: () => [...recordsOrderKeys.all, 'list'] as const,
  list: (workspaceId: string | undefined, filters: OrdersFilterState, limit: number) =>
    [...recordsOrderKeys.lists(), workspaceId ?? '', filters, limit] as const,
  details: () => [...recordsOrderKeys.all, 'detail'] as const,
  detail: (workspaceId: string | undefined, orderId: string | undefined) =>
    [...recordsOrderKeys.details(), workspaceId ?? '', orderId ?? ''] as const,
  providerDetail: (
    workspaceId: string | undefined,
    orderId: string | undefined,
    credentialId: string | undefined,
    environment: string | undefined,
    accountId: string | undefined
  ) =>
    [
      ...recordsOrderKeys.details(),
      'provider',
      workspaceId ?? '',
      orderId ?? '',
      credentialId ?? '',
      environment ?? '',
      accountId ?? '',
    ] as const,
}

export const orderKeys = recordsOrderKeys

export type RecordsOrder = {
  id: string
  workspaceId: string
  provider: string
  environment: string | null
  recordedAt: string
  submissionSource: string
  workflowId: string | null
  workflowExecutionId: string | null
  workflowLogId: string | null
  listing: { symbol: string | null; name: string | null; listingType: string | null }
  listingIdentity?: unknown
  providerOrderId: string | null
  clientOrderId: string | null
  accountId: string | null
  side: string | null
  status: string | null
  orderType: string | null
  timeInForce: string | null
  quantity: number | string | null
  filledQuantity: number | string | null
  remainingQuantity: number | string | null
  notional: number | string | null
  submittedPrice: number | string | null
  fillPrice: number | string | null
  averageFillPrice: number | string | null
  fee: number | string | null
  submittedAt: string | null
  updatedAt: string | null
  filledAt: string | null
  canceledAt?: string | null
  expiredAt?: string | null
  message: string | null
  hasLinkedLog: boolean
  linkedLog: {
    id: string
    executionId: string | null
    workflowName: string | null
    level: string | null
    startedAt: string | null
    endedAt: string | null
  } | null
  request?: unknown
  response?: unknown
  normalizedOrder?: unknown
}

type RecordsOrdersResponse = {
  data: RecordsOrder[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export function buildOrdersRequestParams(
  workspaceId: string,
  filters: OrdersFilterState,
  options?: { page?: number; limit?: number; includePagination?: boolean }
) {
  const limit = options?.limit ?? 50
  const page = options?.page ?? 1
  const params = new URLSearchParams()
  params.set('workspaceId', workspaceId)
  if (options?.includePagination ?? true) {
    params.set('limit', String(limit))
    params.set('offset', String((page - 1) * limit))
  }
  if (filters.orderSearch) params.set('search', filters.orderSearch)
  if (filters.orderSortBy !== 'recordedAt') params.set('sortBy', filters.orderSortBy)
  if (filters.orderSortOrder !== 'desc') params.set('sortOrder', filters.orderSortOrder)
  if (filters.provider) params.set('provider', filters.provider)
  if (filters.environment) params.set('environment', filters.environment)
  if (filters.submissionSource) params.set('submissionSource', filters.submissionSource)
  if (filters.status) params.set('status', filters.status)
  if (filters.side) params.set('side', filters.side)
  if (filters.orderType) params.set('orderType', filters.orderType)
  if (filters.timeInForce) params.set('timeInForce', filters.timeInForce)
  if (filters.linkedLog) params.set('linkedLog', filters.linkedLog)
  if (filters.startDate) params.set('startDate', filters.startDate)
  if (filters.endDate) params.set('endDate', filters.endDate)
  return params.toString()
}

async function fetchOrdersPage(
  workspaceId: string,
  filters: OrdersFilterState,
  page: number,
  limit: number
) {
  const response = await fetch(
    `/api/records/orders?${buildOrdersRequestParams(workspaceId, filters, { page, limit })}`
  )
  if (!response.ok) throw new Error('Failed to fetch order records')
  const data = (await response.json()) as RecordsOrdersResponse
  const hasMore = data.data.length === limit && data.page < data.totalPages
  return {
    orders: data.data,
    total: data.total,
    hasMore,
    nextPage: hasMore ? page + 1 : undefined,
  }
}

export function useRecordsOrdersList(
  workspaceId: string | undefined,
  filters: OrdersFilterState,
  options?: { enabled?: boolean; limit?: number }
) {
  const limit = options?.limit ?? 50
  return useInfiniteQuery({
    queryKey: recordsOrderKeys.list(workspaceId, filters, limit),
    queryFn: ({ pageParam }) => fetchOrdersPage(workspaceId as string, filters, pageParam, limit),
    enabled: Boolean(workspaceId) && (options?.enabled ?? true),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage,
  })
}

export const useOrdersList = useRecordsOrdersList

export function useRecordsOrderDetail(
  workspaceId: string | undefined,
  orderId: string | undefined
) {
  return useQuery({
    queryKey: recordsOrderKeys.detail(workspaceId, orderId),
    queryFn: async () => {
      const response = await fetch(
        `/api/records/orders/${orderId}?workspaceId=${encodeURIComponent(workspaceId as string)}`
      )
      if (!response.ok) throw new Error('Failed to fetch order detail')
      const { data } = await response.json()
      return data as RecordsOrder
    },
    enabled: Boolean(workspaceId && orderId),
  })
}

export const useOrderDetail = useRecordsOrderDetail

export function useProviderOrderDetail(params: {
  workspaceId: string | undefined
  orderId: string | undefined
  credentialId: string | undefined
  environment: string | undefined
  accountId?: string | undefined
  enabled?: boolean
}) {
  return useQuery({
    queryKey: recordsOrderKeys.providerDetail(
      params.workspaceId,
      params.orderId,
      params.credentialId,
      params.environment,
      params.accountId
    ),
    queryFn: async () => {
      const response = await fetch(
        `/api/records/orders/${params.orderId}/provider-detail?workspaceId=${encodeURIComponent(
          params.workspaceId as string
        )}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            credentialId: params.credentialId,
            environment: params.environment,
            accountId: params.accountId,
          }),
        }
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to fetch provider order detail')
      }
      return payload
    },
    enabled: Boolean(
      params.workspaceId &&
        params.orderId &&
        params.credentialId &&
        params.environment &&
        (params.enabled ?? true)
    ),
  })
}
