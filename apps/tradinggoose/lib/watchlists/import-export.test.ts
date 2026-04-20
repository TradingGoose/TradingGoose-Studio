import { describe, expect, it } from 'vitest'
import {
  createWatchlistExportFile,
  exportWatchlistAsJson,
  parseImportedWatchlistFile,
} from '@/lib/watchlists/import-export'

describe('watchlist import/export', () => {
  it('creates a unified watchlist export file with exactly one watchlist', () => {
    const payload = createWatchlistExportFile({
      name: '  My Watchlist  ',
      items: [
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
          id: 'section-1',
          type: 'section',
          label: 'Tech',
        },
        {
          id: 'two',
          type: 'listing',
          listing: {
            listing_id: '',
            base_id: 'BTC',
            quote_id: 'USDT',
            listing_type: 'crypto',
          },
        },
      ],
    })

    expect(payload).toMatchObject({
      version: '1',
      fileType: 'tradingGooseExport',
      exportedFrom: 'watchlistWidget',
      resourceTypes: ['watchlists'],
      skills: [],
      workflows: [],
      watchlists: [
        {
          name: 'My Watchlist',
          items: [
            {
              type: 'listing',
              listing: {
                listing_id: 'aapl-id',
                base_id: '',
                quote_id: '',
                listing_type: 'default',
              },
            },
            {
              type: 'section',
              label: 'Tech',
              items: [
                {
                  type: 'listing',
                  listing: {
                    listing_id: '',
                    base_id: 'BTC',
                    quote_id: 'USDT',
                    listing_type: 'crypto',
                  },
                },
              ],
            },
          ],
        },
      ],
      customTools: [],
      indicators: [],
    })
  })

  it('serializes unified watchlist export files as JSON', () => {
    const payload = exportWatchlistAsJson({
      name: 'My Watchlist',
      items: [
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
      ],
    })

    expect(JSON.parse(payload)).toEqual({
      version: '1',
      fileType: 'tradingGooseExport',
      exportedAt: expect.any(String),
      exportedFrom: 'watchlistWidget',
      resourceTypes: ['watchlists'],
      skills: [],
      workflows: [],
      watchlists: [
        {
          name: 'My Watchlist',
          items: [
            {
              type: 'listing',
              listing: {
                listing_id: 'aapl-id',
                base_id: '',
                quote_id: '',
                listing_type: 'default',
              },
            },
          ],
        },
      ],
      customTools: [],
      indicators: [],
    })
  })

  it('parses mixed unified import files and trims the watchlist name', () => {
    const parsed = parseImportedWatchlistFile({
      version: '1',
      fileType: 'tradingGooseExport',
      exportedAt: '2026-04-06T12:00:00.000Z',
      exportedFrom: 'skillList',
      resourceTypes: ['watchlists', 'skills'],
      watchlists: [
        {
          name: '  My Watchlist  ',
          items: [
            {
              type: 'section',
              label: 'Tech',
              items: [
                {
                  type: 'listing',
                  listing: {
                    listing_id: 'aapl-id',
                    base_id: '',
                    quote_id: '',
                    listing_type: 'default',
                  },
                },
              ],
            },
          ],
        },
      ],
      skills: [{ name: 'Ignore me' }],
    })

    expect(parsed.watchlists).toEqual([
      {
        name: 'My Watchlist',
        items: [
          {
            type: 'section',
            label: 'Tech',
            items: [
              {
                type: 'listing',
                listing: {
                  listing_id: 'aapl-id',
                  base_id: '',
                  quote_id: '',
                  listing_type: 'default',
                },
              },
            ],
          },
        ],
      },
    ])
  })

  it('rejects invalid fileType values', () => {
    expect(() =>
      parseImportedWatchlistFile({
        version: '1',
        fileType: 'wrongFileType',
        exportedAt: '2026-04-06T12:00:00.000Z',
        exportedFrom: 'watchlistWidget',
        resourceTypes: ['watchlists'],
        watchlists: [
          {
            name: 'My Watchlist',
            items: [],
          },
        ],
      })
    ).toThrow()
  })

  it('rejects invalid version values', () => {
    expect(() =>
      parseImportedWatchlistFile({
        version: '2',
        fileType: 'tradingGooseExport',
        exportedAt: '2026-04-06T12:00:00.000Z',
        exportedFrom: 'watchlistWidget',
        resourceTypes: ['watchlists'],
        watchlists: [
          {
            name: 'My Watchlist',
            items: [],
          },
        ],
      })
    ).toThrow()
  })

  it('rejects files that do not list watchlists in resourceTypes', () => {
    expect(() =>
      parseImportedWatchlistFile({
        version: '1',
        fileType: 'tradingGooseExport',
        exportedAt: '2026-04-06T12:00:00.000Z',
        exportedFrom: 'watchlistWidget',
        resourceTypes: ['skills'],
        watchlists: [
          {
            name: 'My Watchlist',
            items: [],
          },
        ],
      })
    ).toThrow()
  })

  it('rejects files without exactly one watchlist', () => {
    expect(() =>
      parseImportedWatchlistFile({
        version: '1',
        fileType: 'tradingGooseExport',
        exportedAt: '2026-04-06T12:00:00.000Z',
        exportedFrom: 'watchlistWidget',
        resourceTypes: ['watchlists'],
        watchlists: [],
      })
    ).toThrow()

    expect(() =>
      parseImportedWatchlistFile({
        version: '1',
        fileType: 'tradingGooseExport',
        exportedAt: '2026-04-06T12:00:00.000Z',
        exportedFrom: 'watchlistWidget',
        resourceTypes: ['watchlists'],
        watchlists: [
          {
            name: 'My Watchlist',
            items: [],
          },
          {
            name: 'Second Watchlist',
            items: [],
          },
        ],
      })
    ).toThrow()
  })

  it('rejects nested import entries with ids', () => {
    expect(() =>
      parseImportedWatchlistFile({
        version: '1',
        fileType: 'tradingGooseExport',
        exportedAt: '2026-04-06T12:00:00.000Z',
        exportedFrom: 'watchlistWidget',
        resourceTypes: ['watchlists'],
        watchlists: [
          {
            name: 'My Watchlist',
            items: [
              {
                id: 'legacy-item-id',
                type: 'listing',
                listing: {
                  listing_id: 'aapl-id',
                  base_id: '',
                  quote_id: '',
                  listing_type: 'default',
                },
              },
            ],
          },
        ],
      })
    ).toThrow()
  })
})
