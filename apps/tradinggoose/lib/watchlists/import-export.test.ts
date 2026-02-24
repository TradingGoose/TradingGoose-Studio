import { describe, expect, it } from 'vitest'
import {
  exportWatchlistItemsAsText,
  parseWatchlistImportText,
  splitExchangeSymbol,
} from '@/lib/watchlists/import-export'

describe('watchlist import/export', () => {
  it('parses comma and newline separated tokens and deduplicates values', () => {
    const result = parseWatchlistImportText('NASDAQ:AAPL,NYSE:MSFT\nnasdaq:aapl\n BINANCE:BTCUSDT ')

    expect(result).toEqual(['NASDAQ:AAPL', 'NYSE:MSFT', 'BINANCE:BTCUSDT'])
  })

  it('splits exchange-prefixed symbol tokens', () => {
    expect(splitExchangeSymbol('NASDAQ:AAPL')).toEqual({
      exchange: 'NASDAQ',
      symbol: 'AAPL',
    })

    expect(splitExchangeSymbol('BTCUSDT')).toEqual({
      exchange: null,
      symbol: 'BTCUSDT',
    })
  })

  it('exports listing items to a comma-separated text payload', () => {
    const payload = exportWatchlistItemsAsText([
      {
        id: 'one',
        type: 'listing',
        listing: {
          listing_id: 'aapl-id',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
      },
      {
        id: 'two',
        type: 'section',
        label: 'Tech',
      },
      {
        id: 'three',
        type: 'listing',
        listing: {
          listing_id: '',
          base_id: 'BTC',
          quote_id: 'USDT',
          listing_type: 'crypto',
        },
      },
    ])

    expect(payload).toBe('aapl-id,BTC:USDT')
  })
})
