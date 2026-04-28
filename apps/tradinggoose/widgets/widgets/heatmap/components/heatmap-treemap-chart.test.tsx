/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { HeatmapTreemapChart } from '@/widgets/widgets/heatmap/components/heatmap-treemap-chart'

describe('HeatmapTreemapChart', () => {
  let container: HTMLDivElement
  let root: Root
  let originalResizeObserver: typeof globalThis.ResizeObserver | undefined

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    originalResizeObserver = globalThis.ResizeObserver
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    globalThis.ResizeObserver = originalResizeObserver as typeof globalThis.ResizeObserver
  })

  it('renders without ResizeObserver by using the initial measurement fallback', async () => {
    globalThis.ResizeObserver = undefined as unknown as typeof globalThis.ResizeObserver
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 120,
        height: 120,
        left: 0,
        right: 240,
        top: 0,
        width: 240,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    })

    await act(async () => {
      root.render(
        <TooltipProvider>
          <HeatmapTreemapChart
            items={[
              {
                key: 'default|AAPL||',
                listing: {
                  listing_id: 'AAPL',
                  base_id: '',
                  quote_id: '',
                  listing_type: 'default',
                },
                resolvedListing: {
                  listing_id: 'AAPL',
                  base_id: '',
                  quote_id: '',
                  listing_type: 'default',
                  base: 'AAPL',
                  name: 'Apple Inc.',
                },
                quote: {
                  lastPrice: 110,
                  previousClose: 100,
                  change: 10,
                  changePercent: 10,
                },
                sourceLabels: ['Watchlist'],
              },
            ]}
          />
        </TooltipProvider>
      )
    })

    expect(container.textContent).toContain('AAPL')
    expect(container.textContent).not.toContain('Apple Inc.')
    const button = container.querySelector('button')
    expect(button?.getAttribute('aria-label')).toContain('Previous 100.0')
    expect(button?.getAttribute('aria-label')).toContain('Change +10.00')
    expect(button?.getAttribute('aria-label')).toContain('+10.00%')
  })

  it('hides visible tile text when the tile is below the label threshold', async () => {
    globalThis.ResizeObserver = undefined as unknown as typeof globalThis.ResizeObserver
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 20,
        height: 20,
        left: 0,
        right: 40,
        top: 0,
        width: 40,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    })

    await act(async () => {
      root.render(
        <TooltipProvider>
          <HeatmapTreemapChart
            items={[
              {
                key: 'default|AAPL||',
                listing: {
                  listing_id: 'AAPL',
                  base_id: '',
                  quote_id: '',
                  listing_type: 'default',
                },
                resolvedListing: {
                  listing_id: 'AAPL',
                  base_id: '',
                  quote_id: '',
                  listing_type: 'default',
                  base: 'AAPL',
                  name: 'Apple Inc.',
                },
                quote: {
                  lastPrice: 110,
                  previousClose: 100,
                  change: 10,
                  changePercent: 10,
                },
                sourceLabels: ['Watchlist'],
              },
            ]}
          />
        </TooltipProvider>
      )
    })

    expect(container.querySelector('button')?.textContent?.trim()).toBe('')
  })
})
