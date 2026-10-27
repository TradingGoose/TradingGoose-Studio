import { describe, expect, it } from 'vitest'
import { mergeWatchlistParams, sanitizeWatchlistParams } from '@/widgets/widgets/watchlist/contract'

describe('sanitizeWatchlistParams', () => {
  it.each([{ provider: 'finnhub' }, { provider: 'finnhub', auth: { apiKey: 'new-key' } }])(
    'clears old configuration when switching providers: %j',
    (incoming) => {
      expect(
        mergeWatchlistParams(
          {
            watchlistId: 'watchlist-1',
            provider: 'alpaca',
            auth: { apiKey: 'old-key', apiSecret: 'old-secret' },
            providerParams: { feed: 'sip' },
          },
          incoming
        )
      ).toEqual({ watchlistId: 'watchlist-1', ...incoming })
    }
  )

  it('preserves raw and env-var market auth', () => {
    expect(
      sanitizeWatchlistParams({
        provider: 'alpaca',
        watchlistId: 'watchlist-1',
        auth: {
          apiKey: 'raw-key',
          apiSecret: '{{ ALPACA_API_SECRET }}',
        },
      })
    ).toEqual({
      watchlistId: 'watchlist-1',
      provider: 'alpaca',
      auth: {
        apiKey: 'raw-key',
        apiSecret: '{{ ALPACA_API_SECRET }}',
      },
    })
  })

  it('merges runtime refresh updates against the latest sanitized params', async () => {
    expect(
      mergeWatchlistParams(
        {
          provider: 'alpaca',
          runtime: {
            refreshAt: 100,
          },
        },
        {
          watchlistId: 'watchlist-1',
          runtime: {
            refreshAt: 200,
          },
        }
      )
    ).toEqual({
      watchlistId: 'watchlist-1',
      provider: 'alpaca',
      runtime: {
        refreshAt: 200,
      },
    })
  })
})
