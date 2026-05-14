import { getTradingOrderTypeFilterValues } from '@/providers/trading/order-types'

export const ORDER_SORT_BY_VALUES = [
  'recordedAt',
  'submittedAt',
  'listing',
  'provider',
  'environment',
  'status',
  'side',
  'orderType',
  'quantity',
  'filledQuantity',
  'averageFillPrice',
] as const

export const ORDER_SORT_ORDER_VALUES = ['asc', 'desc'] as const
export const ORDER_PROVIDER_FILTER_VALUES = ['', 'alpaca', 'tradier'] as const
export const ORDER_ENVIRONMENT_FILTER_VALUES = ['', 'paper', 'live'] as const
export const ORDER_SUBMISSION_SOURCE_FILTER_VALUES = ['', 'manual', 'copilot', 'workflow'] as const
export const ORDER_STATUS_FILTER_VALUES = [
  '',
  'open',
  'partially_filled',
  'filled',
  'canceled',
  'expired',
  'rejected',
  'failed',
] as const
export const ORDER_SIDE_FILTER_VALUES = ['', 'buy', 'sell'] as const
export const ORDER_TYPE_FILTER_VALUES = ['', ...getTradingOrderTypeFilterValues()] as const
export const ORDER_TIME_IN_FORCE_FILTER_VALUES = [
  '',
  'day',
  'gtc',
  'ioc',
  'fok',
  'extended_hours',
] as const
export const ORDER_LINKED_LOG_FILTER_VALUES = ['', 'true', 'false'] as const

export type OrderSortBy = (typeof ORDER_SORT_BY_VALUES)[number]
export type OrderSortOrder = (typeof ORDER_SORT_ORDER_VALUES)[number]
export type OrderProviderFilter = (typeof ORDER_PROVIDER_FILTER_VALUES)[number]
export type OrderEnvironmentFilter = (typeof ORDER_ENVIRONMENT_FILTER_VALUES)[number]
export type OrderSubmissionSourceFilter = (typeof ORDER_SUBMISSION_SOURCE_FILTER_VALUES)[number]
export type OrderStatusFilter = (typeof ORDER_STATUS_FILTER_VALUES)[number]
export type OrderSideFilter = (typeof ORDER_SIDE_FILTER_VALUES)[number]
export type OrderTypeFilter = (typeof ORDER_TYPE_FILTER_VALUES)[number]
export type OrderTimeInForceFilter = (typeof ORDER_TIME_IN_FORCE_FILTER_VALUES)[number]
export type OrderLinkedLogFilter = (typeof ORDER_LINKED_LOG_FILTER_VALUES)[number]

export type OrdersFilterState = {
  orderSearch: string
  orderSortBy: OrderSortBy
  orderSortOrder: OrderSortOrder
  provider: OrderProviderFilter
  environment: OrderEnvironmentFilter
  submissionSource: OrderSubmissionSourceFilter
  status: OrderStatusFilter
  side: OrderSideFilter
  orderType: OrderTypeFilter
  timeInForce: OrderTimeInForceFilter
  linkedLog: OrderLinkedLogFilter
  startDate: string
  endDate: string
}

const ORDER_STATUS_RECORD_VALUES: Record<Exclude<OrderStatusFilter, ''>, readonly string[]> = {
  open: [
    'new',
    'pending',
    'pending_new',
    'submitted',
    'accepted',
    'pending_review',
    'accepted_for_bidding',
    'stopped',
    'suspended',
    'calculated',
    'pending_replace',
    'replaced',
    'pending_cancel',
    'done_for_day',
    'open',
  ],
  partially_filled: ['partially_filled', 'partial'],
  filled: ['filled', 'complete', 'completed', 'executed'],
  canceled: ['canceled', 'cancelled'],
  expired: ['expired'],
  rejected: ['rejected', 'invalid'],
  failed: ['failed'],
}

const ORDER_TIME_IN_FORCE_RECORD_VALUES: Record<
  Exclude<OrderTimeInForceFilter, ''>,
  readonly string[]
> = {
  day: ['day'],
  gtc: ['gtc'],
  ioc: ['ioc'],
  fok: ['fok'],
  extended_hours: ['pre', 'post'],
}

export const getOrderStatusRecordValues = (
  status: Exclude<OrderStatusFilter, ''>
): readonly string[] => ORDER_STATUS_RECORD_VALUES[status]

export const getOrderTimeInForceRecordValues = (
  timeInForce: Exclude<OrderTimeInForceFilter, ''>
): readonly string[] => ORDER_TIME_IN_FORCE_RECORD_VALUES[timeInForce]

