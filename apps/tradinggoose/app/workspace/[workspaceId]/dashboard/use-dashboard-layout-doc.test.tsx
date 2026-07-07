/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LayoutNode } from '@/widgets/layout'

const listing = {
  listing_type: 'default',
  listing_id: 'AAPL',
  base_id: '',
  quote_id: '',
} as const
const layout: LayoutNode = {
  id: 'panel-chart',
  type: 'panel',
  widget: { key: 'data_chart', pairColor: 'red', params: null },
}
const hydratedColorPairs = {
  pairs: [
    { color: 'red', listing: { ...listing, base: 'Apple', quote: null, name: 'Apple Inc.' } },
  ],
}

function installRawBunDom() {
  if (typeof document !== 'undefined') return

  const { window } = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost',
  })
  const globals: Record<string, unknown> = { window, IS_REACT_ACT_ENVIRONMENT: true }
  for (const key of ['document', 'HTMLElement', 'Node', 'Event', 'CustomEvent', 'navigator']) {
    globals[key] = window[key as keyof typeof window]
  }
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
}

vi.mock('@/lib/yjs/use-entity-fields', () => ({
  useEntityList: () => ({ members: [], isLoading: true, error: null }),
  useSavedEntityYjsSession: () => ({ doc: null, save: vi.fn(), isLoading: false, error: null }),
  useYjsField: (_doc: unknown, _field: string, initial: unknown) => [initial, vi.fn()],
  useYjsStringField: (_doc: unknown, _field: string, initial: string) => [initial, vi.fn()],
}))

describe('useDashboardLayoutDocument live fields', () => {
  let container: HTMLDivElement | null
  let root: Root | null

  beforeEach(() => {
    installRawBunDom()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  it('returns raw layout and canonical color-store state while the provider is not ready', async () => {
    const { useDashboardLayoutDocument } = await import('./use-dashboard-layout-doc')
    let latest: any = null

    const Capture = () => {
      latest = useDashboardLayoutDocument({
        workspaceId: 'workspace-1',
        ownerUserId: 'user-1',
        layoutId: 'layout-1',
        initialName: 'Layout',
        initialLayout: layout,
        initialColorPairs: hydratedColorPairs,
      })
      return null
    }

    act(() => {
      root?.render(<Capture />)
    })

    expect(latest?.layout).toEqual(layout)
    expect(latest?.colorPairs).toEqual({
      pairs: [{ color: 'red', listing }],
    })
  })
})
