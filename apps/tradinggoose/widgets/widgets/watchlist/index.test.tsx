/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/widgets/widgets/watchlist/components/watchlist-body', () => ({
  WatchlistWidgetBody: () => null,
}))

import { renderWatchlistHeader } from '@/widgets/widgets/watchlist/components/watchlist-header-controls'
import { watchlistWidget } from '@/widgets/widgets/watchlist/index'

describe('watchlistWidget', () => {
  it('uses the shared watchlist header renderer', () => {
    expect(watchlistWidget.renderHeader).toBe(renderWatchlistHeader)
  })
})
