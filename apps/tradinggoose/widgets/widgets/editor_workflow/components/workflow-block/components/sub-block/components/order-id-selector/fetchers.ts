import type { OrderHistorySearchOption } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/order-id-selector/types'

type SearchResponse = {
  data?: {
    results?: OrderHistorySearchOption[]
  } | null
  error?: {
    message?: string
  }
}

export async function fetchOrderHistorySearchOptions(
  params: {
    query?: string
    workspaceId: string
    limit?: number
  },
  signal?: AbortSignal
): Promise<OrderHistorySearchOption[]> {
  const query = new URLSearchParams()

  if (params.query?.trim()) {
    query.set('q', params.query.trim())
  }

  query.set('workspaceId', params.workspaceId.trim())

  query.set('limit', String(params.limit ?? 20))

  const response = await fetch(`/api/tools/trading/order-history/search?${query.toString()}`, {
    signal,
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as SearchResponse | null
    const message = payload?.error?.message ?? `Request failed with ${response.status}`
    throw new Error(message)
  }

  const payload = (await response.json()) as SearchResponse
  return payload.data?.results ?? []
}
