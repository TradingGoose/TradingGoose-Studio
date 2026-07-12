/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardLayoutPreviewCanvasProps } from '@/components/dashboard-layout-preview'
import { getPublicCopy } from '@/i18n/public-copy'
import type { LayoutNode } from '@/widgets/layout'
import type { DashboardLayoutTopologyNode } from '@/widgets/layout-document'

const canvasState = vi.hoisted(() => ({ current: null as unknown }))
const splitCalls = vi.hoisted(() => [] as unknown[][])

vi.mock('@/components/dashboard-layout-preview', () => ({
  DashboardLayoutPreviewCanvas: (props: unknown) => {
    canvasState.current = props
    return <div data-testid='layout-preview-canvas' />
  },
}))

vi.mock('@/widgets/layout-document', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/widgets/layout-document')>()
  return {
    ...actual,
    splitDashboardTopologyPanel: (
      ...args: Parameters<typeof actual.splitDashboardTopologyPanel>
    ) => {
      splitCalls.push(args)
      return actual.splitDashboardTopologyPanel(...args)
    },
  }
})

import { LayoutPreview } from './layout-preview'

type TopologyPanel = Extract<DashboardLayoutTopologyNode, { type: 'panel' }>

function topologyPanels(node: DashboardLayoutTopologyNode): TopologyPanel[] {
  return node.type === 'panel' ? [node] : node.children.flatMap(topologyPanels)
}

function resolvedPanels(node: LayoutNode): Array<Extract<LayoutNode, { type: 'panel' }>> {
  return node.type === 'panel' ? [node] : node.children.flatMap(resolvedPanels)
}

function latestCanvasProps(): DashboardLayoutPreviewCanvasProps {
  return canvasState.current as DashboardLayoutPreviewCanvasProps
}

describe('LayoutPreview', () => {
  let container: HTMLDivElement
  let root: Root
  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    canvasState.current = null
    splitCalls.length = 0
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('retains real null-widget children through repeated split and close edits', async () => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale='en' messages={getPublicCopy('en')}>
          <LayoutPreview />
        </NextIntlClientProvider>
      )
    })

    const initialPanelId = resolvedPanels(latestCanvasProps().layout)[0]!.id
    act(() => latestCanvasProps().splitPanelVertical?.(initialPanelId))

    const firstSplitPanelId = resolvedPanels(latestCanvasProps().layout)[0]!.id
    act(() => latestCanvasProps().closePanel?.(firstSplitPanelId))

    const secondPanelId = resolvedPanels(latestCanvasProps().layout)[1]!.id
    act(() => latestCanvasProps().splitPanelHorizontal?.(secondPanelId))

    const secondSplitPanelId = resolvedPanels(latestCanvasProps().layout)[1]!.id
    act(() => latestCanvasProps().closePanel?.(secondSplitPanelId))

    const finalPanelId = resolvedPanels(latestCanvasProps().layout)[0]!.id
    act(() => latestCanvasProps().splitPanelVertical?.(finalPanelId))

    expect(splitCalls).toHaveLength(3)
    for (const [layout] of splitCalls as Array<[DashboardLayoutTopologyNode]>) {
      const panels = topologyPanels(layout)
      for (const panel of panels) {
        expect(panel.widgetKey).toBeNull()
      }
    }

    const finalPanels = resolvedPanels(latestCanvasProps().layout)
    expect(finalPanels).toHaveLength(5)
    expect(finalPanels.every((panel) => panel.widget === null)).toBe(true)
  })
})
