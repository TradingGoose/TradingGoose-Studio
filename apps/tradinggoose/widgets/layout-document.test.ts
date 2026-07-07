import { describe, expect, it } from 'vitest'
import {
  applyLayoutEditDocument,
  type DashboardLayoutDocumentFields,
  DashboardLayoutDocumentSchema,
  DashboardLayoutStructureDocumentSchema,
  normalizeDashboardLayoutDocumentFields,
  resolveEffectiveDashboardLayout,
} from '@/widgets/layout-document'

const baseFields = (): DashboardLayoutDocumentFields => ({
  name: 'Base Layout',
  layout: {
    id: 'root',
    type: 'group',
    direction: 'horizontal',
    sizes: [50, 50],
    children: [
      {
        id: 'panel-a',
        type: 'panel',
        widget: { key: 'editor_workflow', pairColor: 'red', params: { workflowId: 'wf-a' } },
      },
      {
        id: 'panel-b',
        type: 'panel',
        widget: { key: 'watchlist', pairColor: 'gray', params: { watchlistId: 'watchlist-a' } },
      },
    ],
  },
  colorPairs: { pairs: [{ color: 'red', workflowId: 'wf-linked' }] },
  isActive: false,
  sortOrder: 2,
})

const retainedPanelStructure = () => ({
  id: 'root',
  type: 'group',
  direction: 'horizontal',
  sizes: [50, 50],
  children: [
    { id: 'panel-a', type: 'panel' },
    { id: 'panel-b', type: 'panel' },
  ],
})

const rootGroup = (children: unknown[], extra: Record<string, unknown> = {}) => ({
  id: 'root',
  type: 'group',
  direction: 'horizontal',
  sizes: [50, 50],
  ...extra,
  children,
})

const panel = (id: string | undefined, widget: unknown) =>
  ({ ...(id === undefined ? {} : { id }), type: 'panel', widget }) as Record<string, unknown>

const workflowWidget = (pairColor = 'gray') => ({
  key: 'editor_workflow',
  pairColor,
  params: { workflowId: 'wf-a' },
})

const withFields = (overrides: Record<string, unknown>) =>
  ({ ...baseFields(), ...overrides }) as any

const withoutField = (key: string) => {
  const fields = { ...baseFields() } as any
  delete fields[key]
  return fields
}

const cryptoListing = {
  listing_type: 'crypto',
  listing_id: '',
  base_id: 'BTC',
  quote_id: 'USD',
} as const
const currencyListing = {
  listing_type: 'currency',
  listing_id: '',
  base_id: 'EUR',
  quote_id: 'USD',
} as const

