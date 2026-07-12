import { describe, expect, it } from 'vitest'
import { normalizeColorPairsState, normalizeDashboardLayout } from '@/widgets/layout'
import {
  applyDashboardLayoutStructureMutation,
  applyLayoutEditDocument,
  closeDashboardTopologyPanel,
  createDefaultDashboardLayoutProjection,
  type DashboardLayoutProjectionContent,
  type DashboardLayoutTopologyNode,
  DashboardLayoutValidationError,
  findDashboardTopologyParentGroupId,
  normalizeDashboardLayoutProjection,
  normalizeDashboardLayoutTopology,
  replaceDashboardPanelWidget,
  resolveDashboardLayout,
  splitDashboardTopologyPanel,
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

  it('omits empty contexts and orders the remaining canonical colors', () => {
    expect(
      normalizeColorPairsState({
        pairs: [
          { color: 'red', skillId: 'skill-1' },
          { color: 'blue', workflowId: null, unsupportedField: 'ignored' },
          { color: 'green', workflowId: 'workflow-1' },
        ],
      })
    ).toEqual({
      pairs: [
        { color: 'green', workflowId: 'workflow-1' },
        { color: 'red', skillId: 'skill-1' },
      ],
    })
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
  const content = (): DashboardLayoutProjectionContent => ({
    layout: layout(),
    widgets: {
      'widget-a': { pairColor: 'blue', params: { watchlistId: 'watchlist-1' } },
      'widget-b': { pairColor: 'red', params: null },
    },
    colorPairs: { pairs: [] },
  })

  const panels = (
    node: DashboardLayoutTopologyNode
  ): Array<Extract<DashboardLayoutTopologyNode, { type: 'panel' }>> =>
    node.type === 'panel' ? [node] : node.children.flatMap(panels)

  it('creates one real canonical null-widget child for every default panel', () => {
    const created = createDefaultDashboardLayoutProjection()
    const defaultPanels = panels(created.layout)

    expect(defaultPanels.length).toBeGreaterThan(0)
    expect(new Set(defaultPanels.map((panel) => panel.id)).size).toBe(defaultPanels.length)
    expect(new Set(defaultPanels.map((panel) => panel.identityId)).size).toBe(defaultPanels.length)
    expect(Object.keys(created.widgets)).toHaveLength(defaultPanels.length)
    for (const panel of defaultPanels) {
      expect(panel.widgetKey).toBeNull()
      expect(created.widgets[panel.identityId]).toEqual({ pairColor: 'gray', params: null })
    }
    expect(normalizeDashboardLayoutProjection(created)).toEqual(created)
    expect(created.colorPairs).toEqual({ pairs: [] })
  })

  it('requires unique node ids and widget identities in topology-only projections', () => {
    const duplicateNodes = layout()
    if (duplicateNodes.type !== 'group') throw new Error('Expected root group')
    duplicateNodes.children[1] = { ...duplicateNodes.children[1]!, id: 'panel-a' }

    expect(() => normalizeDashboardLayoutTopology(duplicateNodes)).toThrow(
      /duplicate node panel-a/i
    )

    const duplicateIdentity = layout()
    if (duplicateIdentity.type !== 'group') throw new Error('Expected root group')
    const duplicateIdentityPanel = duplicateIdentity.children[1]
    if (duplicateIdentityPanel?.type !== 'panel') throw new Error('Expected child panel')
    duplicateIdentity.children[1] = {
      ...duplicateIdentityPanel,
      identityId: 'widget-a',
      widgetKey: null,
    }

    expect(() => normalizeDashboardLayoutTopology(duplicateIdentity)).toThrow(
      /widget widget-a is referenced by multiple panels/i
    )
  })

  it('requires every panel child and excludes inactive child rows from the projection', () => {
    const nullPanel = {
      layout: {
        id: 'panel-empty',
        type: 'panel',
        identityId: 'widget-empty',
        widgetKey: null,
      },
      widgets: {
        'widget-empty': { pairColor: 'gray', params: null },
      },
      colorPairs: { pairs: [] },
    } satisfies DashboardLayoutProjectionContent

    expect(normalizeDashboardLayoutProjection(nullPanel)).toEqual(nullPanel)
    expect(resolveDashboardLayout(nullPanel.layout, nullPanel.widgets)).toEqual({
      id: 'panel-empty',
      type: 'panel',
      widget: null,
    })
    expect(() => normalizeDashboardLayoutProjection({ ...nullPanel, widgets: {} })).toThrow(
      /widget widget-empty is missing/i
    )
    expect(
      normalizeDashboardLayoutProjection({
        ...nullPanel,
        widgets: {
          ...nullPanel.widgets,
          orphan: { pairColor: 'gray', params: null },
        },
      }).widgets
    ).toEqual(nullPanel.widgets)
  })

  it('accepts only the exact canonical child state for a null widget key', () => {
    const document = createDefaultDashboardLayoutProjection()
    const panel = panels(document.layout)[0]!

    expect(() =>
      normalizeDashboardLayoutProjection({
        ...document,
        widgets: {
          ...document.widgets,
          [panel.identityId]: { pairColor: 'blue', params: null },
        },
      })
    ).toThrow(/null-key dashboard widget/i)
    expect(() =>
      normalizeDashboardLayoutProjection({
        ...document,
        widgets: {
          ...document.widgets,
          [panel.identityId]: { pairColor: 'gray', params: {} },
        },
      })
    ).toThrow(/null-key dashboard widget/i)
  })

  it('reports document validation through a writable domain error', () => {
    let caught: unknown
    try {
      normalizeDashboardLayoutProjection({
        layout: {},
        widgets: {},
        colorPairs: { pairs: [] },
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(DashboardLayoutValidationError)
    const domainError = caught as DashboardLayoutValidationError
    expect(() => {
      domainError.message = 'writable'
    }).not.toThrow()
    expect(domainError.message).toBe('writable')
  })

  it('updates group sizes without replacing unchanged layout nodes', () => {
    const current = layout()

    expect(
      applyDashboardLayoutStructureMutation(current, {
        type: 'resize',
        groupId: 'root',
        sizes: [40, 60],
      }).layout
    ).toBe(current)
    expect(
      applyDashboardLayoutStructureMutation(current, {
        type: 'resize',
        groupId: 'root',
        sizes: [35, 65],
      }).layout
    ).toMatchObject({
      id: 'root',
      sizes: [35, 65],
    })
  })

  it('splits a panel and creates an independent child widget document', () => {
    const result = splitDashboardTopologyPanel(layout(), 'panel-a', 'vertical')
    const next = result.layout

    expect(findDashboardTopologyParentGroupId(next, 'panel-b')).toBe('root')
    expect(next.type).toBe('group')
    if (next.type !== 'group') throw new Error('Expected root group')
    const splitNode = next.children[0]
    expect(splitNode.type).toBe('group')
    if (splitNode.type !== 'group') throw new Error('Expected split group')
    expect(splitNode.direction).toBe('vertical')
    expect(splitNode.children).toHaveLength(2)
    const clone = result.createdBindings[0]
    expect(clone?.sourceIdentityId).toBe('widget-a')
    expect(clone?.identityId).not.toBe('widget-a')
  })

  it('splits a null-key panel by cloning its real null-widget child', () => {
    const current = createDefaultDashboardLayoutProjection()
    const source = panels(current.layout)[0]!
    const result = splitDashboardTopologyPanel(current.layout, source.id, 'horizontal')
    const clone = result.createdBindings[0]
    const cloneIdentityId = clone?.identityId

    expect(cloneIdentityId).toBeTruthy()
    expect(cloneIdentityId).not.toBe(source.identityId)
    expect(clone).toMatchObject({ widgetKey: null, sourceIdentityId: source.identityId })
    expect(
      normalizeDashboardLayoutProjection({
        ...current,
        layout: result.layout,
        widgets: {
          ...current.widgets,
          [cloneIdentityId!]: { pairColor: 'gray', params: null },
        },
      })
    ).toBeDefined()
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

    const result = replaceDashboardPanelWidget(current.layout, 'panel-a', key)
    const panel = result.layout.type === 'group' ? result.layout.children[0] : null
    const binding = result.createdBindings[0]
    const identityId = binding?.identityId

    expect(panel).toMatchObject({
      id: 'panel-a',
      identityId,
      widgetKey: key,
    })
    expect(identityId).not.toBe('widget-a')
    expect(binding?.widgetKey).toBe(key)
    expect(result.removedIdentityIds).toEqual(['widget-a'])
  })

  it('preserves an existing widget binding when the selected key is unchanged', () => {
    const current = content()
    const result = replaceDashboardPanelWidget(current.layout, 'panel-a', 'watchlist')

    expect(result.layout).toBe(current.layout)
    expect(result.createdBindings).toEqual([])
    expect(result.removedIdentityIds).toEqual([])
  })

  it('lets edit_layout replace an existing panel widget binding', () => {
    const result = applyLayoutEditDocument(
      { layout: content().layout },
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
    expect(result.createdBindings).toEqual([
      expect.objectContaining({ widgetKey: 'list_workflow' }),
    ])
  })
})
