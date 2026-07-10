/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  getDashboardColorPairsMap,
  readDashboardLayoutContent,
  seedDashboardLayoutSession,
} from '@/lib/yjs/dashboard-layout-session'
import type { DashboardLayoutDocumentContent } from '@/widgets/layout-document'

let rawBunDom: JSDOM | null = null

function defineRawBunDomGlobal(key: string, value: unknown) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
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
  defineRawBunDomGlobal('Element', rawBunDom.window.Element)
  defineRawBunDomGlobal('Node', rawBunDom.window.Node)
  defineRawBunDomGlobal('Event', rawBunDom.window.Event)
  defineRawBunDomGlobal('CustomEvent', rawBunDom.window.CustomEvent)
  defineRawBunDomGlobal('navigator', rawBunDom.window.navigator)
  defineRawBunDomGlobal('location', rawBunDom.window.location)
}

const content = (): DashboardLayoutDocumentContent => ({
  layout: {
    id: 'root',
    type: 'group',
    direction: 'horizontal',
    sizes: [50, 50],
    children: [
      {
        id: 'panel-a',
        type: 'panel',
        identityId: 'widget-a',
        widgetKey: 'editor_workflow',
      },
      {
        id: 'panel-b',
        type: 'panel',
        identityId: 'widget-b',
        widgetKey: 'editor_workflow',
      },
    ],
  },
  widgets: {
    'widget-a': { pairColor: 'red', params: null },
    'widget-b': { pairColor: 'blue', params: null },
  },
  colorPairs: {
    pairs: [
      { color: 'red', workflowId: 'workflow-red' },
      { color: 'blue', workflowId: 'workflow-blue' },
    ],
  },
})