describe('normalizeDashboardLayoutDocumentFields', () => {
  it.each([
    [
      'unknown widget keys',
      withFields({
        layout: panel('panel-unknown', { key: 'unknown_widget', pairColor: 'gray', params: null }),
      }),
      'Unknown widget key "unknown_widget"',
    ],
    [
      'unsupported widget params',
      withFields({
        layout: panel('panel-a', {
          key: 'editor_workflow',
          pairColor: 'gray',
          params: {
            workflowId: 'wf-a',
            listing: { listing_type: 'default', listing_id: 'AAPL', base_id: '', quote_id: '' },
          },
        }),
      }),
      'params.listing: Widget "editor_workflow" does not support this field',
    ],
    ['a null layout', withFields({ layout: null }), 'layout must be a layout node object'],
    ['a missing layout', withoutField('layout'), 'dashboard layout document requires layout'],
    [
      'null colorPairs',
      withFields({ colorPairs: null }),
      'dashboard layout document colorPairs must be an object',
    ],
    [
      'missing colorPairs',
      withoutField('colorPairs'),
      'dashboard layout document requires colorPairs',
    ],
    [
      'gray color-pair colors',
      withFields({ colorPairs: { pairs: [{ color: 'gray' }] } }),
      'dashboard layout document colorPairs.pairs[0].color must be a linked pair color',
    ],
    [
      'missing isActive',
      withoutField('isActive'),
      'dashboard layout document requires boolean isActive',
    ],
    [
      'non-boolean isActive',
      withFields({ isActive: 'true' }),
      'dashboard layout document requires boolean isActive',
    ],
    [
      'non-integer sortOrder',
      withFields({ sortOrder: 1.5 }),
      'dashboard layout document requires an integer sortOrder',
    ],
    [
      'layout nodes without ids',
      withFields({ layout: panel(undefined, null) }),
      'layout.id must be a non-empty string',
    ],
    [
      'groups without children',
      withFields({ layout: rootGroup([], { sizes: [100] }) }),
      'layout.children must contain at least one node',
    ],
    [
      'group sizes not matching children',
      withFields({
        layout: rootGroup([panel('panel-a', null), panel('panel-b', null)], { sizes: [50] }),
      }),
      'layout.sizes must contain one positive size per child',
    ],
    [
      'invalid widget pair colors',
      withFields({ layout: panel('panel-a', workflowWidget('not-a-color')) }),
      'layout.widget.pairColor must be a valid pair color',
    ],
  ])('rejects %s', (_name, fields, message) => {
    expect(() => normalizeDashboardLayoutDocumentFields(fields)).toThrow(message)
  })

  it('uses the canonical listing identity schema for crypto and currency color-pair listings', () => {
    const fields = {
      ...baseFields(),
      colorPairs: {
        pairs: [
          { color: 'red', listing: cryptoListing },
          { color: 'blue', listing: currencyListing },
        ],
      },
    } satisfies DashboardLayoutDocumentFields

    expect(DashboardLayoutDocumentSchema.safeParse(fields).success).toBe(true)
    expect(normalizeDashboardLayoutDocumentFields(fields).colorPairs).toEqual({
      pairs: [
        { color: 'red', listing: cryptoListing },
        { color: 'blue', listing: currencyListing },
      ],
    })
  })
})

describe('exported document schemas', () => {
  it.each([
    ['a valid full document', baseFields(), true],
    [
      'unknown widget keys',
      withFields({
        layout: panel('panel-unknown', { key: 'unknown_widget', pairColor: 'gray', params: null }),
      }),
      false,
    ],
    [
      'layout nodes without a type',
      withFields({ layout: { id: 'panel-missing-type', widget: null } }),
      false,
    ],
  ])('full document schema: %s -> %s', (_name, payload, success) => {
    expect(DashboardLayoutDocumentSchema.safeParse(payload).success).toBe(success)
  })

  it.each([
    [
      'a valid structure document',
      { layout: retainedPanelStructure(), name: 'Next', sortOrder: 1, isActive: true },
      true,
    ],
    [
      'colorPairs at the top level',
      { layout: retainedPanelStructure(), colorPairs: { pairs: [] } },
      false,
    ],
    [
      'nodes without a type',
      { layout: { id: 'panel-missing-type', widget: { key: 'heatmap' } } },
      false,
    ],
    ['unknown widget keys', { layout: { type: 'panel', widget: { key: 'not_a_widget' } } }, false],
    ['isActive false', { layout: retainedPanelStructure(), isActive: false }, false],
    [
      'node-level metadata',
      { layout: { ...retainedPanelStructure(), name: 'Bad node metadata' } },
      false,
    ],
  ])('structure document schema: %s -> %s', (_name, payload, success) => {
    expect(DashboardLayoutStructureDocumentSchema.safeParse(payload).success).toBe(success)
  })
})

