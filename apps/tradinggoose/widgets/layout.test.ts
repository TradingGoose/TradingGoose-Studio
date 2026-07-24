import { describe, expect, it } from 'vitest'
import {
  applyDashboardLayoutStructureMutation,
  applyLayoutEditDocument,
  closeDashboardTopologyPanel,
  createDefaultDashboardLayoutProjection,
  type DashboardLayoutProjectionContent,
  type DashboardLayoutTopologyNode,
  DashboardLayoutValidationError,
  materializeDashboardWidgetBinding,
  normalizeDashboardLayoutProjection,
  normalizeDashboardLayoutTopology,
  replaceDashboardPanelWidget,
  resolveDashboardLayout,
  splitDashboardTopologyPanel,
} from '@/widgets/layout-document'

describe('dashboard layout tree operations', () => {
  const layout = (): Extract<DashboardLayoutTopologyNode, { type: 'group' }> => ({
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
    duplicateNodes.children[1] = { ...duplicateNodes.children[1]!, id: 'panel-a' }

    expect(() => normalizeDashboardLayoutTopology(duplicateNodes)).toThrow(
      /duplicate node panel-a/i
    )

    const duplicateIdentity = layout()
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
    const resize = (sizes: number[], groupId = 'root') =>
      applyDashboardLayoutStructureMutation(current, { type: 'resize', groupId, sizes }).layout

    expect(resize([40, 60])).toBe(current)
    expect(resize([0, 100])).toMatchObject({ id: 'root', sizes: [0, 100] })
    expect(resize([49.995, 50])).toMatchObject({ sizes: [49.995, 50] })
    for (const sizes of [
      [0, 0],
      [80, 80],
    ]) {
      expect(() => resize(sizes)).toThrow(/total approximately 100/i)
    }
    expect(() => resize([50, 50], 'missing-group')).toThrow(/Unknown group/)
  })

  it.each([[[1, 1]], [[80, 80]]])(
    'rejects edit_layout sizes that do not total 100: %j',
    (sizes) => {
      const current = layout()
      const children = current.children.map(({ id, type }) => ({ id, type }))

      expect(() =>
        applyLayoutEditDocument(
          { layout: current },
          JSON.stringify({ layout: { ...current, sizes, children } })
        )
      ).toThrow(/entityDocument\.layout\.sizes.*total approximately 100/i)
    }
  )

  it('splits a panel and creates an independent child widget document', () => {
    const result = splitDashboardTopologyPanel(layout(), 'panel-a', 'vertical')
    const next = result.layout

    expect(next.type).toBe('group')
    if (next.type !== 'group') throw new Error('Expected root group')
    const splitNode = next.children[0]
    expect(splitNode.type).toBe('group')
    if (splitNode.type !== 'group') throw new Error('Expected split group')
    expect(splitNode.direction).toBe('vertical')
    expect(splitNode.children).toHaveLength(2)
    const clone = result.createdBindings[0]
    expect(clone?.source).toEqual({ identityId: 'widget-a', widgetKey: 'watchlist' })
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
    expect(clone?.source).toEqual({ identityId: source.identityId, widgetKey: null })
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

    const collapsed = layout()
    const first = collapsed.children[0]
    if (first?.type !== 'panel') throw new Error('Expected child panel')
    collapsed.children.push({ ...first, id: 'panel-c', identityId: 'widget-c' })
    collapsed.sizes = [0, 0, 100]
    expect(closeDashboardTopologyPanel(collapsed, 'panel-c').layout).toMatchObject({
      sizes: [50, 50],
    })
    expect(() => closeDashboardTopologyPanel(layout(), 'missing-panel')).toThrow(/Unknown panel/)
    expect(() => closeDashboardTopologyPanel(next, next.id)).toThrow(/Cannot close panel/)
  })

  it('preserves pair color while replacing a widget binding and clearing its local params', () => {
    const current = content()
    const result = replaceDashboardPanelWidget(current.layout, 'panel-a', 'heatmap')
    const panel = result.layout.type === 'group' ? result.layout.children[0] : null
    const binding = result.createdBindings[0]
    const identityId = binding?.identityId

    expect(panel).toMatchObject({
      id: 'panel-a',
      identityId,
      widgetKey: 'heatmap',
    })
    expect(identityId).not.toBe('widget-a')
    expect(binding?.source).toEqual({ identityId: 'widget-a', widgetKey: 'watchlist' })
    expect(materializeDashboardWidgetBinding(binding!, current.widgets['widget-a'])).toEqual({
      pairColor: 'blue',
      params: null,
    })
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
