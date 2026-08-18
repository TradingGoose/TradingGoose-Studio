/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import {
  readDashboardColorPairDocument,
  readDashboardWidgetDocument,
  seedDashboardColorPairSession,
  seedDashboardWidgetSession,
} from '@/lib/yjs/dashboard-layout-session'
import {
  useDashboardWidgetRenderState,
  useWidgetConfigRuntimeActions,
  WidgetConfigRuntimeProvider,
} from '@/widgets/widget-config-runtime'

const sessions = vi.hoisted(() => ({
  widgets: new Map<string, Y.Doc>(),
  pairs: new Map<string, Y.Doc>(),
  errors: new Map<string, string>(),
  retry: vi.fn<(entityId: string) => void>(),
}))

vi.mock('@/lib/yjs/use-entity-fields', () => ({
  useYjsTargetSession: (descriptor: { entityKind: string; entityId: string } | null) => ({
    result: null,
    doc:
      descriptor?.entityKind === 'dashboard_widget'
        ? (sessions.widgets.get(descriptor.entityId) ?? null)
        : descriptor?.entityKind === 'dashboard_color_pair'
          ? (sessions.pairs.get(descriptor.entityId) ?? null)
          : null,
    isLoading: false,
    isRetrying: false,
    error: descriptor ? (sessions.errors.get(descriptor.entityId) ?? null) : null,
    retry: () => descriptor && sessions.retry(descriptor.entityId),
  }),
}))

const AAPL = {
  listing_type: 'default' as const,
  listing_id: 'AAPL',
  base_id: '',
  quote_id: '',
}

