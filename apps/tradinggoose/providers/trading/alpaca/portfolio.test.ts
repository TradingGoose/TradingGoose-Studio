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
import { getTradingPortfolioSupportedWindows } from '@/providers/trading/portfolio'

const { resolveTradingListingIdentityMock } = vi.hoisted(() => ({
  resolveTradingListingIdentityMock: vi.fn(),
}))

vi.mock('@/providers/trading/listing-resolution', () => ({
  resolveTradingListingIdentity: (...args: unknown[]) => resolveTradingListingIdentityMock(...args),
}))

describe('Alpaca portfolio helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    resolveTradingListingIdentityMock.mockImplementation((symbol: { base: string }) => ({
      listing_id: symbol.base,
      base_id: '',
      quote_id: '',
      listing_type: 'default',
    }))
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
          multiplier: '1',
        },
        {
          providerId: 'alpaca',
          credentialId: 'credential-1',
          credentialServiceId: 'alpaca-live',
        }
      )
    ).toEqual({
      providerId: 'alpaca',
      credentialId: 'credential-1',
      credentialServiceId: 'alpaca-live',
      accountId: 'acct-live',
      providerName: 'Alpaca',
      accountName: 'Alpaca (PA12345)',
      accountType: 'cash',
      baseCurrency: 'USD',
      accountStatus: 'restricted',
    })
  })

  it('maps Alpaca margin indicators to a margin account type', () => {
    expect(
      normalizeAlpacaTradingAccount(
        {
          id: 'acct-margin',
          account_number: 'PA67890',
          currency: 'USD',
          status: 'ACTIVE',
          multiplier: '4',
          shorting_enabled: true,
        },
        {
          providerId: 'alpaca',
          credentialId: 'credential-1',
          credentialServiceId: 'alpaca-live',
        }
      )
    ).toMatchObject({
      accountId: 'acct-margin',
      accountName: 'Alpaca (PA67890)',
      accountType: 'margin',
      baseCurrency: 'USD',
      accountStatus: 'active',
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
            multiplier: '2',
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
      credentialId: 'credential-1',
      credentialServiceId: 'alpaca-live',
      environment: 'live',
      accessToken: 'token',
      accountId: 'acct-paper',
    })

    expect(snapshot.accountId).toBe('acct-paper')
    expect(snapshot.summary).toMatchObject({
      totalCashValue: 2500,
      totalPortfolioValue: 10000,
      totalHoldingsValue: 7500,
      buyingPower: 15000,
      equity: 10000,
      totalUnrealizedPnl: 100,
    })
    expect(snapshot.cashBalances[0]?.amount).toBe(2500)
    expect(snapshot.positions).toHaveLength(1)
    expect(snapshot.positions[0]?.symbol.listing).toEqual({
      listing_id: 'AAPL',
      base_id: '',
      quote_id: '',
      listing_type: 'default',
    })
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
            multiplier: '2',
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
      credentialId: 'credential-1',
      credentialServiceId: 'alpaca-live',
      environment: 'live',
      accessToken: 'token',
      accountId: 'acct-short',
    })

    expect(snapshot.summary).toMatchObject({
      totalCashValue: 12000,
      totalPortfolioValue: 9000,
      totalHoldingsValue: -3000,
      totalUnrealizedPnl: 0,
      buyingPower: 0,
      equity: 9000,
    })
    expect(snapshot.positions[0]?.quantity).toBe(-25)
    expect(snapshot.positions[0]?.symbol.listing).toEqual({
      listing_id: 'GME',
      base_id: '',
      quote_id: '',
      listing_type: 'default',
    })
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
            multiplier: '2',
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))

    const performance = await getAlpacaTradingAccountPerformance({
      providerId: 'alpaca',
      credentialId: 'credential-1',
      credentialServiceId: 'alpaca-live',
      environment: 'live',
      accessToken: 'token',
      accountId: 'acct-live',
      window: '1W',
    })

    expect(performance.summary).toBeNull()
    expect(performance.series).toEqual([])
    expect(performance.unavailableReason).toBeTruthy()
  })

  it('returns an explicit unavailable payload for unsupported Alpaca windows', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>

    const performance = await getAlpacaTradingAccountPerformance({
      providerId: 'alpaca',
      credentialId: 'credential-1',
      credentialServiceId: 'alpaca-live',
      environment: 'live',
      accessToken: 'token',
      accountId: 'acct-live',
      window: 'MAX',
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(performance).toEqual({
      window: 'MAX',
      supportedWindows: getTradingPortfolioSupportedWindows('alpaca'),
      series: [],
      summary: null,
      unavailableReason: 'Alpaca performance window MAX is not supported',
    })
  })
})
