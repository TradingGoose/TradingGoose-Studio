import { describe, expect, it } from 'vitest'
import {
  capHeatmapListings,
  HEATMAP_LISTING_CAP,
  resolvePortfolioHeatmapListings,
  resolveWatchlistHeatmapListings,
} from '@/widgets/widgets/heatmap/components/source-items'

const createListing = (symbol: string) => ({
  listing_id: symbol,
  base_id: '',
  quote_id: '',
  listing_type: 'default' as const,
})

describe('heatmap source item helpers', () => {
  it('dedupes watchlist listings across workspace-user watchlists and tracks source labels', () => {
    const listing = createListing('AAPL')

    expect(
      resolveWatchlistHeatmapListings([
        {
          id: 'list-1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
          name: 'One',
          isSystem: false,
          items: [
            { id: 'a', type: 'listing', listing },
            { id: 'section', type: 'section', label: 'Tech' },
          ],
          settings: { showLogo: true, showTicker: true, showDescription: true },
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'list-2',
          workspaceId: 'workspace-1',
          userId: 'user-1',
          name: 'Two',
          isSystem: false,
          items: [{ id: 'b', type: 'listing', listing }],
          settings: { showLogo: true, showTicker: true, showDescription: true },
          createdAt: '',
          updatedAt: '',
        },
      ])
    ).toEqual([
      {
        key: 'default|AAPL||',
        listing,
        sourceLabels: ['One', 'Two'],
      },
    ])
  })

  it('dedupes portfolio listings in input order and labels them as portfolio sourced', () => {
    const aapl = createListing('AAPL')
    const msft = createListing('MSFT')

    expect(resolvePortfolioHeatmapListings([aapl, msft, aapl])).toEqual([
      {
        key: 'default|AAPL||',
        listing: aapl,
        sourceLabels: ['Portfolio'],
      },
      {
        key: 'default|MSFT||',
        listing: msft,
        sourceLabels: ['Portfolio'],
      },
    ])
  })

  it('caps heatmap listings after source dedupe', () => {
    const items = Array.from({ length: HEATMAP_LISTING_CAP + 1 }, (_, index) => ({
      key: `default|SYM${index}||`,
      listing: createListing(`SYM${index}`),
      sourceLabels: ['Watchlist'],
    }))

    expect(capHeatmapListings(items)).toMatchObject({
      visibleItems: items.slice(0, HEATMAP_LISTING_CAP),
      cappedCount: 1,
      totalCount: HEATMAP_LISTING_CAP + 1,
    })
  })

  it('omits blank source labels and appends later unique watchlist labels', () => {
    const listing = createListing('AAPL')
    expect(
      resolveWatchlistHeatmapListings([
        {
          id: 'list-1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
          name: 'One',
          isSystem: false,
          items: [{ id: 'a', type: 'listing', listing }],
          settings: { showLogo: true, showTicker: true, showDescription: true },
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'list-2',
          workspaceId: 'workspace-1',
          userId: 'user-1',
          name: '  ',
          isSystem: false,
          items: [{ id: 'b', type: 'listing', listing }],
          settings: { showLogo: true, showTicker: true, showDescription: true },
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'list-3',
          workspaceId: 'workspace-1',
          userId: 'user-1',
          name: 'Two',
          isSystem: false,
          items: [{ id: 'c', type: 'listing', listing }],
          settings: { showLogo: true, showTicker: true, showDescription: true },
          createdAt: '',
          updatedAt: '',
        },
      ])
    ).toEqual([
      {
        key: 'default|AAPL||',
        listing,
        sourceLabels: ['One', 'Two'],
      },
    ])
  })
})
