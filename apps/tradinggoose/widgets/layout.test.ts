import { describe, expect, it } from 'vitest'
import {
  closeDashboardLayoutPanelGroup,
  findDashboardLayoutParentGroupId,
  type LayoutNode,
  normalizeColorPairsState,
  normalizeDashboardLayout,
  serializeLayout,
  splitDashboardLayoutPanelIntoVerticalGroup,
  updateDashboardLayoutGroupSizes,
} from '@/widgets/layout'

describe('normalizeColorPairsState', () => {
  it('ignores unsupported color-pair fields', () => {
    expect(
      normalizeColorPairsState({
        pairs: [
          {
            color: 'blue',
            workflowId: 'wf-1',
            unsupportedField: 'ignored',
          },
        ],
      })
    ).toEqual({
      pairs: [
        {
          color: 'blue',
          workflowId: 'wf-1',
        },
      ],
    })
  })

  it('keeps provider and account fields out of persisted color-pair listings', () => {
    const normalized = normalizeColorPairsState({
      pairs: [
        {
          color: 'red',
          listing: {
            listing_id: 'AAPL',
            base_id: 'ignored-base',
            quote_id: 'ignored-quote',
            listing_type: 'default',
            provider: 'alpaca',
            marketProvider: 'polygon',
            tradingProvider: 'alpaca',
            accountId: 'acct-1',
            providerParams: { apiKey: 'secret' },
          },
        },
      ],
    })

    const listing = normalized.pairs[0]?.listing

    expect(listing).toEqual({
      listing_id: 'AAPL',
      base_id: '',
      quote_id: '',
      listing_type: 'default',
    })
    expect(listing).not.toHaveProperty('provider')
    expect(listing).not.toHaveProperty('marketProvider')
    expect(listing).not.toHaveProperty('tradingProvider')
    expect(listing).not.toHaveProperty('accountId')
    expect(listing).not.toHaveProperty('providerParams')
  })
})

describe('normalizeDashboardLayout', () => {
  it('preserves persisted node ids so panel-scoped widget channels stay stable across reloads', () => {
    const normalized = normalizeDashboardLayout({
      id: 'group-1',
      type: 'group',
      direction: 'horizontal',
      sizes: [100],
      children: [
        {
          id: 'panel-1',
          type: 'panel',
          widget: {
            key: 'copilot',
            pairColor: 'gray',
            params: null,
          },
        },
      ],
    })

    expect(normalized.id).toBe('group-1')
    expect(normalized.type).toBe('group')
    if (normalized.type !== 'group') {
      throw new Error('Expected normalized layout to remain a group')
    }

    expect(normalized.children[0]?.id).toBe('panel-1')
    expect(serializeLayout(normalized)).toMatchObject({
      id: 'group-1',
      children: [{ id: 'panel-1', type: 'panel' }],
    })
  })

  it('clears persisted copilot params instead of keeping sticky context state', () => {
    const normalized = normalizeDashboardLayout({
      type: 'panel',
      widget: {
        key: 'copilot',
        pairColor: 'blue',
        params: {
          workflowId: 'wf-1',
          reviewSessionId: 'review-1',
        },
      },
    })

    expect(normalized.type).toBe('panel')
    if (normalized.type !== 'panel') {
      throw new Error('Expected normalized copilot layout to remain a panel')
    }

    expect(normalized.widget).toMatchObject({
      key: 'copilot',
      pairColor: 'blue',
      params: null,
    })
  })
})

describe('dashboard layout tree operations', () => {
  const layout = (): LayoutNode => ({
    id: 'root',
    type: 'group',
    direction: 'horizontal',
    sizes: [40, 60],
    children: [
      {
        id: 'panel-a',
        type: 'panel',
        widget: {
          key: 'watchlist',
          pairColor: 'blue',
          params: { watchlistId: 'watchlist-1' },
        },
      },
      {
        id: 'panel-b',
        type: 'panel',
        widget: {
          key: 'heatmap',
          pairColor: 'red',
          params: { listing: { listing_id: 'BTC-USD', listing_type: 'crypto' } },
        },
      },
    ],
  })

  it('updates group sizes without replacing unchanged layout nodes', () => {
    const current = layout()

    expect(updateDashboardLayoutGroupSizes(current, 'root', [40, 60])).toBe(current)
    expect(updateDashboardLayoutGroupSizes(current, 'root', [35, 65])).toMatchObject({
      id: 'root',
      sizes: [35, 65],
    })
  })

  it('splits a panel into a new group and duplicates the source widget config', () => {
    const next = splitDashboardLayoutPanelIntoVerticalGroup(layout(), 'panel-a')

    expect(findDashboardLayoutParentGroupId(next, 'panel-b')).toBe('root')
    expect(next.type).toBe('group')
    if (next.type !== 'group') throw new Error('Expected root group')
    const splitNode = next.children[0]
    expect(splitNode.type).toBe('group')
    if (splitNode.type !== 'group') throw new Error('Expected split group')
    expect(splitNode.direction).toBe('vertical')
    expect(splitNode.children).toHaveLength(2)
    expect(splitNode.children[0]).toMatchObject({
      type: 'panel',
      widget: {
        key: 'watchlist',
        pairColor: 'blue',
        params: { watchlistId: 'watchlist-1' },
      },
    })
  })

  it('closes a panel and normalizes sibling sizes', () => {
    const next = closeDashboardLayoutPanelGroup(layout(), 'panel-a')

    expect(next.type).toBe('panel')
    if (next.type !== 'panel') throw new Error('Expected survivor panel')
    expect(next.widget).toMatchObject({
      key: 'heatmap',
      pairColor: 'red',
    })
  })
})
