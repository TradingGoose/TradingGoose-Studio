import { describe, expect, it } from 'vitest'
import { getTradingOrderTypeFilterValues } from '@/providers/trading/order-types'
import {
  DEFAULT_ORDERS_FILTER_STATE,
  getOrderStatusRecordValues,
  getOrderTimeInForceRecordValues,
  normalizeOrderTimeInForceFilterValue,
  normalizeOrderSortByValue,
  normalizeOrderStatusFilterValue,
  normalizeOrdersFilterState,
  ORDER_SORT_BY_VALUES,
  ORDER_TYPE_FILTER_VALUES,
} from './order-filters'

describe('order filters', () => {
  it('normalizes invalid values to defaults', () => {
    expect(
      normalizeOrdersFilterState({
        provider: 'unknown',
        environment: 'prod',
        submissionSource: 'agent',
        status: 'accepted',
        side: 'short',
        orderType: 'unknown',
        timeInForce: 'month',
        linkedLog: 'maybe',
        orderSortBy: 'foo',
        orderSortOrder: 'up',
        startDate: 'not-a-date',
        endDate: 'not-a-date',
      })
    ).toEqual(DEFAULT_ORDERS_FILTER_STATE)
  })

  it('normalizes supported status variants', () => {
    expect(normalizeOrderStatusFilterValue('Open')).toBe('open')
    expect(normalizeOrderStatusFilterValue('PartiallyFilled')).toBe('partially_filled')
    expect(normalizeOrderStatusFilterValue('partiallyFilled')).toBe('partially_filled')
    expect(normalizeOrderStatusFilterValue('partially-filled')).toBe('partially_filled')
    expect(normalizeOrderStatusFilterValue('Filled')).toBe('filled')
    expect(normalizeOrderStatusFilterValue('Canceled')).toBe('canceled')
    expect(normalizeOrderStatusFilterValue('Expired')).toBe('expired')
    expect(normalizeOrderStatusFilterValue('Rejected')).toBe('rejected')
    expect(normalizeOrderStatusFilterValue('Failed')).toBe('failed')
    expect(normalizeOrderStatusFilterValue('Submitted')).toBe('')
    expect(normalizeOrderStatusFilterValue('Invalid')).toBe('')
    expect(getOrderStatusRecordValues('open')).toContain('submitted')
    expect(getOrderStatusRecordValues('rejected')).toContain('invalid')
  })

  it('derives order type filters from trading provider capabilities', () => {
    expect(ORDER_TYPE_FILTER_VALUES.slice(1)).toEqual(getTradingOrderTypeFilterValues())
  })

  it('maps provider-specific time in force values into canonical filters', () => {
    expect(normalizeOrderTimeInForceFilterValue('extended_hours')).toBe('extended_hours')
    expect(normalizeOrderTimeInForceFilterValue('pre')).toBe('')
    expect(normalizeOrderTimeInForceFilterValue('post')).toBe('')
    expect(getOrderTimeInForceRecordValues('extended_hours')).toEqual(['pre', 'post'])
  })

  it('preserves canonical camelCase order sort keys', () => {
    ORDER_SORT_BY_VALUES.forEach((sortBy) => {
      expect(normalizeOrderSortByValue(sortBy)).toBe(sortBy)
      expect(normalizeOrdersFilterState({ orderSortBy: sortBy }).orderSortBy).toBe(sortBy)
    })

    expect(normalizeOrderSortByValue('averagefillprice')).toBe('recordedAt')
  })
})
