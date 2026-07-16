import { describe, expect, it } from 'vitest'
import { hashServerToolReviewBase } from '@/lib/copilot/tools/server/base-tool'
import {
  buildDashboardLayoutReviewBase,
  buildDashboardWidgetReviewBase,
} from '@/lib/dashboard-layouts/review-base'
import {
  applyLayoutEditDocument,
  type DashboardLayoutProjectionContent,
  findDashboardTopologyPanel,
} from '@/widgets/layout-document'
import {
  applyWidgetConfigMutation,
  type WidgetConfigMutationPatch,
} from '@/widgets/widget-mutations'

const listing = (listingId: string) => ({
  listing_type: 'default' as const,
  listing_id: listingId,
  base_id: '',
  quote_id: '',
})

const createContent = (): DashboardLayoutProjectionContent => ({
  layout: {
    id: 'root',
    type: 'group',
    direction: 'horizontal',
    sizes: [50, 50],
    children: [
      {
        id: 'chart-panel',
        type: 'panel',
        identityId: 'chart-widget',
        widgetKey: 'data_chart',
      },
      {
        id: 'order-panel',
        type: 'panel',
        identityId: 'order-widget',
        widgetKey: 'quick_order',
      },
    ],
  },
  widgets: {
    'chart-widget': { pairColor: 'red', params: { view: { interval: '15m' } } },
    'order-widget': { pairColor: 'gray', params: { side: 'buy' } },
  },
  colorPairs: {
    pairs: [
      { color: 'blue', listing: listing('MSFT'), workflowId: 'workflow-1' },
      { color: 'green', listing: listing('TSLA') },
      { color: 'red', listing: listing('AAPL') },
    ],
  },
})

const widgetReviewHash =
  (patch: WidgetConfigMutationPatch) => (content: DashboardLayoutProjectionContent) => {
    const panel = findDashboardTopologyPanel(content.layout, 'chart-panel')!
    const mutation = applyWidgetConfigMutation({
      origin: 'copilot',
      widgetKey: panel.widgetKey!,
      widget: content.widgets[panel.identityId],
      colorPairs: content.colorPairs,
      panelId: panel.id,
      patch,
    })
    return hashServerToolReviewBase(
      buildDashboardWidgetReviewBase(content, panel.id, mutation.reviewBase, patch)
    )
  }

