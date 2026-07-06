import { describe, expect, it } from 'vitest'
import { parseEntityDocument, WATCHLIST_DOCUMENT_FORMAT } from '@/lib/copilot/entity-documents'

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
})
