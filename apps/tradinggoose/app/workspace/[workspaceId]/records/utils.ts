import {
  DEFAULT_ORDERS_FILTER_STATE,
  normalizeOrdersFilterState,
  type OrdersFilterState,
} from '@/lib/records/order-filters'

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

export const formatDate = (dateString: string, locale?: string) => {
  const date = new Date(dateString)
  return {
    full: date.toLocaleDateString(locale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }),
    time: date.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }),
    formatted: new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date),
    compact: new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date),
    compactDate: new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
    }).format(date),
    compactTime: new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date),
    relative: (() => {
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffMins = Math.floor(diffMs / 60000)
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

      if (diffMins < 1) return rtf.format(0, 'minute')
      if (diffMins < 60) return rtf.format(-diffMins, 'minute')

      const diffHours = Math.floor(diffMins / 60)
      if (diffHours < 24) return rtf.format(-diffHours, 'hour')

      const diffDays = Math.floor(diffHours / 24)
      if (diffDays === 1) return rtf.format(-1, 'day')
      if (diffDays < 7) return rtf.format(-diffDays, 'day')

      return new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
      }).format(date)
    })(),
  }
}