describe('applyLayoutEditDocument', () => {
  it('preserves retained panel widget config and layout color pairs', () => {
    const next = applyLayoutEditDocument(
      baseFields(),
      JSON.stringify({
        name: 'Renamed Layout',
        sortOrder: 0,
        isActive: true,
        layout: {
          id: 'root',
          type: 'group',
          direction: 'vertical',
          sizes: [100],
          children: [{ id: 'panel-a', type: 'panel' }],
        },
      }),
      ['panel-b']
    )

    expect(next.name).toBe('Renamed Layout')
    expect(next.sortOrder).toBe(0)
    expect(next.isActive).toBe(true)
    expect(next.colorPairs).toEqual({ pairs: [{ color: 'red', workflowId: 'wf-linked' }] })
    expect(next.layout).toMatchObject({
      type: 'group',
      direction: 'vertical',
      children: [
        {
          id: 'panel-a',
          widget: { key: 'editor_workflow', pairColor: 'red', params: { workflowId: 'wf-a' } },
        },
      ],
    })
  })

  it.each<{ name: string; doc: Record<string, unknown>; removed?: string[]; error: string }>([
    {
      name: 'omitted panels without explicit removal intent',
      doc: { layout: { id: 'panel-a', type: 'panel' } },
      error: 'Existing panel ids omitted from edit_layout entityDocument without removedPanelIds',
    },
    {
      name: 'colorPairs edits through the structure document',
      doc: { colorPairs: { pairs: [] }, layout: baseFields().layout },
      error: 'edit_layout cannot modify colorPairs',
    },
    {
      name: 'colorPair edits through the structure document',
      doc: { colorPair: { red: { workflowId: 'wf-a' } }, layout: baseFields().layout },
      error: 'edit_layout cannot modify colorPair',
    },
    {
      name: 'retained panel widget replacement',
      doc: { layout: panel('panel-a', { key: 'watchlist' }) },
      removed: ['panel-b'],
      error: 'edit_layout cannot replace widget key',
    },
    {
      name: 'widget params in structure document panel nodes',
      doc: {
        layout: panel('panel-a', {
          key: 'editor_workflow',
          pairColor: 'blue',
          params: { workflowId: 'wf-b' },
        }),
      },
      removed: ['panel-b'],
      error: 'edit_layout cannot set widget params',
    },
    {
      name: 'singular colorPair payloads on group nodes',
      doc: {
        layout: rootGroup(
          [
            { id: 'panel-a', type: 'panel' },
            { id: 'panel-b', type: 'panel' },
          ],
          { colorPair: { red: { workflowId: 'wf-a' } } }
        ),
      },
      error: 'edit_layout only accepts colorPair at supported top-level fields',
    },
    {
      name: 'singular colorPair payloads on panel nodes',
      doc: { layout: { id: 'panel-a', type: 'panel', colorPair: { red: { workflowId: 'wf-a' } } } },
      removed: ['panel-b'],
      error: 'edit_layout only accepts colorPair at supported top-level fields',
    },
    {
      name: 'singular colorPair payloads on retained panel widgets',
      doc: {
        layout: panel('panel-a', {
          key: 'editor_workflow',
          colorPair: { red: { workflowId: 'wf-a' } },
        }),
      },
      removed: ['panel-b'],
      error: 'edit_layout cannot set widget colorPair',
    },
    {
      name: 'singular colorPair payloads on new panel widgets',
      doc: {
        layout: rootGroup([
          { id: 'panel-a', type: 'panel' },
          panel(undefined, { key: 'heatmap', colorPair: { red: { workflowId: 'wf-a' } } }),
        ]),
      },
      removed: ['panel-b'],
      error: 'edit_layout cannot set widget colorPair',
    },
    {
      name: 'duplicate submitted existing ids',
      doc: {
        layout: rootGroup([
          { id: 'panel-a', type: 'panel' },
          { id: 'panel-a', type: 'panel' },
        ]),
      },
      removed: ['panel-b'],
      error: 'duplicate existing id: panel-a',
    },
    {
      name: 'caller-provided ids for new groups',
      doc: {
        layout: {
          id: 'caller-group',
          type: 'group',
          direction: 'horizontal',
          sizes: [100],
          children: [panel(undefined, { key: 'heatmap' })],
        },
      },
      removed: ['panel-a', 'panel-b'],
      error: 'submitted group id "caller-group" is not in the base layout',
    },
    {
      name: 'caller-provided ids for new panels',
      doc: { layout: panel('caller-panel', { key: 'heatmap' }) },
      removed: ['panel-a', 'panel-b'],
      error: 'submitted panel id "caller-panel" is not in the base layout',
    },
    {
      name: 'empty groups',
      doc: { layout: rootGroup([], { sizes: [] }) },
      removed: ['panel-a', 'panel-b'],
      error: 'children must contain at least one node',
    },
    {
      name: 'empty removedPanelIds entries',
      doc: { layout: retainedPanelStructure() },
      removed: [''],
      error: 'removedPanelIds must be unique non-empty panel ids',
    },
    {
      name: 'blank removedPanelIds entries',
      doc: { layout: retainedPanelStructure() },
      removed: ['   '],
      error: 'removedPanelIds must be unique non-empty panel ids',
    },
    {
      name: 'duplicate removedPanelIds entries',
      doc: { layout: retainedPanelStructure() },
      removed: ['panel-a', ' panel-a '],
      error: 'removedPanelIds must be unique non-empty panel ids',
    },
    {
      name: 'unknown removedPanelIds entries',
      doc: { layout: retainedPanelStructure() },
      removed: ['missing-panel'],
      error: 'removedPanelIds contains unknown panel id',
    },
    {
      name: 'removedPanelIds still present in the submitted layout',
      doc: { layout: retainedPanelStructure() },
      removed: ['panel-a'],
      error: 'removedPanelIds still appear',
    },
    {
      name: 'isActive false',
      doc: { isActive: false, layout: baseFields().layout },
      error: 'edit_layout can only request isActive: true',
    },
    {
      name: 'node-level metadata',
      doc: { layout: { id: 'panel-a', type: 'panel', name: 'Wrong scope' } },
      removed: ['panel-b'],
      error: 'edit_layout only accepts name at supported top-level fields',
    },
    {
      name: 'unsupported documentFormat values',
      doc: { documentFormat: 'wrong-format', layout: baseFields().layout },
      error: 'Unsupported edit_layout documentFormat',
    },
  ])('rejects $name', ({ doc, removed, error }) => {
    expect(() => applyLayoutEditDocument(baseFields(), JSON.stringify(doc), removed)).toThrow(error)
  })

  it('creates new target-widget panels with server-generated ids and defaults', () => {
    const next = applyLayoutEditDocument(
      baseFields(),
      JSON.stringify({
        layout: rootGroup(
          [{ id: 'panel-a', type: 'panel' }, panel(undefined, { key: 'heatmap' })],
          { sizes: [30, 70] }
        ),
      }),
      ['panel-b']
    )

    expect(next.layout.type).toBe('group')
    if (next.layout.type !== 'group') return
    const newPanel = next.layout.children[1]
    expect(newPanel?.type).toBe('panel')
    if (!newPanel || newPanel.type !== 'panel') return
    expect(newPanel.id).not.toBe('panel-a')
    expect(newPanel.id).not.toBe('panel-b')
    expect(newPanel.widget).toEqual({ key: 'heatmap', pairColor: 'gray', params: null })
  })

  it('removes linked color-pair fields unsupported by retained panels', () => {
    const next = applyLayoutEditDocument(
      baseFields(),
      JSON.stringify({ layout: { id: 'panel-b', type: 'panel' } }),
      ['panel-a']
    )

    expect(next.colorPairs).toEqual({ pairs: [] })
  })

  it('preserves canonical listing identities in color-pair state', () => {
    const next = applyLayoutEditDocument(
      {
        ...baseFields(),
        layout: panel('panel-a', { key: 'data_chart', pairColor: 'red', params: null }) as any,
        colorPairs: {
          pairs: [
            {
              color: 'red',
              listing: {
                listing_type: 'default',
                listing_id: 'MSFT',
                base_id: 'ignored',
                quote_id: 'ignored',
              },
            },
          ],
        },
      },
      JSON.stringify({ layout: { id: 'panel-a', type: 'panel' } })
    )

    expect(next.colorPairs.pairs[0]?.listing).toEqual({
      listing_type: 'default',
      listing_id: 'MSFT',
      base_id: '',
      quote_id: '',
    })
  })
})

describe('resolveEffectiveDashboardLayout', () => {
  it('preserves hydrated linked listing display fields in effective layout only', () => {
    const effective = resolveEffectiveDashboardLayout(
      panel('panel-chart', { key: 'data_chart', pairColor: 'red', params: null }),
      {
        pairs: [
          {
            color: 'red',
            listing: {
              listing_type: 'default',
              listing_id: 'AAPL',
              base_id: '',
              quote_id: '',
              base: 'Apple',
              name: 'Apple Inc.',
            },
          } as any,
        ],
      }
    )

    expect(effective).toMatchObject({
      type: 'panel',
      widget: {
        key: 'data_chart',
        params: { listing: { listing_id: 'AAPL', base: 'Apple', name: 'Apple Inc.' } },
      },
    })
  })
})
