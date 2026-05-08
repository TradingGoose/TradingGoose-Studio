import { format } from 'date-fns'
import {
  DEFAULT_ORDERS_FILTER_STATE,
  normalizeOrdersFilterState,
  type OrdersFilterState,
} from '@/lib/records/order-filters'
import type { CostMetadata, TraceSpan } from '@/stores/logs/filters/types'

export type RecordsTab = 'orders' | 'logs' | 'stats'
export type OrdersUrlState = OrdersFilterState

export function parseRecordsTab(value: string | null): RecordsTab {
  if (value === 'logs' || value === 'stats') return value
  return 'orders'
}

const getCurrentSearchParams = () => {
  if (typeof window === 'undefined') return new URLSearchParams()
  return new URLSearchParams(window.location.search)
}

const replaceCurrentUrlSearch = (params: URLSearchParams) => {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.search = params.toString()
  window.history.replaceState({}, '', url)
}

export function syncRecordsTabToUrl(tab: RecordsTab) {
  const params = getCurrentSearchParams()
  if (tab === 'orders') {
    params.delete('tab')
  } else {
    params.set('tab', tab)
  }
  replaceCurrentUrlSearch(params)
}

export function parseOrdersUrlState(params: URLSearchParams): OrdersUrlState {
  return normalizeOrdersFilterState({
    orderSearch: params.get('orderSearch'),
    orderSortBy: params.get('orderSortBy'),
    orderSortOrder: params.get('orderSortOrder'),
    provider: params.get('provider'),
    environment: params.get('environment'),
    submissionSource: params.get('submissionSource'),
    status: params.get('status'),
    side: params.get('side'),
    orderType: params.get('orderType'),
    timeInForce: params.get('timeInForce'),
    linkedLog: params.get('linkedLog'),
    startDate: params.get('startDate'),
    endDate: params.get('endDate'),
  })
}

const setParamWhenNonDefault = (
  params: URLSearchParams,
  key: keyof OrdersUrlState,
  value: string,
  defaultValue: string
) => {
  if (value && value !== defaultValue) {
    params.set(key, value)
  } else {
    params.delete(key)
  }
}

export function syncOrdersStateToUrl(state: OrdersUrlState) {
  const normalized = normalizeOrdersFilterState(state)
  const params = getCurrentSearchParams()

  const tab = params.get('tab')
  if (tab !== 'logs' && tab !== 'stats') {
    params.delete('tab')
  }

  setParamWhenNonDefault(
    params,
    'orderSearch',
    normalized.orderSearch,
    DEFAULT_ORDERS_FILTER_STATE.orderSearch
  )
  setParamWhenNonDefault(
    params,
    'orderSortBy',
    normalized.orderSortBy,
    DEFAULT_ORDERS_FILTER_STATE.orderSortBy
  )
  setParamWhenNonDefault(
    params,
    'orderSortOrder',
    normalized.orderSortOrder,
    DEFAULT_ORDERS_FILTER_STATE.orderSortOrder
  )
  setParamWhenNonDefault(
    params,
    'provider',
    normalized.provider,
    DEFAULT_ORDERS_FILTER_STATE.provider
  )
  setParamWhenNonDefault(
    params,
    'environment',
    normalized.environment,
    DEFAULT_ORDERS_FILTER_STATE.environment
  )
  setParamWhenNonDefault(
    params,
    'submissionSource',
    normalized.submissionSource,
    DEFAULT_ORDERS_FILTER_STATE.submissionSource
  )
  setParamWhenNonDefault(params, 'status', normalized.status, DEFAULT_ORDERS_FILTER_STATE.status)
  setParamWhenNonDefault(params, 'side', normalized.side, DEFAULT_ORDERS_FILTER_STATE.side)
  setParamWhenNonDefault(
    params,
    'orderType',
    normalized.orderType,
    DEFAULT_ORDERS_FILTER_STATE.orderType
  )
  setParamWhenNonDefault(
    params,
    'timeInForce',
    normalized.timeInForce,
    DEFAULT_ORDERS_FILTER_STATE.timeInForce
  )
  setParamWhenNonDefault(
    params,
    'linkedLog',
    normalized.linkedLog,
    DEFAULT_ORDERS_FILTER_STATE.linkedLog
  )
  setParamWhenNonDefault(
    params,
    'startDate',
    normalized.startDate,
    DEFAULT_ORDERS_FILTER_STATE.startDate
  )
  setParamWhenNonDefault(params, 'endDate', normalized.endDate, DEFAULT_ORDERS_FILTER_STATE.endDate)

  replaceCurrentUrlSearch(params)
}

/**
 * Parse duration from various log data formats
 */
export function parseDuration(log: any): number | null {
  let durationCandidate: number | null = null

  if (typeof log.durationMs === 'number') {
    durationCandidate = log.durationMs
  }

  return Number.isFinite(durationCandidate) ? durationCandidate : null
}

/**
 * Extract output from various sources in execution data
 * Checks multiple locations in priority order:
 * 1. executionData.finalOutput
 * 2. output (as string)
 * 3. executionData.traceSpans (iterates through spans)
 * 4. executionData.blockExecutions (last block)
 * 5. message (fallback)
 */