describe('independent widget config runtime owners', () => {
  let container: HTMLDivElement
  let root: Root
  let widgetDoc: Y.Doc
  let pairDoc: Y.Doc
  let bluePairDoc: Y.Doc
  let renderState: ReturnType<typeof useDashboardWidgetRenderState> | null = null
  let actions: ReturnType<typeof useWidgetConfigRuntimeActions> | null = null

  const Capture = () => {
    renderState = useDashboardWidgetRenderState()
    actions = useWidgetConfigRuntimeActions()
    return null
  }

  const render = () => {
    act(() => {
      root.render(
        <WidgetConfigRuntimeProvider
          workspaceId='workspace-1'
          ownerUserId='user-1'
          layoutId='layout-1'
          identityId='widget-1'
          widgetKey='data_chart'
        >
          <Capture />
        </WidgetConfigRuntimeProvider>
      )
    })
  }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    widgetDoc = new Y.Doc()
    pairDoc = new Y.Doc()
    bluePairDoc = new Y.Doc()
    seedDashboardWidgetSession(widgetDoc, {
      pairColor: 'red',
      params: { view: { interval: '1m' } },
    })
    seedDashboardColorPairSession(pairDoc, { listing: AAPL })
    seedDashboardColorPairSession(bluePairDoc, {
      listing: { ...AAPL, listing_id: 'MSFT' },
    })
    sessions.widgets.set('widget-1', widgetDoc)
    sessions.pairs.set('red', pairDoc)
    sessions.pairs.set('blue', bluePairDoc)
    sessions.errors.clear()
    sessions.retry.mockClear()
    renderState = null
    actions = null
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    widgetDoc.destroy()
    pairDoc.destroy()
    bluePairDoc.destroy()
    sessions.widgets.clear()
    sessions.pairs.clear()
    sessions.errors.clear()
  })

  it('applies local parameter edits through the widget document and rerenders', () => {
    render()
    const pairVector = Y.encodeStateVector(pairDoc)

    act(() => actions?.patchWidgetParams?.({ view: { interval: '1h' } }))

    expect(readDashboardWidgetDocument(widgetDoc, 'data_chart').params).toMatchObject({
      view: { interval: '1h' },
    })
    expect(renderState?.renderWidget?.params).toMatchObject({ view: { interval: '1h' } })
    expect(Y.encodeStateVector(pairDoc)).toEqual(pairVector)
  })

  it('waits for the selected pair owner before exposing effective params or linked edits', () => {
    sessions.widgets.delete('widget-1')
    render()
    expect(renderState).toMatchObject({ isWidgetReady: false, renderWidget: null })
    expect(actions).toEqual({
      changeWidgetPairColor: undefined,
      patchWidgetParams: undefined,
      patchWidgetLinkedParams: undefined,
    })

    sessions.widgets.set('widget-1', widgetDoc)
    sessions.pairs.delete('red')
    render()

    expect(renderState).toMatchObject({
      isWidgetReady: true,
      isEffectiveParamsReady: false,
      renderWidget: null,
    })
    expect(actions?.patchWidgetLinkedParams).toBeUndefined()

    sessions.pairs.set('red', pairDoc)
    render()

    expect(renderState).toMatchObject({
      isEffectiveParamsReady: true,
      renderWidget: {
        params: { view: { interval: '1m' }, listing: AAPL },
      },
    })
    expect(actions?.patchWidgetLinkedParams).toBeTypeOf('function')

    const MSFT = { ...AAPL, listing_id: 'MSFT' }
    const widgetVector = Y.encodeStateVector(widgetDoc)
    act(() => actions?.patchWidgetLinkedParams?.({ listing: MSFT }))
    expect(readDashboardColorPairDocument(pairDoc)).toEqual({ listing: MSFT })
    expect(Y.encodeStateVector(widgetDoc)).toEqual(widgetVector)
  })

  it('writes pair selection locally and rebinds the selected pair subscription', () => {
    render()
    const redVector = Y.encodeStateVector(pairDoc)

    act(() => actions?.changeWidgetPairColor?.('blue'))
    expect(readDashboardWidgetDocument(widgetDoc, 'data_chart').pairColor).toBe('blue')
    expect(renderState?.renderWidget?.params).toMatchObject({
      listing: { ...AAPL, listing_id: 'MSFT' },
    })
    expect(Y.encodeStateVector(pairDoc)).toEqual(redVector)

    act(() =>
      seedDashboardColorPairSession(pairDoc, {
        listing: { ...AAPL, listing_id: 'TSLA' },
      })
    )
    expect(renderState?.renderWidget?.params).toMatchObject({
      listing: { ...AAPL, listing_id: 'MSFT' },
    })

    act(() =>
      seedDashboardColorPairSession(bluePairDoc, {
        listing: { ...AAPL, listing_id: 'NVDA' },
      })
    )
    expect(renderState?.renderWidget?.params).toMatchObject({
      listing: { ...AAPL, listing_id: 'NVDA' },
    })
  })

  it('fills a missing destination field before switching owners and preserves it when unlinked', () => {
    seedDashboardColorPairSession(bluePairDoc, {})
    render()

    act(() => actions?.changeWidgetPairColor?.('blue'))

    expect(readDashboardColorPairDocument(bluePairDoc)).toEqual({ listing: AAPL })
    expect(readDashboardWidgetDocument(widgetDoc, 'data_chart')).toEqual({
      pairColor: 'blue',
      params: { view: { interval: '1m' } },
    })
    expect(readDashboardColorPairDocument(pairDoc)).toEqual({ listing: AAPL })

    act(() => actions?.changeWidgetPairColor?.('gray'))

    expect(readDashboardWidgetDocument(widgetDoc, 'data_chart')).toEqual({
      pairColor: 'gray',
      params: { view: { interval: '1m' }, listing: AAPL },
    })
    expect(readDashboardColorPairDocument(bluePairDoc)).toEqual({ listing: AAPL })
  })

  it('retains a failed destination pair and retries it through the pair failure state', () => {
    sessions.pairs.delete('blue')
    sessions.errors.set('blue', 'Failed to open destination color pair')
    render()

    act(() => actions?.changeWidgetPairColor?.('blue'))

    expect(readDashboardWidgetDocument(widgetDoc, 'data_chart').pairColor).toBe('red')
    expect(renderState?.loadFailure).toBe('pair')
    expect(actions?.changeWidgetPairColor).toBeUndefined()

    act(() => renderState?.retry())
    expect(sessions.retry).toHaveBeenCalledWith('blue')

    sessions.errors.delete('blue')
    sessions.pairs.set('blue', bluePairDoc)
    render()

    expect(readDashboardWidgetDocument(widgetDoc, 'data_chart').pairColor).toBe('blue')
    expect(renderState?.loadFailure).toBeNull()
  })
})