describe('WidgetConfigRuntimeProvider', () => {
  let container: HTMLDivElement
  let root: Root
  let doc: Y.Doc

  beforeEach(() => {
    installRawBunDom()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    doc = new Y.Doc()
    seedDashboardLayoutSession(doc, content())
  })

  afterEach(() => {
    act(() => root.unmount())
    doc.destroy()
    container.remove()
  })

  it('writes through the scoped panel into the layout child maps', async () => {
    const { useWidgetConfigRuntimeActions, WidgetConfigRuntimeProvider } = await import(
      '@/widgets/widget-config-runtime'
    )
    let patchWidgetParams: ((params: Record<string, unknown>) => void) | null = null

    const CaptureActions = () => {
      patchWidgetParams = useWidgetConfigRuntimeActions().patchWidgetParams
      return null
    }

    act(() => {
      root.render(
        <WidgetConfigRuntimeProvider doc={doc} panelId='panel-a' canWrite>
          <CaptureActions />
        </WidgetConfigRuntimeProvider>
      )
    })
    act(() => patchWidgetParams?.({ workflowId: 'workflow-next' }))

    const next = readDashboardLayoutContent(doc)
    expect(next.widgets['widget-a']).toEqual({ pairColor: 'red', params: null })
    expect(next.colorPairs.pairs).toContainEqual({
      color: 'red',
      workflowId: 'workflow-next',
    })
    expect(next.colorPairs.pairs).toContainEqual({
      color: 'blue',
      workflowId: 'workflow-blue',
    })
  })

  it('clears a linked field in the selected color-pair map only', async () => {
    getDashboardColorPairsMap(doc).get('red')?.set('indicatorId', 'indicator-red')
    const { useWidgetConfigRuntimeActions, WidgetConfigRuntimeProvider } = await import(
      '@/widgets/widget-config-runtime'
    )
    let patchWidgetParams: ((params: Record<string, unknown>) => void) | null = null

    const CaptureActions = () => {
      patchWidgetParams = useWidgetConfigRuntimeActions().patchWidgetParams
      return null
    }

    act(() => {
      root.render(
        <WidgetConfigRuntimeProvider doc={doc} panelId='panel-a' canWrite>
          <CaptureActions />
        </WidgetConfigRuntimeProvider>
      )
    })
    act(() => patchWidgetParams?.({ workflowId: null }))

    const next = readDashboardLayoutContent(doc)
    expect(next.widgets['widget-a']).toEqual({ pairColor: 'red', params: null })
    expect(next.colorPairs.pairs).toContainEqual({
      color: 'red',
      indicatorId: 'indicator-red',
    })
    expect(next.colorPairs.pairs).toContainEqual({
      color: 'blue',
      workflowId: 'workflow-blue',
    })
    expect(next.colorPairs.pairs.find((pair) => pair.color === 'red')).not.toHaveProperty(
      'workflowId'
    )
  })

  it('does not mutate child maps when writes are disabled', async () => {
    const { useWidgetConfigRuntimeActions, WidgetConfigRuntimeProvider } = await import(
      '@/widgets/widget-config-runtime'
    )
    let patchWidgetParams: ((params: Record<string, unknown>) => void) | null = null
    const before = readDashboardLayoutContent(doc)

    const CaptureActions = () => {
      patchWidgetParams = useWidgetConfigRuntimeActions().patchWidgetParams
      return null
    }
    act(() => {
      root.render(
        <WidgetConfigRuntimeProvider doc={doc} panelId='panel-a' canWrite={false}>
          <CaptureActions />
        </WidgetConfigRuntimeProvider>
      )
    })
    act(() => patchWidgetParams?.({ workflowId: 'blocked' }))

    expect(readDashboardLayoutContent(doc)).toEqual(before)
  })

  it('isolates widget subscriptions by panel identity', async () => {
    const {
      useDashboardWidgetRenderConfig,
      useWidgetConfigRuntimeActions,
      WidgetConfigRuntimeProvider,
    } = await import('@/widgets/widget-config-runtime')
    let patchPanelA: ((params: Record<string, unknown>) => void) | null = null
    let panelARenders = 0
    let panelBRenders = 0

    const PanelA = () => {
      panelARenders += 1
      patchPanelA = useWidgetConfigRuntimeActions().patchWidgetParams
      return <span>{useDashboardWidgetRenderConfig()?.key}</span>
    }
    const PanelB = () => {
      panelBRenders += 1
      return <span>{useDashboardWidgetRenderConfig()?.key}</span>
    }
    act(() => {
      root.render(
        <>
          <WidgetConfigRuntimeProvider doc={doc} panelId='panel-a' canWrite>
            <PanelA />
          </WidgetConfigRuntimeProvider>
          <WidgetConfigRuntimeProvider doc={doc} panelId='panel-b' canWrite>
            <PanelB />
          </WidgetConfigRuntimeProvider>
        </>
      )
    })
    const beforePanelB = panelBRenders
    act(() => patchPanelA?.({ workflowId: 'workflow-next' }))

    expect(panelARenders).toBeGreaterThan(1)
    expect(panelBRenders).toBe(beforePanelB)
  })

  it('subscribes render config only to the widget selected color pair', async () => {
    const { useDashboardWidgetRenderConfig, WidgetConfigRuntimeProvider } = await import(
      '@/widgets/widget-config-runtime'
    )
    let renders = 0
    const RenderConfig = () => {
      renders += 1
      const widget = useDashboardWidgetRenderConfig()
      return <span>{String(widget?.params?.workflowId ?? '')}</span>
    }
    act(() => {
      root.render(
        <WidgetConfigRuntimeProvider doc={doc} panelId='panel-a' canWrite>
          <RenderConfig />
        </WidgetConfigRuntimeProvider>
      )
    })
    const beforeBlue = renders
    act(() => getDashboardColorPairsMap(doc).get('blue')?.set('workflowId', 'blue-next'))
    expect(renders).toBe(beforeBlue)

    act(() => getDashboardColorPairsMap(doc).get('red')?.set('workflowId', 'red-next'))
    expect(renders).toBeGreaterThan(beforeBlue)
    expect(container.textContent).toContain('red-next')
  })
})