export function extractOutput(log: any): any {
  let output: any = null

  // Check finalOutput first
  if (log.executionData?.finalOutput !== undefined) {
    output = log.executionData.finalOutput
  }

  // Check direct output field
  if (typeof log.output === 'string') {
    output = log.output
  } else if (log.executionData?.traceSpans && Array.isArray(log.executionData.traceSpans)) {
    // Search through trace spans
    const spans: any[] = log.executionData.traceSpans
    for (let i = spans.length - 1; i >= 0; i--) {
      const s = spans[i]
      if (s?.output && Object.keys(s.output).length > 0) {
        output = s.output
        break
      }
      if (s?.status === 'error' && (s?.output?.error || s?.error)) {
        output = s.output?.error || s.error
        break
      }
    }
    // Fallback to executionData.output
    if (!output && log.executionData?.output) {
      output = log.executionData.output
    }
  }

  // Check block executions
  if (!output) {
    const blockExecutions = log.executionData?.blockExecutions
    if (Array.isArray(blockExecutions) && blockExecutions.length > 0) {
      const lastBlock = blockExecutions[blockExecutions.length - 1]
      output = lastBlock?.outputData || lastBlock?.errorMessage || null
    }
  }

  // Final fallback to message
  if (!output) {
    output = log.message || null
  }

  return output
}

function readFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  return undefined
}

function scaleCostValue(value: number, multiplier: number): number {
  return Number.parseFloat((value * multiplier).toFixed(8))
}

export function collectTraceSpanCostTotals(traceSpans?: TraceSpan[]) {
  const totals = {
    input: 0,
    output: 0,
    total: 0,
  }

  const visit = (spans?: TraceSpan[]) => {
    if (!Array.isArray(spans)) {
      return
    }

    for (const span of spans) {
      if (span.cost) {
        const input = readFiniteNumber(span.cost.input) ?? 0
        const output = readFiniteNumber(span.cost.output) ?? 0
        const total = readFiniteNumber(span.cost.total) ?? input + output

        totals.input += input
        totals.output += output
        totals.total += total
      }

      if (span.children?.length) {
        visit(span.children)
      }
    }
  }

  visit(traceSpans)
  return totals
}

function getStoredModelCostTotal(cost?: CostMetadata | null): number | undefined {
  if (!cost) {
    return undefined
  }

  const explicitModelCost = readFiniteNumber((cost as { modelCost?: unknown }).modelCost)
  if (explicitModelCost !== undefined) {
    return explicitModelCost
  }

  const input = readFiniteNumber(cost.input)
  const output = readFiniteNumber(cost.output)

  if (input !== undefined || output !== undefined) {
    return (input ?? 0) + (output ?? 0)
  }

  if (cost.models) {
    return Object.values(cost.models).reduce<number>((sum, modelCost) => {
      const modelTotal =
        readFiniteNumber(modelCost.total) ??
        (readFiniteNumber(modelCost.input) ?? 0) + (readFiniteNumber(modelCost.output) ?? 0)
      return sum + modelTotal
    }, 0)
  }

  return undefined
}

export function getTraceSpanDisplayCostMultiplier(
  traceSpans?: TraceSpan[],
  workflowCost?: CostMetadata | null
): number {
  const rawTotals = collectTraceSpanCostTotals(traceSpans)
  if (rawTotals.total <= 0) {
    return 1
  }

  const storedModelCostTotal = getStoredModelCostTotal(workflowCost)
  if (storedModelCostTotal === undefined) {
    return 1
  }

  const multiplier = storedModelCostTotal / rawTotals.total
  return Number.isFinite(multiplier) && multiplier >= 0 ? multiplier : 1
}

export function scaleLogCostBreakdown<
  T extends { input?: number; output?: number; total?: number },
>(cost: T | null | undefined, multiplier = 1): T | null | undefined {
  if (!cost) {
    return cost
  }

  if (!Number.isFinite(multiplier) || multiplier === 1) {
    return cost
  }

  const input = readFiniteNumber(cost.input)
  const output = readFiniteNumber(cost.output)
  const total =
    readFiniteNumber(cost.total) ??
    (input !== undefined || output !== undefined ? (input ?? 0) + (output ?? 0) : undefined)

  return {
    ...cost,
    ...(input !== undefined ? { input: scaleCostValue(input, multiplier) } : {}),
    ...(output !== undefined ? { output: scaleCostValue(output, multiplier) } : {}),
    ...(total !== undefined ? { total: scaleCostValue(total, multiplier) } : {}),
  }
}

export const formatDate = (dateString: string) => {
  const date = new Date(dateString)
  return {
    full: date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }),
    time: date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }),
    formatted: format(date, 'HH:mm:ss'),
    compact: format(date, 'MMM d HH:mm:ss'),
    compactDate: format(date, 'MMM d').toUpperCase(),
    compactTime: format(date, 'HH:mm:ss'),
    relative: (() => {
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffMins = Math.floor(diffMs / 60000)

      if (diffMins < 1) return 'just now'
      if (diffMins < 60) return `${diffMins}m ago`

      const diffHours = Math.floor(diffMins / 60)
      if (diffHours < 24) return `${diffHours}h ago`

      const diffDays = Math.floor(diffHours / 24)
      if (diffDays === 1) return 'yesterday'
      if (diffDays < 7) return `${diffDays}d ago`

      return format(date, 'MMM d')
    })(),
  }
}
