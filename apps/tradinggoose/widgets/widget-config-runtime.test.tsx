/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LayoutNode, PersistedColorPairsState } from '@/widgets/layout'

type DocumentMutationResult = {
  layout: LayoutNode
  colorPairs: PersistedColorPairsState
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

const workflowRegistrySync = vi.fn()

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: {
    getState: () => ({
      syncLinkedWorkflowChannelsFromColorPairs: workflowRegistrySync,
    }),
  },
}))

vi.mock('@/lib/yjs/use-entity-fields', () => ({
  useEntityList: (kind: string) => ({
    members:
      kind === 'workflow'
        ? [
            {
              entityId: 'workflow-authorized',
              entityName: 'Authorized workflow',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ]
        : kind === 'indicator'
          ? [
              {
                entityId: 'indicator-authorized',
                entityName: 'Authorized indicator',
                createdAt: '2026-01-01T00:00:00.000Z',
              },
            ]
          : kind === 'watchlist'
            ? [
                {
                  entityId: 'watchlist-visible',
                  entityName: 'Visible',
                  createdAt: '2026-01-01T00:00:00.000Z',
                },
              ]
          : [],
    isLoading: false,
    error: null,
  }),
}))

let rawBunDom: JSDOM | null = null

function defineRawBunDomGlobal(key: string, value: unknown) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value,
  })
}

function installRawBunDom() {
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
  defineRawBunDomGlobal('IS_REACT_ACT_ENVIRONMENT', true)
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

const watchlistLayout = (): LayoutNode => ({
  id: 'root',
  type: 'group',
  direction: 'horizontal',
  sizes: [100],
  children: [
    {
      id: 'panel-watchlist',
      type: 'panel',
      widget: {
        key: 'watchlist',
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

describe('WidgetConfigRuntimeProvider reference validation', () => {
  let container: HTMLDivElement | null
  let root: Root | null

  beforeEach(() => {
    installRawBunDom()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    workflowRegistrySync.mockClear()
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
    }
    container?.remove()
    root = null
    container = null
  })

  it('accepts loaded entity-list references and rejects arbitrary ids', async () => {
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
        workflowId: 'workflow-authorized',
      })
    })
    expect(results.at(-1)).toEqual({
      layout: layout(),
      colorPairs: {
        pairs: [{ color: 'red', workflowId: 'workflow-authorized' }],
      },
    })

    expect(() =>
      act(() => {
        patchWidgetParams?.('panel-1', 'editor_workflow', {
          workflowId: 'workflow-unproven',
        })
      })
    ).toThrow('Widget reference edits must come from an authorized selector or server validation')

    expect(() =>
      act(() => {
        patchWidgetParams?.('panel-1', 'editor_workflow', {
          workflowId: 'workflow-forged',
        })
      })
    ).toThrow('Widget reference edits must come from an authorized selector or server validation')
  })

  it('does not authorize stale references from the current dashboard document', async () => {
    const { useWidgetConfigRuntimeActions, WidgetConfigRuntimeProvider } = await import(
      '@/widgets/widget-config-runtime'
    )
    let patchWidgetParams:
      | ((panelId: string, widgetKey: string, params: Record<string, unknown>) => void)
      | null = null
    const { results, onDocumentMutation } = createDocumentMutationHarness({
      layout: layout(),
      colorPairs: { pairs: [{ color: 'red', workflowId: 'workflow-stale' }] },
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
          colorPairs={
            {
              pairs: [{ color: 'red', workflowId: 'workflow-stale' }],
            } satisfies PersistedColorPairsState
          }
          canWrite
          onDocumentMutation={onDocumentMutation}
        >
          <CaptureActions />
        </WidgetConfigRuntimeProvider>
      )
    })

    expect(() =>
      act(() => {
        patchWidgetParams?.('panel-1', 'editor_workflow', {
          workflowId: 'workflow-stale',
        })
      })
    ).toThrow('Widget reference edits must come from an authorized selector or server validation')
    expect(results).toHaveLength(0)
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
        workflowId: 'workflow-authorized',
      })
    })

    expect(results).toHaveLength(0)
  })

  it('authorizes visible watchlist document ids and rejects arbitrary watchlist ids', async () => {
    const { useWidgetConfigRuntimeActions, WidgetConfigRuntimeProvider } = await import(
      '@/widgets/widget-config-runtime'
    )
    let patchWidgetParams:
      | ((panelId: string, widgetKey: string, params: Record<string, unknown>) => void)
      | null = null
    const { results, onDocumentMutation } = createDocumentMutationHarness({
      layout: watchlistLayout(),
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
          layout={watchlistLayout()}
          colorPairs={{ pairs: [] } satisfies PersistedColorPairsState}
          canWrite
          onDocumentMutation={onDocumentMutation}
        >
          <CaptureActions />
        </WidgetConfigRuntimeProvider>
      )
    })

    act(() => {
      patchWidgetParams?.('panel-watchlist', 'watchlist', {
        watchlistId: 'watchlist-visible',
      })
    })
    expect(results.at(-1)).toEqual({
      layout: watchlistLayout(),
      colorPairs: {
        pairs: [{ color: 'red', watchlistId: 'watchlist-visible' }],
      },
    })

    expect(() =>
      act(() => {
        patchWidgetParams?.('panel-watchlist', 'watchlist', {
          watchlistId: 'watchlist-forged',
        })
      })
    ).toThrow('Widget reference edits must come from an authorized selector or server validation')
    expect(results).toHaveLength(1)
  })

  it('authorizes nested data-chart indicator references', async () => {
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
          pineIndicators: [{ id: 'indicator-authorized' }],
          drawTools: [{ id: 'manual-rsi', pane: 'indicator', indicatorId: 'RSI' }],
        },
      })
    })

    const nextLayout = results[0]?.layout as any
    expect(nextLayout.widget.params).toEqual({
      data: { provider: 'alpaca' },
      view: {
        interval: '15m',
        pineIndicators: [{ id: 'indicator-authorized' }],
        drawTools: [{ id: 'manual-rsi', pane: 'indicator', indicatorId: 'RSI' }],
      },
    })

    expect(() =>
      act(() => {
        patchWidgetParams?.('panel-chart', 'data_chart', {
          view: { pineIndicators: [{ id: 'indicator-forged' }] },
        })
      })
    ).toThrow('Widget reference edits must come from an authorized selector or server validation')
  })
})
