/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LayoutNode, PersistedColorPairsState } from '@/widgets/layout'

type DocumentMutationResult = {
  layout?: LayoutNode
  colorPairs?: PersistedColorPairsState
} | null

function createDocumentMutationHarness(initial: {
  layout: LayoutNode
  colorPairs: PersistedColorPairsState
}) {
  const results: DocumentMutationResult[] = []
  const onDocumentMutation = (
    compute: (current: {
      layout: LayoutNode
      colorPairs: PersistedColorPairsState
    }) => DocumentMutationResult
  ) => {
    results.push(compute(initial))
  }
  return { results, onDocumentMutation }
}

let rawBunDom: JSDOM | null = null

function defineRawBunDomGlobal(key: string, value: unknown) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value,
  })
}

function installRawBunDom() {
  defineRawBunDomGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  if (typeof document !== 'undefined') return

  rawBunDom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost',
  })
  defineRawBunDomGlobal('window', rawBunDom.window)
  defineRawBunDomGlobal('document', rawBunDom.window.document)
  defineRawBunDomGlobal('HTMLElement', rawBunDom.window.HTMLElement)
  defineRawBunDomGlobal('Node', rawBunDom.window.Node)
  defineRawBunDomGlobal('Event', rawBunDom.window.Event)
  defineRawBunDomGlobal('CustomEvent', rawBunDom.window.CustomEvent)
  defineRawBunDomGlobal('navigator', rawBunDom.window.navigator)
}

const layout = (): LayoutNode => ({
  id: 'root',
  type: 'group',
  direction: 'horizontal',
  sizes: [100],
  children: [
    {
      id: 'panel-1',
      type: 'panel',
      widget: {
        key: 'editor_workflow',
        pairColor: 'red',
        params: null,
      },
    },
  ],
})

const dataChartLayout = (): LayoutNode => ({
  id: 'panel-chart',
  type: 'panel',
  widget: {
    key: 'data_chart',
    pairColor: 'gray',
    params: {
      data: { provider: 'alpaca' },
      view: { interval: '15m' },
    },
  },
})

describe('WidgetConfigRuntimeProvider document mutation', () => {
  let container: HTMLDivElement | null
  let root: Root | null

  beforeEach(() => {
    installRawBunDom()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
    }
    container?.remove()
    root = null
    container = null
  })

  it('writes workflow references directly into the color pair state', async () => {
    const { useWidgetConfigRuntimeActions, WidgetConfigRuntimeProvider } = await import(
      '@/widgets/widget-config-runtime'
    )
    let patchWidgetParams:
      | ((panelId: string, widgetKey: string, params: Record<string, unknown>) => void)
      | null = null
    const { results, onDocumentMutation } = createDocumentMutationHarness({
      layout: layout(),
      colorPairs: { pairs: [] },
    })

    const CaptureActions = () => {
      patchWidgetParams = useWidgetConfigRuntimeActions().patchWidgetParams
      return null
    }

    act(() => {
      root?.render(
        <WidgetConfigRuntimeProvider
          context={{
            workspaceId: 'workspace-1',
            dashboardLayoutOwnerUserId: 'user-1',
          }}
          layout={layout()}
          colorPairs={{ pairs: [] } satisfies PersistedColorPairsState}
          canWrite
          onDocumentMutation={onDocumentMutation}
        >
          <CaptureActions />
        </WidgetConfigRuntimeProvider>
      )
    })

    expect(patchWidgetParams).not.toBeNull()

    act(() => {
      patchWidgetParams?.('panel-1', 'editor_workflow', {
        workflowId: 'workflow-1',
      })
    })
    expect(results.at(-1)).toEqual({
      colorPairs: {
        pairs: [{ color: 'red', workflowId: 'workflow-1' }],
      },
    })
  })

  it('does not apply runtime widget mutations when writes are disabled', async () => {
    const { useWidgetConfigRuntimeActions, WidgetConfigRuntimeProvider } = await import(
      '@/widgets/widget-config-runtime'
    )
    let patchWidgetParams:
      | ((panelId: string, widgetKey: string, params: Record<string, unknown>) => void)
      | null = null
    const { results, onDocumentMutation } = createDocumentMutationHarness({
      layout: layout(),
      colorPairs: { pairs: [] },
    })

    const CaptureActions = () => {
      patchWidgetParams = useWidgetConfigRuntimeActions().patchWidgetParams
      return null
    }

    act(() => {
      root?.render(
        <WidgetConfigRuntimeProvider
          context={{
            workspaceId: 'workspace-1',
            dashboardLayoutOwnerUserId: 'user-1',
          }}
          layout={layout()}
          colorPairs={{ pairs: [] } satisfies PersistedColorPairsState}
          canWrite={false}
          onDocumentMutation={onDocumentMutation}
        >
          <CaptureActions />
        </WidgetConfigRuntimeProvider>
      )
    })

    act(() => {
      patchWidgetParams?.('panel-1', 'editor_workflow', {
        workflowId: 'workflow-1',
      })
    })

    expect(results).toHaveLength(0)
  })

  it('writes nested data-chart indicator references', async () => {
    const { useWidgetConfigRuntimeActions, WidgetConfigRuntimeProvider } = await import(
      '@/widgets/widget-config-runtime'
    )
    let patchWidgetParams:
      | ((panelId: string, widgetKey: string, params: Record<string, unknown>) => void)
      | null = null
    const { results, onDocumentMutation } = createDocumentMutationHarness({
      layout: dataChartLayout(),
      colorPairs: { pairs: [] },
    })

    const CaptureActions = () => {
      patchWidgetParams = useWidgetConfigRuntimeActions().patchWidgetParams
      return null
    }

    act(() => {
      root?.render(
        <WidgetConfigRuntimeProvider
          context={{
            workspaceId: 'workspace-1',
            dashboardLayoutOwnerUserId: 'user-1',
          }}
          layout={dataChartLayout()}
          colorPairs={{ pairs: [] } satisfies PersistedColorPairsState}
          canWrite
          onDocumentMutation={onDocumentMutation}
        >
          <CaptureActions />
        </WidgetConfigRuntimeProvider>
      )
    })

    act(() => {
      patchWidgetParams?.('panel-chart', 'data_chart', {
        view: {
          pineIndicators: [{ id: 'indicator-1' }],
          drawTools: [{ id: 'manual-rsi', pane: 'indicator', indicatorId: 'RSI' }],
        },
      })
    })

    const nextLayout = results[0]?.layout as any
    expect(nextLayout.widget.params).toEqual({
      data: { provider: 'alpaca' },
      view: {
        interval: '15m',
        pineIndicators: [{ id: 'indicator-1' }],
        drawTools: [{ id: 'manual-rsi', pane: 'indicator', indicatorId: 'RSI' }],
      },
    })
  })
})
