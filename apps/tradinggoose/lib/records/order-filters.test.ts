import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ORDERS_FILTER_STATE,
  normalizeOrderStatusFilterValue,
  normalizeOrdersFilterState,
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
    expect(normalizeOrderStatusFilterValue('New')).toBe('new')
    expect(normalizeOrderStatusFilterValue('Submitted')).toBe('submitted')
    expect(normalizeOrderStatusFilterValue('PartiallyFilled')).toBe('partially_filled')
    expect(normalizeOrderStatusFilterValue('partiallyFilled')).toBe('partially_filled')
    expect(normalizeOrderStatusFilterValue('partially-filled')).toBe('partially_filled')
    expect(normalizeOrderStatusFilterValue('Filled')).toBe('filled')
    expect(normalizeOrderStatusFilterValue('Canceled')).toBe('canceled')
    expect(normalizeOrderStatusFilterValue('Invalid')).toBe('invalid')
    expect(normalizeOrderStatusFilterValue('Expired')).toBe('expired')
    expect(normalizeOrderStatusFilterValue('Rejected')).toBe('rejected')
  })
})
