import { describe, expect, it } from 'vitest'
import type { LayoutNode } from '@/widgets/layout'
import { resolveEffectiveDashboardLayout } from '@/widgets/layout-document'
import type { PairColor } from '@/widgets/pair-colors'
import { getDefaultWidgetInstance, WIDGET_KEYS } from '@/widgets/widget-contracts'
import {
  applyWidgetConfigMutation,
  collectDashboardLayoutReferenceCandidates,
  type PlannedWidgetConfigMutation,
  planWidgetConfigMutation,
  type WidgetReferenceValidationResult,
} from '@/widgets/widget-mutations'

const listing = {
  listing_type: 'default',
  listing_id: 'AAPL',
  base_id: 'AAPL',
  quote_id: 'USD',
}
const normalizedListing = {
  listing_type: 'default',
  listing_id: 'AAPL',
  base_id: '',
  quote_id: '',
} as const
const portfolioIdentity = {
  providerId: 'alpaca',
  credentialId: 'oauth-account-1',
  serviceId: 'alpaca-live',
  accountId: 'account-1',
}
const scope = { workspaceId: 'workspace-1', ownerUserId: 'user-1' }

const panel = (
  id: string,
  key: string,
  pairColor: PairColor,
  params: Record<string, unknown> | null = null
): LayoutNode => ({ id, type: 'panel', widget: { key, pairColor, params } })

const group = (...children: LayoutNode[]): LayoutNode => ({
  id: 'root',
  type: 'group',
  direction: 'horizontal',
  sizes: [50, 50],
  children,
})

const layout = () =>
  group(
    panel('chart-panel', 'data_chart', 'red', { data: { provider: 'alpaca' } }),
    panel('order-panel', 'quick_order', 'red')
  )
const workflowLayout = () => panel('panel-workflow', 'editor_workflow', 'red')
const unknownWidgetLayout = () => panel('panel-unknown', 'unknown_widget', 'gray')

type MutationInput = Parameters<typeof applyWidgetConfigMutation>[0]

const withDefaults = (over: Partial<MutationInput>): MutationInput => ({
  layout: layout(),
  colorPairs: { pairs: [] },
  panelId: 'chart-panel',
  patch: {},
  ...over,
})

const apply = (over: Partial<MutationInput>) => applyWidgetConfigMutation(withDefaults(over))
const plan = (over: Partial<MutationInput>) => planWidgetConfigMutation(withDefaults(over))
const applyProven = (over: Partial<MutationInput>) =>
  applyWidgetConfigMutation({
    ...withDefaults(over),
    referenceValidationScope: scope,
    referenceValidation: proofForPlan(plan(over)),
  })

