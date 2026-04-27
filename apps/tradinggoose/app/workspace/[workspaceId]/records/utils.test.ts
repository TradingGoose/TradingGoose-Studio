/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest'
import {
  parseDuration,
  parseOrdersUrlState,
  parseRecordsTab,
  syncOrdersStateToUrl,
  syncRecordsTabToUrl,
} from './utils'

describe('logs utils', () => {
  it('reads only canonical durationMs values', () => {
    expect(parseDuration({ durationMs: 123, totalDurationMs: 999 })).toBe(123)
    expect(parseDuration({ durationMs: '456ms' })).toBeNull()
    expect(parseDuration({ totalDurationMs: 999 })).toBeNull()
  })
})

describe('records URL helpers', () => {
  it('defaults unknown tabs to orders', () => {
    expect(parseRecordsTab(null)).toBe('orders')
    expect(parseRecordsTab('orders')).toBe('orders')
    expect(parseRecordsTab('logs')).toBe('logs')
    expect(parseRecordsTab('stats')).toBe('stats')
    expect(parseRecordsTab('dashboard')).toBe('orders')
  })

  it('normalizes order URL state for every supported order filter', () => {
    const params = new URLSearchParams({
      environment: 'LIVE',
      linkedLog: 'true',
      orderSearch: ' AAPL ',
      orderSortBy: 'side',
      orderSortOrder: 'asc',
      orderType: 'stop-limit',
      provider: 'ALPACA',
      side: 'BUY',
      startDate: '2026-04-23T00:00:00.000Z',
      status: 'Partially Filled',
      submissionSource: 'WORKFLOW',
      timeInForce: 'GTC',
    })

    expect(parseOrdersUrlState(params)).toMatchObject({
      environment: 'live',
      linkedLog: 'true',
      orderSearch: 'AAPL',
      orderSortBy: 'side',
      orderSortOrder: 'asc',
      orderType: 'stop_limit',
      provider: 'alpaca',
      side: 'buy',
      startDate: '2026-04-23T00:00:00.000Z',
      status: 'partially_filled',
      submissionSource: 'workflow',
      timeInForce: 'gtc',
    })
  })

  it('syncs records tab while preserving order-owned query state and dropping stale view', () => {
    window.history.replaceState(
      {},
      '',
      '/workspace/ws-1/records?tab=orders&view=dashboard&orderSearch=AAPL&side=buy'
    )

    syncRecordsTabToUrl('logs')

    const params = new URLSearchParams(window.location.search)
    expect(params.get('tab')).toBe('logs')
    expect(params.get('orderSearch')).toBe('AAPL')
    expect(params.get('side')).toBe('buy')
    expect(params.has('view')).toBe(false)
  })

  it('syncs order state to compact non-default URL params without deleting logs filters', () => {
    window.history.replaceState(
      {},
      '',
      '/workspace/ws-1/records?tab=logs&view=dashboard&level=error'
    )

    syncOrdersStateToUrl({
      endDate: '',
      environment: '',
      linkedLog: '',
      orderSearch: 'AAPL',
      orderSortBy: 'recordedAt',
      orderSortOrder: 'desc',
      orderType: 'limit',
      provider: 'alpaca',
      side: 'buy',
      startDate: '',
      status: '',
      submissionSource: 'workflow',
      timeInForce: 'day',
    })

    const params = new URLSearchParams(window.location.search)
    expect(params.get('tab')).toBe('logs')
    expect(params.get('level')).toBe('error')
    expect(params.get('orderSearch')).toBe('AAPL')
    expect(params.get('provider')).toBe('alpaca')
    expect(params.get('submissionSource')).toBe('workflow')
    expect(params.get('side')).toBe('buy')
    expect(params.get('orderType')).toBe('limit')
    expect(params.get('timeInForce')).toBe('day')
    expect(params.has('view')).toBe(false)
  })
})