export const DEFAULT_ORDERS_FILTER_STATE: OrdersFilterState = {
  orderSearch: '',
  orderSortBy: 'recordedAt',
  orderSortOrder: 'desc',
  provider: '',
  environment: '',
  submissionSource: '',
  status: '',
  side: '',
  orderType: '',
  timeInForce: '',
  linkedLog: '',
  startDate: '',
  endDate: '',
}

const normalizeToken = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : ''

const normalizeChoice = <T extends readonly string[]>(
  value: unknown,
  allowed: T,
  defaultValue: T[number]
): T[number] => {
  const normalized = normalizeToken(value)
  return (allowed as readonly string[]).includes(normalized)
    ? (normalized as T[number])
    : defaultValue
}

export const normalizeOrderSearchValue = (value: unknown) =>
  typeof value === 'string' ? value.trim() : ''

export function normalizeOrderSortByValue(value: unknown): OrderSortBy {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return (ORDER_SORT_BY_VALUES as readonly string[]).includes(normalized)
    ? (normalized as OrderSortBy)
    : 'recordedAt'
}

export const normalizeOrderSortOrderValue = (value: unknown): OrderSortOrder =>
  normalizeChoice(value, ORDER_SORT_ORDER_VALUES, 'desc')

export const normalizeOrderProviderFilterValue = (value: unknown): OrderProviderFilter =>
  normalizeChoice(value, ORDER_PROVIDER_FILTER_VALUES, '')

export const normalizeOrderEnvironmentFilterValue = (value: unknown): OrderEnvironmentFilter =>
  normalizeChoice(value, ORDER_ENVIRONMENT_FILTER_VALUES, '')

export const normalizeOrderSubmissionSourceFilterValue = (
  value: unknown
): OrderSubmissionSourceFilter => normalizeChoice(value, ORDER_SUBMISSION_SOURCE_FILTER_VALUES, '')

export function normalizeOrderStatusFilterValue(value: unknown): OrderStatusFilter {
  const normalized =
    typeof value === 'string'
      ? value
          .trim()
          .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
          .replace(/[\s-]+/g, '_')
          .toLowerCase()
      : ''

  return (ORDER_STATUS_FILTER_VALUES as readonly string[]).includes(normalized)
    ? (normalized as OrderStatusFilter)
    : ''
}

export const normalizeOrderSideFilterValue = (value: unknown): OrderSideFilter =>
  normalizeChoice(value, ORDER_SIDE_FILTER_VALUES, '')

export const normalizeOrderTypeFilterValue = (value: unknown): OrderTypeFilter =>
  normalizeChoice(normalizeToken(value).replace(/[\s-]+/g, '_'), ORDER_TYPE_FILTER_VALUES, '')

export const normalizeOrderTimeInForceFilterValue = (value: unknown): OrderTimeInForceFilter =>
  normalizeChoice(value, ORDER_TIME_IN_FORCE_FILTER_VALUES, '')

export const normalizeOrderLinkedLogFilterValue = (value: unknown): OrderLinkedLogFilter =>
  normalizeChoice(value, ORDER_LINKED_LOG_FILTER_VALUES, '')

export function normalizeOrderDateFilterValue(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  return Number.isFinite(new Date(trimmed).getTime()) ? trimmed : ''
}

export function normalizeOrdersFilterState(
  input: Partial<Record<keyof OrdersFilterState, unknown>>
) {
  return {
    orderSearch: normalizeOrderSearchValue(input.orderSearch),
    orderSortBy: normalizeOrderSortByValue(input.orderSortBy),
    orderSortOrder: normalizeOrderSortOrderValue(input.orderSortOrder),
    provider: normalizeOrderProviderFilterValue(input.provider),
    environment: normalizeOrderEnvironmentFilterValue(input.environment),
    submissionSource: normalizeOrderSubmissionSourceFilterValue(input.submissionSource),
    status: normalizeOrderStatusFilterValue(input.status),
    side: normalizeOrderSideFilterValue(input.side),
    orderType: normalizeOrderTypeFilterValue(input.orderType),
    timeInForce: normalizeOrderTimeInForceFilterValue(input.timeInForce),
    linkedLog: normalizeOrderLinkedLogFilterValue(input.linkedLog),
    startDate: normalizeOrderDateFilterValue(input.startDate),
    endDate: normalizeOrderDateFilterValue(input.endDate),
  } satisfies OrdersFilterState
}