describe('applyWidgetConfigMutation', () => {
  it.each(WIDGET_KEYS)('applies canonical defaults when changing to %s', (widgetKey) => {
    const result = apply({
      layout: { id: 'panel-empty', type: 'panel', widget: null },
      panelId: 'panel-empty',
      patch: { widgetKey, pairColor: 'gray' },
    })

    expect(result.widget).toEqual(getDefaultWidgetInstance(widgetKey))
  })

  it('requires a canonical widgetKey when adding to an empty panel', () => {
    expect(() =>
      apply({
        layout: { id: 'panel-empty', type: 'panel', widget: null },
        panelId: 'panel-empty',
        patch: { pairColor: 'red' },
      })
    ).toThrow('A target widgetKey is required for empty panel "panel-empty"')
  })

  it('splits non-gray linked params into shared colorPairs and keeps local params on the widget', () => {
    const result = applyProven({
      patch: { params: { listing, data: { provider: 'alpaca' } } },
    })

    expect(result.widget).toEqual({
      key: 'data_chart',
      pairColor: 'red',
      params: { data: { provider: 'alpaca' } },
    })
    expect(result.colorPairs).toEqual({
      pairs: [{ color: 'red', listing: normalizedListing }],
    })
    expect(result.colorPairDiff).toEqual([
      {
        color: 'red',
        before: {},
        after: { listing: normalizedListing },
        changedFields: ['listing'],
      },
    ])

    const effective = resolveEffectiveDashboardLayout(result.layout, result.colorPairs)
    expect(JSON.stringify(effective)).toContain('"listing_id":"AAPL"')
  })

  it('changes one color-store widget without clearing another color store using the same entity', () => {
    const layout: LayoutNode = {
      id: 'root',
      type: 'group',
      direction: 'horizontal',
      sizes: [50, 50],
      children: [
        {
          id: 'red-panel',
          type: 'panel',
          widget: { key: 'editor_indicator', pairColor: 'red', params: null },
        },
        {
          id: 'blue-panel',
          type: 'panel',
          widget: { key: 'editor_indicator', pairColor: 'blue', params: null },
        },
      ],
    }

    const result = applyProven({
      layout,
      colorPairs: {
        pairs: [
          { color: 'red', indicatorId: 'indicator-a' },
          { color: 'blue', indicatorId: 'indicator-a' },
        ],
      },
      panelId: 'blue-panel',
      patch: {
        widgetKey: 'editor_workflow',
        params: { workflowId: 'workflow-1' },
      },
    })

    expect(result.widget).toEqual({
      key: 'editor_workflow',
      pairColor: 'blue',
      params: null,
    })
    expect(result.colorPairs).toEqual({
      pairs: [
        { color: 'blue', indicatorId: 'indicator-a', workflowId: 'workflow-1' },
        { color: 'red', indicatorId: 'indicator-a' },
      ],
    })
  })

  it('rejects unsupported widget params before persistence', () => {
    expect(() => apply({ patch: { params: { listing, invented: true } } })).toThrow(
      'params.invented: Widget "data_chart" does not support this field'
    )
  })

  it('patches provided params by default without replacing existing local params', () => {
    const result = apply({ patch: { params: { view: { interval: '1h' } } } })

    expect(result.widget?.params).toEqual({
      data: { provider: 'alpaca' },
      view: { interval: '1h' },
    })
  })

  it('replaces params only when the internal params mode is explicit', () => {
    const result = apply({
      patch: { paramsMode: 'replace', params: { view: { interval: '1h' } } },
    })

    expect(result.widget?.params).toEqual({ view: { interval: '1h' } })
  })

  it('edits heatmap into a portfolio-backed trading account with market credentials', () => {
    const result = apply({
      layout: panel('heatmap-panel', 'heatmap', 'gray'),
      panelId: 'heatmap-panel',
      patch: {
        params: {
          sourceMode: 'portfolio',
          marketProvider: 'alpaca',
          marketAuth: {
            apiKey: 'raw-key',
            apiSecret: '{{ ALPACA_API_SECRET }}',
          },
          tradingProvider: 'alpaca',
          serviceId: 'alpaca-live',
          portfolioIdentity,
        },
      },
    })

    expect(result.widget?.params).toEqual({
      sourceMode: 'portfolio',
      marketProvider: 'alpaca',
      marketAuth: {
        apiKey: 'raw-key',
        apiSecret: '{{ ALPACA_API_SECRET }}',
      },
      tradingProvider: 'alpaca',
      serviceId: 'alpaca-live',
      portfolioIdentity,
    })
  })

  it('edits data-chart provider credentials and nested indicator refs through canonical params', () => {
    const patch = {
      params: {
        data: {
          provider: 'alpaca',
          providerParams: { feed: 'iex' },
          auth: { apiKey: 'raw-key', apiSecret: '{{ ALPACA_API_SECRET }}' },
        },
        view: {
          interval: '1h',
          pineIndicators: [{ id: 'indicator-1', inputs: { Length: 20 }, visible: true }],
        },
      },
    }

    expect(plan({ patch }).references).toEqual([
      {
        panelId: 'chart-panel',
        path: 'chart-panel.view.pineIndicators[0].id',
        field: 'indicatorId',
        value: 'indicator-1',
      },
    ])

    const result = applyProven({ patch })
    expect(result.widget?.params).toEqual({
      data: {
        provider: 'alpaca',
        providerParams: { feed: 'iex' },
        auth: { apiKey: 'raw-key', apiSecret: '{{ ALPACA_API_SECRET }}' },
      },
      view: {
        interval: '1h',
        pineIndicators: [{ id: 'indicator-1', inputs: { Length: 20 }, visible: true }],
      },
    })
  })

  it('rejects colorPair for gray widgets', () => {
    expect(() => apply({ patch: { pairColor: 'gray', colorPair: { listing } } })).toThrow(
      'colorPair requires a non-gray pairColor'
    )
  })

  it('deletes one linked color-pair field when colorPair contains an explicit null', () => {
    const result = apply({
      colorPairs: { pairs: [{ color: 'red', listing: normalizedListing }] },
      patch: { colorPair: { listing: null } },
    })

    expect(result.colorPairs).toEqual({ pairs: [] })
  })

  it('accepts identical linked field values submitted in both params and colorPair once', () => {
    const result = applyProven({
      patch: { params: { listing }, colorPair: { listing } },
    })

    expect(result.colorPairs).toEqual({
      pairs: [{ color: 'red', listing: normalizedListing }],
    })
  })

  it('rejects conflicting linked field values in params and colorPair pointing at both paths', () => {
    const conflictingListing = {
      listing_type: 'default',
      listing_id: 'MSFT',
      base_id: 'MSFT',
      quote_id: 'USD',
    }

    expect(() =>
      plan({
        patch: {
          params: { listing },
          colorPair: { listing: conflictingListing },
        },
      })
    ).toThrow(
      'params.listing: Conflicting linked colorPair field "listing" submitted in params and colorPair; colorPair.listing: Conflicting linked colorPair field "listing" submitted in params and colorPair'
    )
  })

  it('preserves color-store fields after pair-color changes', () => {
    const result = apply({
      colorPairs: { pairs: [{ color: 'red', listing: normalizedListing }] },
      patch: { pairColor: 'gray' },
    })

    expect(result.colorPairs).toEqual({
      pairs: [{ color: 'red', listing: normalizedListing }],
    })
  })

  it('carries switching widget fields without pruning source color store', () => {
    const over: Partial<MutationInput> = {
      layout: group(
        panel('chart-panel', 'data_chart', 'red'),
        panel('workflow-panel', 'editor_workflow', 'blue')
      ),
      colorPairs: {
        pairs: [
          {
            color: 'red',
            workflowId: 'workflow-red',
            listing: normalizedListing,
          },
        ],
      },
      patch: { pairColor: 'blue' },
    }

    expect(plan(over).references).toEqual([
      {
        panelId: 'chart-panel',
        path: 'chart-panel.listing',
        field: 'listing',
        value: 'default|AAPL||',
      },
    ])
    expect(applyProven(over).colorPairs).toEqual({
      pairs: [
        { color: 'blue', listing: normalizedListing },
        {
          color: 'red',
          workflowId: 'workflow-red',
          listing: normalizedListing,
        },
      ],
    })
  })

  it('requires validation proof for workflow ids carried during pair-color switches', () => {
    const over: Partial<MutationInput> = {
      layout: workflowLayout(),
      colorPairs: { pairs: [{ color: 'red', workflowId: 'workflow-red' }] },
      panelId: 'panel-workflow',
      patch: { pairColor: 'blue' },
    }

    expect(plan(over).references).toEqual([
      {
        panelId: 'panel-workflow',
        path: 'panel-workflow.workflowId',
        field: 'workflowId',
        value: 'workflow-red',
      },
    ])
    expect(() => apply(over)).toThrow('validation scope is required')
    expect(applyProven(over).colorPairs).toEqual({
      pairs: [
        { color: 'blue', workflowId: 'workflow-red' },
        { color: 'red', workflowId: 'workflow-red' },
      ],
    })
  })

  it('lets explicit colorPair fields override carried pair-color state before validation', () => {
    const colorPairs = () => ({
      pairs: [{ color: 'red' as const, workflowId: 'workflow-red' }],
    })
    const overridePatch: Partial<MutationInput> = {
      layout: workflowLayout(),
      colorPairs: colorPairs(),
      panelId: 'panel-workflow',
      patch: { pairColor: 'blue', colorPair: { workflowId: 'workflow-blue' } },
    }

    expect(plan(overridePatch).references).toEqual([
      {
        panelId: 'panel-workflow',
        path: 'panel-workflow.workflowId',
        field: 'workflowId',
        value: 'workflow-blue',
      },
    ])
    expect(applyProven(overridePatch).colorPairs).toEqual({
      pairs: [
        { color: 'blue', workflowId: 'workflow-blue' },
        { color: 'red', workflowId: 'workflow-red' },
      ],
    })

    const deletePatch: Partial<MutationInput> = {
      layout: workflowLayout(),
      colorPairs: colorPairs(),
      panelId: 'panel-workflow',
      patch: { pairColor: 'blue', colorPair: { workflowId: null } },
    }

    expect(plan(deletePatch).references).toEqual([])
    expect(apply(deletePatch).colorPairs).toEqual({
      pairs: [{ color: 'red', workflowId: 'workflow-red' }],
    })
  })

  it('rejects unknown panel ids', () => {
    expect(() => apply({ panelId: 'missing-panel', patch: { widgetKey: 'watchlist' } })).toThrow(
      'Unknown dashboard panel id'
    )
  })

  it('removes widgets only through an explicit target remove list', () => {
    const result = apply({
      colorPairs: { pairs: [{ color: 'red', listing: normalizedListing }] },
      patch: { removedWidgetPanelIds: ['chart-panel'] },
    })

    expect(result.beforeWidget).toEqual({
      key: 'data_chart',
      pairColor: 'red',
      params: { data: { provider: 'alpaca' } },
    })
    expect(result.widget).toBeNull()
    expect(result.colorPairs).toEqual({
      pairs: [{ color: 'red', listing: normalizedListing }],
    })
    expect(result.changedPaths).toContain('widget.key')
  })

  it('rejects placeholder-style widget removal and mixed remove edits', () => {
    expect(() => apply({ patch: { widgetKey: 'empty' } })).toThrow('Unknown widget key "empty"')
    expect(() =>
      apply({
        patch: {
          removedWidgetPanelIds: ['chart-panel'],
          widgetKey: 'watchlist',
        },
      })
    ).toThrow('Widget removal cannot be combined')
    expect(() => apply({ patch: { removedWidgetPanelIds: ['order-panel'] } })).toThrow(
      'edit_widget can only remove the target panel widget'
    )
  })

  it('rejects unknown persisted widget keys during reference collection', () => {
    expect(() =>
      collectDashboardLayoutReferenceCandidates(unknownWidgetLayout(), {
        pairs: [],
      })
    ).toThrow('Unknown widget key "unknown_widget"')
  })

  it.each<MutationInput['patch']>([
    { params: { data: { provider: 'alpaca' } } },
    { widgetKey: 'watchlist' },
  ])('rejects mutations against unknown current widget keys (%j)', (patch) => {
    expect(() => apply({ layout: unknownWidgetLayout(), panelId: 'panel-unknown', patch })).toThrow(
      'Unknown widget key "unknown_widget"'
    )
  })

  it('requires scoped reference validation proof before applying entity references', () => {
    const patch = {
      widgetKey: 'editor_workflow',
      params: { workflowId: 'workflow-1' },
    }
    const candidates = plan({ patch }).references
    const proof = (
      over: Partial<WidgetReferenceValidationResult>
    ): WidgetReferenceValidationResult => ({
      ...scope,
      panelId: 'chart-panel',
      widgetKey: 'editor_workflow',
      candidates,
      ...over,
    })

    expect(candidates).toEqual([
      {
        panelId: 'chart-panel',
        path: 'chart-panel.workflowId',
        field: 'workflowId',
        value: 'workflow-1',
      },
    ])
    expect(() => apply({ patch })).toThrow('validation scope is required')
    expect(() => apply({ patch, referenceValidation: proof({}) })).toThrow(
      'validation scope is required'
    )
    expect(() =>
      apply({
        patch,
        referenceValidationScope: scope,
        referenceValidation: proof({
          workspaceId: 'workspace-2',
          ownerUserId: 'user-2',
        }),
      })
    ).toThrow('proof scope does not match')
    expect(() => apply({ patch, referenceValidationScope: scope })).toThrow(
      'validation proof is required'
    )

    const result = apply({
      patch,
      referenceValidationScope: scope,
      referenceValidation: proof({}),
    })
    expect(result.widget).toEqual({
      key: 'editor_workflow',
      pairColor: 'red',
      params: null,
    })
    expect(result.colorPairs).toEqual({
      pairs: [{ color: 'red', workflowId: 'workflow-1' }],
    })
  })
})

function proofForPlan(plan: PlannedWidgetConfigMutation): WidgetReferenceValidationResult {
  return {
    ...scope,
    panelId: plan.panelId,
    widgetKey: plan.afterWidget?.key as WidgetReferenceValidationResult['widgetKey'],
    candidates: plan.references,
  }
}
