import type { OrderHistorySearchOption } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/order-id-selector/types'

type SearchResponse = {
  data?:
    | {
        results?: OrderHistorySearchOption[] | OrderHistorySearchOption | null
      }
    | OrderHistorySearchOption[]
    | OrderHistorySearchOption
    | null
  error?: {
    message?: string
  }
}

const isResultContainer = (
  value: unknown
): value is {
  results?: OrderHistorySearchOption[] | OrderHistorySearchOption | null
} => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return 'results' in value
}

export async function fetchOrderHistorySearchOptions(
  params: {
    query?: string
    workflowId?: string | null
    limit?: number
  },
  signal?: AbortSignal
): Promise<OrderHistorySearchOption[]> {
  const query = new URLSearchParams()

  if (params.query?.trim()) {
    query.set('q', params.query.trim())
  }

  if (params.workflowId?.trim()) {
    query.set('workflowId', params.workflowId.trim())
  }

  query.set('limit', String(params.limit ?? 20))

  const response = await fetch(`/api/tools/trading/order-history/search?${query.toString()}`, {
    signal,
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as SearchResponse | null
    const message =
      payload?.error?.message ??
      (typeof payload?.error === 'string' ? payload.error : null) ??
      `Request failed with ${response.status}`
    throw new Error(message)
  }

  const payload = (await response.json()) as SearchResponse
  const rows = payload?.data

  if (!rows) return []

  if (Array.isArray(rows)) {
    return rows
  }

  if (isResultContainer(rows)) {
    const results = rows.results
    if (!results) return []
    return Array.isArray(results) ? results : [results]
  }

  return [rows as OrderHistorySearchOption]
}
