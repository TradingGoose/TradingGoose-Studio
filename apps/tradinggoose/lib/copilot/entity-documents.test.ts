import { describe, expect, it } from 'vitest'
import {
  DASHBOARD_LAYOUT_DOCUMENT_FORMAT,
  parseEntityDocument,
  serializeEntityDocument,
  WATCHLIST_DOCUMENT_FORMAT,
} from '@/lib/copilot/entity-documents'

const watchlistDocument = {
  name: 'Growth',
  settings: { showLogo: true, showTicker: true, showDescription: true },
  items: [],
}

describe('copilot entity documents', () => {
  it('rejects unsupported top-level watchlist ownership fields', () => {
    expect(() =>
      parseEntityDocument(
        'watchlist',
        JSON.stringify({
          ...watchlistDocument,
          parentId: null,
        })
      )
    ).toThrow('Unsupported watchlist document field: parentId')
  })

  it('accepts canonical watchlist documents for the current format', () => {
    expect(WATCHLIST_DOCUMENT_FORMAT).toBe('tg-watchlist-document-v1')
    expect(parseEntityDocument('watchlist', JSON.stringify(watchlistDocument))).toEqual(
      watchlistDocument
    )
  })

  it('rejects partial watchlist documents', () => {
    expect(() =>
      parseEntityDocument(
        'watchlist',
        JSON.stringify({
          name: 'Only Name',
        })
      )
    ).toThrow(/settings/i)
  })

  it('round-trips dashboard layout documents with canonical crypto and currency listing identities', () => {
    const cryptoListing = {
      listing_type: 'crypto',
      listing_id: '',
      base_id: 'BTC',
      quote_id: 'USD',
    }
    const currencyListing = {
      listing_type: 'currency',
      listing_id: '',
      base_id: 'EUR',
      quote_id: 'USD',
    }
    const document = {
      name: 'Markets',
      layout: {
        id: 'panel-chart',
        type: 'panel',
        widget: {
          key: 'data_chart',
          pairColor: 'gray',
          params: { listing: cryptoListing },
        },
      },
      colorPairs: {
        pairs: [{ color: 'red', listing: currencyListing }],
      },
      isActive: true,
      sortOrder: 0,
    }

    expect(DASHBOARD_LAYOUT_DOCUMENT_FORMAT).toBe('tg-dashboard-layout-document-v1')
    expect(parseEntityDocument('dashboard_layout', JSON.stringify(document))).toEqual(document)

    const serialized = JSON.parse(serializeEntityDocument('dashboard_layout', document))
    expect(serialized).toEqual(document)
    expect(serialized.layout.widget.params.listing.base).toBeUndefined()
    expect(serialized.colorPairs.pairs[0].listing.quote).toBeUndefined()
  })

  it('rejects non-canonical dashboard widget keys', () => {
    expect(() =>
      parseEntityDocument(
        'dashboard_layout',
        JSON.stringify({
          name: 'Markets',
          layout: {
            id: 'panel-chart',
            type: 'panel',
            widget: {
              key: 'unknown_widget',
              pairColor: 'gray',
              params: null,
            },
          },
          colorPairs: { pairs: [] },
          isActive: true,
          sortOrder: 0,
        })
      )
    ).toThrow('layout.widget.key must be a canonical widget key')
  })
})
