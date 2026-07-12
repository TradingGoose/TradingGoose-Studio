import { describe, expect, it } from 'vitest'
import {
  DASHBOARD_LAYOUT_DOCUMENT_FORMAT,
  parseEntityDocument,
  serializeEntityDocument,
  WATCHLIST_DOCUMENT_FORMAT,
} from '@/lib/copilot/entity-documents'

const watchlistDocument = {
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
    ).toThrow(/parentId|Unrecognized/i)
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
          items: [],
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
      layout: {
        id: 'panel-chart',
        type: 'panel',
        identityId: 'widget-chart',
        widgetKey: 'data_chart',
      },
      widgets: {
        'widget-chart': {
          pairColor: 'gray',
          params: { listing: cryptoListing },
        },
      },
      colorPairs: {
        pairs: [{ color: 'red', listing: currencyListing }],
      },
    }

    expect(DASHBOARD_LAYOUT_DOCUMENT_FORMAT).toBe('tg-dashboard-layout-document-v3')
    expect(parseEntityDocument('dashboard_layout', JSON.stringify(document))).toEqual(document)

    const serialized = JSON.parse(serializeEntityDocument('dashboard_layout', document))
    expect(serialized).toEqual(document)
    expect(serialized.widgets['widget-chart'].params.listing.base).toBeUndefined()
    expect(serialized.colorPairs.pairs[0].listing.quote).toBeUndefined()
  })

  it('rejects non-canonical dashboard widget keys', () => {
    expect(() =>
      parseEntityDocument(
        'dashboard_layout',
        JSON.stringify({
          layout: {
            id: 'panel-chart',
            type: 'panel',
            identityId: 'widget-chart',
            widgetKey: 'unknown_widget',
          },
          widgets: {
            'widget-chart': {
              pairColor: 'gray',
              params: null,
            },
          },
          colorPairs: { pairs: [] },
        })
      )
    ).toThrow('unknown_widget')
  })

  it('round-trips canonical null-key panels with their real widget child', () => {
    const document = {
      layout: {
        id: 'panel-empty',
        type: 'panel',
        identityId: 'widget-empty',
        widgetKey: null,
      },
      widgets: {
        'widget-empty': {
          pairColor: 'gray',
          params: null,
        },
      },
      colorPairs: { pairs: [] },
    }

    expect(parseEntityDocument('dashboard_layout', JSON.stringify(document))).toEqual(document)
    expect(JSON.parse(serializeEntityDocument('dashboard_layout', document))).toEqual(document)
  })

  it('rejects a null-key panel whose real child is missing or non-null', () => {
    const layout = {
      id: 'panel-empty',
      type: 'panel',
      identityId: 'widget-empty',
      widgetKey: null,
    }

    expect(() =>
      parseEntityDocument(
        'dashboard_layout',
        JSON.stringify({ layout, widgets: {}, colorPairs: { pairs: [] } })
      )
    ).toThrow(/widget widget-empty is missing/i)
    expect(() =>
      parseEntityDocument(
        'dashboard_layout',
        JSON.stringify({
          layout,
          widgets: {
            'widget-empty': { pairColor: 'gray', params: { workflowId: 'workflow-1' } },
          },
          colorPairs: { pairs: [] },
        })
      )
    ).toThrow(/null-key dashboard widget/i)
  })

  it.each([
    ['watchlist', { watchlistId: 123 }],
    ['data_chart', { data: { provider: 123 } }],
  ])('rejects lossy persisted %s widget params', (widgetKey, params) => {
    expect(() =>
      parseEntityDocument(
        'dashboard_layout',
        JSON.stringify({
          layout: {
            id: 'panel-widget',
            type: 'panel',
            identityId: 'widget-1',
            widgetKey,
          },
          widgets: {
            'widget-1': {
              pairColor: 'gray',
              params,
            },
          },
          colorPairs: { pairs: [] },
        })
      )
    ).toThrow('params must be canonical')
  })
})
