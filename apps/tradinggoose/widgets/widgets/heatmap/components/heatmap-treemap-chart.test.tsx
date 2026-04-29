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
                  iconUrl: 'https://example.com/aapl.svg',
                  countryCode: 'US',
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
    expect(container.querySelector('img[alt="US flag"]')?.getAttribute('src')).toBe(
      'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f1fa-1f1f8.svg'
    )
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.com/aapl.svg')
    const button = container.querySelector('button')
    expect(button?.getAttribute('aria-label')).toContain('Previous 100.0')
    expect(button?.getAttribute('aria-label')).toContain('Change +10.00')
    expect(button?.getAttribute('aria-label')).toContain('+10.00%')
  })

  it('keeps a default tile layout when the first browser measurement is zero', async () => {
    globalThis.ResizeObserver = undefined as unknown as typeof globalThis.ResizeObserver
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 0,
        height: 0,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
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
                quote: {
                  lastPrice: 110,
                  previousClose: 100,
                  change: 10,
                  changePercent: 10,
                },
              },
            ]}
          />
        </TooltipProvider>
      )
    })

    expect(container.querySelector('button')?.textContent).toContain('AAPL')
  })

  it('renders split blocks without user resize handles', async () => {
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
              },
              {
                key: 'default|MSFT||',
                listing: {
                  listing_id: 'MSFT',
                  base_id: '',
                  quote_id: '',
                  listing_type: 'default',
                },
              },
            ]}
          />
        </TooltipProvider>
      )
    })

    expect(container.querySelectorAll('button')).toHaveLength(2)
    expect(container.textContent).toContain('AAPL')
    expect(container.textContent).toContain('MSFT')
    expect(container.querySelector('[role="separator"]')).toBeNull()
  })

  it('uses ResizeObserver dimensions for tile visibility', async () => {
    globalThis.ResizeObserver = class {
      private callback: ResizeObserverCallback

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
      }

      observe(target: Element) {
        this.callback(
          [
            {
              target,
              contentRect: {
                bottom: 40,
                height: 40,
                left: 0,
                right: 40,
                top: 0,
                width: 40,
                x: 0,
                y: 0,
                toJSON: () => ({}),
              },
            } as ResizeObserverEntry,
          ],
          this as ResizeObserver
        )
      }

      disconnect() {}
      unobserve() {}
    } as unknown as typeof globalThis.ResizeObserver
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 0,
        height: 0,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
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
                  iconUrl: 'https://example.com/aapl.svg',
                },
                quote: {
                  lastPrice: 110,
                  previousClose: 100,
                  change: 10,
                  changePercent: 10,
                },
              },
            ]}
          />
        </TooltipProvider>
      )
    })

    const button = container.querySelector('button')
    const icon = container.querySelector('img')
    expect(button?.textContent?.trim()).toBe('')
    expect(icon?.style.width).toBe('16px')
    expect(icon?.style.height).toBe('16px')
  })

  it('formats crypto pairs with base and quote without the full listing name', async () => {
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
                key: 'crypto||BTC|USD',
                listing: {
                  listing_id: '',
                  base_id: 'BTC',
                  quote_id: 'USD',
                  listing_type: 'crypto',
                },
                resolvedListing: {
                  listing_id: '',
                  base_id: 'BTC',
                  quote_id: 'USD',
                  listing_type: 'crypto',
                  base: 'BTC',
                  quote: 'USD',
                  name: 'Bitcoin',
                },
                quote: {
                  lastPrice: 110,
                  previousClose: 100,
                  change: 10,
                  changePercent: 10,
                },
              },
            ]}
          />
        </TooltipProvider>
      )
    })

    expect(container.querySelector('button')?.textContent).toContain('BTC/USD')
    expect(container.querySelector('button')?.textContent).not.toContain('Bitcoin')
  })

  it('shows a scaled listing icon for small non-mini tiles', async () => {
    globalThis.ResizeObserver = undefined as unknown as typeof globalThis.ResizeObserver
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 40,
        height: 40,
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
                  iconUrl: 'https://example.com/aapl.svg',
                },
                quote: {
                  lastPrice: 110,
                  previousClose: 100,
                  change: 10,
                  changePercent: 10,
                },
              },
            ]}
          />
        </TooltipProvider>
      )
    })

    const icon = container.querySelector('img')
    expect(icon?.getAttribute('src')).toBe('https://example.com/aapl.svg')
    expect(icon?.style.width).toBe('16px')
    expect(icon?.style.height).toBe('16px')
    expect(container.querySelector('button')?.textContent?.trim()).toBe('')
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
                  iconUrl: 'https://example.com/aapl.svg',
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
    expect(container.querySelector('img')).toBeNull()
  })
})
