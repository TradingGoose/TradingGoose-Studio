import { describe, expect, it } from 'vitest'
import { mergeWatchlistParams, sanitizeWatchlistParams } from '@/widgets/utils/watchlist-params'

describe('sanitizeWatchlistParams', () => {
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
      provider: 'alpaca',
      watchlistId: 'watchlist-1',
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
            ignored: 'value',
          },
          ignored: true,
        }
      )
    ).toEqual({
      provider: 'alpaca',
      watchlistId: 'watchlist-1',
      runtime: {
        refreshAt: 200,
      },
    })
  })
})
