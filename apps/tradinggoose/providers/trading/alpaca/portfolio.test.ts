/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeAlpacaTradingAccount } from '@/providers/trading/alpaca/accounts'
import {
  buildAlpacaPerformanceQueryParams,
  getAlpacaTradingAccountPerformance,
  normalizeAlpacaPortfolioHistoryResponse,
} from '@/providers/trading/alpaca/performance'
import { getAlpacaTradingAccountSnapshot } from '@/providers/trading/alpaca/snapshot'

describe('Alpaca portfolio helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('normalizes account discovery metadata conservatively', () => {
    expect(
      normalizeAlpacaTradingAccount(
        {
          id: 'acct-live',
          account_number: 'PA12345',
          currency: 'usd',
          status: 'APPROVAL_PENDING',
        },
        'live'
      )
    ).toEqual({
      id: 'acct-live',
      name: 'Alpaca Live (PA12345)',
      type: 'unknown',
      baseCurrency: 'USD',
      status: 'restricted',
    })
  })

  it('builds snapshot totals from account and positions', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'acct-paper',
            account_number: 'PA-1',
            currency: 'USD',
            status: 'ACTIVE',
            cash: '2500',
            equity: '10000',
            portfolio_value: '10000',
            buying_power: '15000',
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              symbol: 'AAPL',
              asset_class: 'us_equity',
              side: 'long',
              qty: '10',
              avg_entry_price: '150',
              current_price: '160',
              market_value: '1600',
              unrealized_pl: '100',
              unrealized_plpc: '0.0666',
              cost_basis: '1500',
            },
          ]),
          { status: 200 }
        )
      )

    const snapshot = await getAlpacaTradingAccountSnapshot({
      providerId: 'alpaca',
      environment: 'paper',
      accessToken: 'token',
      accountId: 'acct-paper',
    })

    expect(snapshot.account.id).toBe('acct-paper')
    expect(snapshot.accountSummary).toMatchObject({
      totalCashValue: 2500,
      totalPortfolioValue: 10000,
      totalHoldingsValue: 7500,
      buyingPower: 15000,
      equity: 10000,
      totalUnrealizedPnl: 100,
    })
    expect(snapshot.cashBalances[0]?.amount).toBe(2500)
    expect(snapshot.positions).toHaveLength(1)
    expect(snapshot.extra).toBeUndefined()
  })

  it('preserves negative holdings value for net-short Alpaca snapshots', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'acct-short',
            account_number: 'PA-2',
            currency: 'USD',
            status: 'ACTIVE',
            cash: '12000',
            equity: '9000',
            portfolio_value: '9000',
            buying_power: '0',
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              symbol: 'GME',
              asset_class: 'us_equity',
              side: 'short',
              qty: '25',
              avg_entry_price: '120',
              current_price: '120',
              market_value: '3000',
              unrealized_pl: '0',
              unrealized_plpc: '0',
              cost_basis: '3000',
            },
          ]),
          { status: 200 }
        )
      )

    const snapshot = await getAlpacaTradingAccountSnapshot({
      providerId: 'alpaca',
      environment: 'paper',
      accessToken: 'token',
      accountId: 'acct-short',
    })

    expect(snapshot.accountSummary).toMatchObject({
      totalCashValue: 12000,
      totalPortfolioValue: 9000,
      totalHoldingsValue: -3000,
      totalUnrealizedPnl: 0,
      buyingPower: 0,
      equity: 9000,
    })
    expect(snapshot.positions[0]?.quantity).toBe(-25)
  })

  it('maps query windows and normalizes performance series', async () => {
    expect(buildAlpacaPerformanceQueryParams('YTD', new Date('2026-04-22T12:00:00.000Z'))).toEqual({
      start: '2026-01-01T00:00:00-05:00',
      timeframe: '1D',
    })
    expect(buildAlpacaPerformanceQueryParams('YTD', new Date('2026-01-01T03:00:00.000Z'))).toEqual({
      start: '2025-01-01T00:00:00-05:00',
      timeframe: '1D',
    })

    const normalized = normalizeAlpacaPortfolioHistoryResponse({
      history: {
        timestamp: [1710000100, 1710000000],
        equity: [110, 100],
      },
      currency: 'USD',
      window: '1W',
    })

    expect(normalized.series.map((point) => point.equity)).toEqual([100, 110])
    expect(normalized.summary).toMatchObject({
      currency: 'USD',
      startEquity: 100,
      endEquity: 110,
      highEquity: 110,
      lowEquity: 100,
      absoluteReturn: 10,
      percentReturn: 10,
    })
  })

  it('returns an explicit unavailable payload when Alpaca history has no usable arrays', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'acct-live',
            account_number: 'LIVE-1',
            currency: 'USD',
            status: 'ACTIVE',
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))

    const performance = await getAlpacaTradingAccountPerformance({
      providerId: 'alpaca',
      environment: 'live',
      accessToken: 'token',
      accountId: 'acct-live',
      window: '1W',
    })

    expect(performance.summary).toBeNull()
    expect(performance.series).toEqual([])
    expect(performance.unavailableReason).toBeTruthy()
  })
})