describe('dashboard review bases', () => {
  it('hashes only topology for a layout edit, never child widget documents', () => {
    const content = createContent()
    const plan = applyLayoutEditDocument(
      { layout: content.layout },
      JSON.stringify({
        layout: {
          id: 'root',
          type: 'group',
          direction: 'horizontal',
          sizes: [100],
          children: [{ id: 'chart-panel', type: 'panel' }],
        },
      }),
      ['order-panel']
    )
    const hash = (current: DashboardLayoutProjectionContent) =>
      hashServerToolReviewBase(buildDashboardLayoutReviewBase(current, plan))

    const doomedWidgetChanged = structuredClone(content)
    doomedWidgetChanged.widgets['order-widget'].params = { side: 'sell' }
    const retainedWidgetChanged = structuredClone(content)
    retainedWidgetChanged.widgets['chart-widget'].params = { view: { interval: '1h' } }

    expect(hash(doomedWidgetChanged)).toBe(hash(content))
    expect(hash(retainedWidgetChanged)).toBe(hash(content))
  })

  it('tracks only destination color-pair fields overwritten by a widget patch', () => {
    const content = createContent()
    const patch = { pairColor: 'blue', colorPair: { listing: listing('NVDA') } }
    const hash = widgetReviewHash(patch)

    const destinationChanged = structuredClone(content)
    destinationChanged.colorPairs.pairs[0].listing = listing('GOOG')
    const unrelatedFieldChanged = structuredClone(content)
    unrelatedFieldChanged.colorPairs.pairs[0].workflowId = 'workflow-2'
    const unrelatedChannelChanged = structuredClone(content)
    unrelatedChannelChanged.colorPairs.pairs[1].listing = listing('AMZN')

    expect(hash(destinationChanged)).not.toBe(hash(content))
    expect(hash(unrelatedFieldChanged)).toBe(hash(content))
    expect(hash(unrelatedChannelChanged)).toBe(hash(content))
  })

  it('tracks the complete destination color pair when deleting it', () => {
    const content = createContent()
    const hash = widgetReviewHash({ pairColor: 'blue', colorPair: null })
    const destinationChanged = structuredClone(content)
    destinationChanged.colorPairs.pairs[0].workflowId = 'workflow-2'

    expect(hash(destinationChanged)).not.toBe(hash(content))
  })

  it('tracks only linked destination fields activated by a pairColor-only edit', () => {
    const content = createContent()
    const hash = widgetReviewHash({ pairColor: 'blue' })
    const destinationChanged = structuredClone(content)
    destinationChanged.colorPairs.pairs[0].listing = listing('GOOG')
    const destinationUnrelatedChanged = structuredClone(content)
    destinationUnrelatedChanged.colorPairs.pairs[0].workflowId = 'workflow-2'
    const sourceChanged = structuredClone(content)
    sourceChanged.colorPairs.pairs[2].listing = listing('NVDA')
    const otherChannelChanged = structuredClone(content)
    otherChannelChanged.colorPairs.pairs[1].listing = listing('AMZN')
    const paramsChanged = structuredClone(content)
    paramsChanged.widgets['chart-widget'].params = { view: { interval: '1h' } }
    const pairColorChanged = structuredClone(content)
    pairColorChanged.widgets['chart-widget'].pairColor = 'green'
    const destinationMissing = structuredClone(content)
    destinationMissing.colorPairs.pairs[0].listing = undefined
    const destinationAdded = structuredClone(destinationMissing)
    destinationAdded.colorPairs.pairs[0].listing = listing('GOOG')

    expect(hash(destinationChanged)).not.toBe(hash(content))
    expect(hash(destinationUnrelatedChanged)).toBe(hash(content))
    expect(hash(sourceChanged)).toBe(hash(content))
    expect(hash(otherChannelChanged)).toBe(hash(content))
    expect(hash(paramsChanged)).toBe(hash(content))
    expect(hash(pairColorChanged)).not.toBe(hash(content))
    expect(hash(destinationAdded)).not.toBe(hash(destinationMissing))
    const samePairHash = widgetReviewHash({ pairColor: 'red' })
    expect(samePairHash(sourceChanged)).toBe(samePairHash(content))
  })

  it('tracks only local linked fields activated when unlinking to gray', () => {
    const content = createContent()
    content.widgets['chart-widget'].params = {
      listing: listing('MSFT'),
      view: { interval: '15m' },
    }
    const hash = widgetReviewHash({ pairColor: 'gray' })
    const linkedChanged = structuredClone(content)
    linkedChanged.widgets['chart-widget'].params!.listing = listing('GOOG')
    const unrelatedChanged = structuredClone(content)
    ;(unrelatedChanged.widgets['chart-widget'].params!.view as Record<string, unknown>).interval =
      '1h'

    expect(hash(linkedChanged)).not.toBe(hash(content))
    expect(hash(unrelatedChanged)).toBe(hash(content))
  })

  it('tracks untouched linked fields when rebinding with a partial color-pair patch', () => {
    const content = createContent()
    const panel = findDashboardTopologyPanel(content.layout, 'chart-panel')!
    panel.widgetKey = 'watchlist'
    content.widgets['chart-widget'].params = null
    content.colorPairs.pairs[0].watchlistId = 'watchlist-1'
    const patch = { pairColor: 'blue', colorPair: { listing: listing('NVDA') } }
    const hash = widgetReviewHash(patch)
    const linkedChanged = structuredClone(content)
    linkedChanged.colorPairs.pairs[0].watchlistId = 'watchlist-2'
    const unrelatedChanged = structuredClone(content)
    unrelatedChanged.colorPairs.pairs[0].workflowId = 'workflow-2'

    expect(hash(linkedChanged)).not.toBe(hash(content))
    expect(hash(unrelatedChanged)).toBe(hash(content))
  })

  it('tracks only nested params fields selected by the widget contract merger', () => {
    const content = createContent()
    content.widgets['chart-widget'].params = {
      data: { provider: 'alpaca' },
      view: { interval: '15m', candleType: 'candle_solid' },
      runtime: { refreshAt: 1 },
    }
    const patch = { params: { view: { interval: '1h' } } }
    const hash = widgetReviewHash(patch)
    const touchedFieldChanged = structuredClone(content)
    ;(
      touchedFieldChanged.widgets['chart-widget'].params!.view as Record<string, unknown>
    ).interval = '30m'
    const siblingFieldChanged = structuredClone(content)
    ;(
      siblingFieldChanged.widgets['chart-widget'].params!.view as Record<string, unknown>
    ).candleType = 'area'
    const unrelatedFieldChanged = structuredClone(content)
    ;(
      unrelatedFieldChanged.widgets['chart-widget'].params!.runtime as Record<string, unknown>
    ).refreshAt = 2

    expect(hash(touchedFieldChanged)).not.toBe(hash(content))
    expect(hash(siblingFieldChanged)).toBe(hash(content))
    expect(hash(unrelatedFieldChanged)).toBe(hash(content))
  })

  it('tracks params that contract normalization can rewrite through a selector change', () => {
    const content = createContent()
    content.widgets['chart-widget'].params = {
      data: {
        provider: 'alpaca',
        providerParams: { feed: 'iex' },
        auth: { apiKey: 'stored-key' },
      },
    }
    const patch = { params: { data: { provider: 'polygon' } } }
    const hash = widgetReviewHash(patch)
    const dependentChanged = structuredClone(content)
    ;(
      dependentChanged.widgets['chart-widget'].params!.data as Record<string, unknown>
    ).providerParams = { feed: 'sip' }
    const unrelatedChanged = structuredClone(content)
    ;(unrelatedChanged.widgets['chart-widget'].params!.data as Record<string, unknown>).auth = {
      apiKey: 'concurrent-key',
    }

    expect(hash(dependentChanged)).not.toBe(hash(content))
    expect(hash(unrelatedChanged)).toBe(hash(content))
  })

  it('omits only credential values represented by preservation placeholders', () => {
    const content = createContent()
    content.widgets['chart-widget'].params = {
      data: {
        auth: {
          apiKey: 'stored-key',
          apiSecret: 'stored-secret',
          account: 'primary',
        },
      },
    }
    const preservedPatch = { params: { data: { auth: { apiKey: '[redacted]' } } } }
    const preservedHash = widgetReviewHash(preservedPatch)
    const credentialChanged = structuredClone(content)
    ;(
      (credentialChanged.widgets['chart-widget'].params!.data as Record<string, unknown>)
        .auth as Record<string, unknown>
    ).apiKey = 'concurrent-key'
    const overwrittenSiblingChanged = structuredClone(content)
    ;(
      (overwrittenSiblingChanged.widgets['chart-widget'].params!.data as Record<string, unknown>)
        .auth as Record<string, unknown>
    ).apiSecret = 'concurrent-secret'

    expect(preservedHash(credentialChanged)).toBe(preservedHash(content))
    expect(preservedHash(overwrittenSiblingChanged)).not.toBe(preservedHash(content))

    const replacementPatch = { params: { data: { auth: { apiKey: 'replacement-key' } } } }
    const replacementHash = widgetReviewHash(replacementPatch)
    expect(replacementHash(credentialChanged)).not.toBe(replacementHash(content))
  })

  it('allows unrelated fields in the same color pair and rejects target rebinding', () => {
    const content = createContent()
    const patch = { colorPair: { listing: listing('NVDA') } }
    const hash = widgetReviewHash(patch)
    const unrelatedPairFieldChanged = structuredClone(content)
    unrelatedPairFieldChanged.colorPairs.pairs[2].workflowId = 'workflow-2'
    const rebound = structuredClone(content)
    const panel = findDashboardTopologyPanel(rebound.layout, 'chart-panel')!
    panel.identityId = 'replacement-widget'
    rebound.widgets['replacement-widget'] = structuredClone(rebound.widgets['chart-widget'])

    expect(hash(unrelatedPairFieldChanged)).toBe(hash(content))
    expect(hash(rebound)).not.toBe(hash(content))
  })
})
