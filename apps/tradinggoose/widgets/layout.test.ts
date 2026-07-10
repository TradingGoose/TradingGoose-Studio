import { describe, expect, it } from 'vitest'
import { normalizeColorPairsState, normalizeDashboardLayout } from '@/widgets/layout'
import {
  applyLayoutEditDocument,
  closeDashboardTopologyPanel,
  type DashboardLayoutDocumentContent,
  type DashboardLayoutTopologyNode,
  findDashboardTopologyParentGroupId,
  replaceDashboardPanelWidget,
  splitDashboardTopologyPanel,
  updateDashboardTopologyGroupSizes,
} from '@/widgets/layout-document'
import { getDefaultWidgetInstance, WIDGET_KEYS } from '@/widgets/widget-contracts'

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
  const layout = (): DashboardLayoutTopologyNode => ({
    id: 'root',
    type: 'group',
    direction: 'horizontal',
    sizes: [40, 60],
    children: [
      {
        id: 'panel-a',
        type: 'panel',
        identityId: 'widget-a',
        widgetKey: 'watchlist',
      },
      {
        id: 'panel-b',
        type: 'panel',
        identityId: 'widget-b',
        widgetKey: 'heatmap',
      },
    ],
  })
  const content = (): DashboardLayoutDocumentContent => ({
    layout: layout(),
    widgets: {
      'widget-a': { pairColor: 'blue', params: { watchlistId: 'watchlist-1' } },
      'widget-b': { pairColor: 'red', params: null },
    },
    colorPairs: { pairs: [] },
  })

  it('updates group sizes without replacing unchanged layout nodes', () => {
    const current = layout()

    expect(updateDashboardTopologyGroupSizes(current, 'root', [40, 60])).toBe(current)
    expect(updateDashboardTopologyGroupSizes(current, 'root', [35, 65])).toMatchObject({
      id: 'root',
      sizes: [35, 65],
    })
  })

  it('splits a panel and creates an independent child widget document', () => {
    const sourceWidget = {
      pairColor: 'blue' as const,
      params: { watchlistId: 'watchlist-1' },
    }
    const result = splitDashboardTopologyPanel(
      layout(),
      { 'widget-a': sourceWidget, 'widget-b': { pairColor: 'red', params: null } },
      'panel-a',
      'vertical'
    )
    const next = result.layout

    expect(findDashboardTopologyParentGroupId(next, 'panel-b')).toBe('root')
    expect(next.type).toBe('group')
    if (next.type !== 'group') throw new Error('Expected root group')
    const splitNode = next.children[0]
    expect(splitNode.type).toBe('group')
    if (splitNode.type !== 'group') throw new Error('Expected split group')
    expect(splitNode.direction).toBe('vertical')
    expect(splitNode.children).toHaveLength(2)
    const clone = Object.entries(result.createdWidgets)[0]
    expect(clone?.[1]).toEqual(sourceWidget)
    expect(clone?.[0]).not.toBe('widget-a')
  })

  it('closes a panel and marks its child document for removal', () => {
    const result = closeDashboardTopologyPanel(layout(), 'panel-a')
    const next = result.layout

    expect(next.type).toBe('panel')
    if (next.type !== 'panel') throw new Error('Expected survivor panel')
    expect(next).toMatchObject({ identityId: 'widget-b', widgetKey: 'heatmap' })
    expect(result.removedIdentityIds).toEqual(['widget-a'])
  })

  it.each(WIDGET_KEYS)('plans %s replacement as a layout-owned child lifecycle change', (key) => {
    const current = content()
    const sourceKey = key === 'watchlist' ? 'heatmap' : 'watchlist'
    const sourceWidget = getDefaultWidgetInstance(sourceKey)
    if (current.layout.type !== 'group') throw new Error('Expected root group')
    const sourcePanel = current.layout.children[0]
    if (sourcePanel?.type !== 'panel') throw new Error('Expected source panel')
    current.layout = {
      ...current.layout,
      children: [{ ...sourcePanel, widgetKey: sourceKey }, current.layout.children[1]!],
    }
    current.widgets['widget-a'] = {
      pairColor: sourceWidget.pairColor ?? 'gray',
      params: sourceWidget.params ?? null,
    }

    const result = replaceDashboardPanelWidget(current, 'panel-a', key)
    const panel = result.layout.type === 'group' ? result.layout.children[0] : null
    const [identityId, widget] = Object.entries(result.createdWidgets)[0] ?? []
    const defaultWidget = getDefaultWidgetInstance(key)

    expect(panel).toMatchObject({
      id: 'panel-a',
      identityId,
      widgetKey: key,
    })
    expect(identityId).not.toBe('widget-a')
    expect(widget).toEqual({
      pairColor: defaultWidget.pairColor ?? 'gray',
      params: defaultWidget.params ?? null,
    })
    expect(result.removedIdentityIds).toEqual(['widget-a'])
  })

  it('preserves an existing widget binding when the selected key is unchanged', () => {
    const current = content()
    const result = replaceDashboardPanelWidget(current, 'panel-a', 'watchlist')

    expect(result.layout).toBe(current.layout)
    expect(result.createdWidgets).toEqual({})
    expect(result.removedIdentityIds).toEqual([])
  })

  it('lets edit_layout replace an existing panel widget binding', () => {
    const result = applyLayoutEditDocument(
      content(),
      JSON.stringify({
        layout: {
          id: 'root',
          type: 'group',
          direction: 'horizontal',
          sizes: [40, 60],
          children: [
            { id: 'panel-a', type: 'panel', widget: { key: 'list_workflow' } },
            { id: 'panel-b', type: 'panel' },
          ],
        },
      })
    )

    expect(result.removedIdentityIds).toEqual(['widget-a'])
    expect(Object.values(result.createdWidgets)).toEqual([{ pairColor: 'gray', params: null }])
  })
})
