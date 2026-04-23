/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeTradierTradingAccount } from '@/providers/trading/tradier/accounts'
import {
  getTradierTradingAccountPerformance,
  mapTradierPerformanceWindow,
  normalizeTradierHistoricalBalancesResponse,
} from '@/providers/trading/tradier/performance'
import { getTradierTradingAccountSnapshot } from '@/providers/trading/tradier/snapshot'

describe('Tradier portfolio helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('normalizes profile accounts for selector display', () => {
    expect(
      normalizeTradierTradingAccount({
        account_number: 'ACC-123',
        classification: 'Individual',
        type: 'margin',
        status: 'active',
      })
    ).toEqual({
      id: 'ACC-123',
      name: 'Individual (ACC-123)',
      type: 'margin',
      baseCurrency: 'USD',
      status: 'active',
    })
  })

  it('builds snapshot totals from balances and positions with the documented fallback ladder', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            balances: {
              account_number: 'ACC-123',
              account_type: 'cash',
              total_cash: '1200',
              total_equity: '5400',
              equity: '5400',
              market_value: '4200',
              open_pl: '250',
              close_pl: '40',
              current_requirement: '0',
            },
            margin: {
              stock_buying_power: '6000',
            },
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            positions: {
              position: [
                {
                  symbol: 'MSFT',
                  quantity: '20',
                  market_value: '4200',
                  cost_basis: '3950',
                  date_acquired: '2026-01-10',
                },
              ],
            },
          }),
          { status: 200 }
        )
      )

    const snapshot = await getTradierTradingAccountSnapshot({
      providerId: 'tradier',
      environment: 'live',
      accessToken: 'token',
      accountId: 'ACC-123',
    })

    expect(snapshot.accountSummary).toMatchObject({
      totalCashValue: 1200,
      totalHoldingsValue: 4200,
      totalPortfolioValue: 5400,
      equity: 5400,
      buyingPower: 6000,
      totalRealizedPnl: 40,
      totalUnrealizedPnl: 250,
    })
    expect(snapshot.positions).toHaveLength(1)
    expect(snapshot.extra).toBeUndefined()
  })

  it('maps supported windows and normalizes Tradier history rows', () => {
    expect(mapTradierPerformanceWindow('MAX')).toBe('ALL')

    const performance = normalizeTradierHistoricalBalancesResponse({
      historyResponse: {
        history: {
          day: [
            { date: '2026-04-22', value: '12000' },
            { date: '2026-04-20', value: '10000' },
          ],
        },
      },
      window: '1M',
    })

    expect(performance.series.map((point) => point.timestamp)).toEqual([
      '2026-04-20T12:00:00.000Z',
      '2026-04-22T12:00:00.000Z',
    ])
    expect(performance.series.map((point) => point.equity)).toEqual([10000, 12000])
    expect(performance.summary).toMatchObject({
      currency: 'USD',
      startEquity: 10000,
      endEquity: 12000,
      absoluteReturn: 2000,
      percentReturn: 20,
    })
  })

  it('returns an explicit unavailable payload for Tradier paper performance in v1', async () => {
    const performance = await getTradierTradingAccountPerformance({
      providerId: 'tradier',
      environment: 'paper',
      accessToken: 'token',
      accountId: 'ACC-123',
      window: '1M',
    })

    expect(performance.summary).toBeNull()
    expect(performance.series).toEqual([])
    expect(performance.unavailableReason).toBe(
      'Tradier paper performance is not implemented in portfolio_snapshot v1'
    )
  })
})
