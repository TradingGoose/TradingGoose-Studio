/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KiboGantt } from './kibo-gantt'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('KiboGantt', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-22T00:00:00.000Z'))
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    vi.useRealTimers()
  })

  it('renders the requested timeline range header labels', async () => {
    await act(async () => {
      root.render(
        <KiboGantt
          groups={[
            {
              id: 'running',
              label: 'Running',
              items: [
                {
                  id: 'alpha',
                  title: 'Alpha monitor',
                  startAt: new Date('2026-04-20T00:00:00.000Z'),
                  endAt: new Date('2026-05-15T00:00:00.000Z'),
                  color: '#22c55e',
                },
              ],
            },
          ]}
          range='quarterly'
          zoom={100}
          selectedItemId={null}
          onSelectItem={vi.fn()}
        />
      )
    })

    expect(container.textContent).toContain('Q1 2026')
    expect(container.textContent).toContain('Apr')
  })

  it('extends the timeline when the scroll region reaches the far edge', async () => {
    await act(async () => {
      root.render(
        <KiboGantt
          groups={[
            {
              id: 'running',
              label: 'Running',
              items: [
                {
                  id: 'alpha',
                  title: 'Alpha monitor',
                  startAt: new Date('2026-04-20T00:00:00.000Z'),
                  endAt: new Date('2026-04-25T00:00:00.000Z'),
                  color: '#22c55e',
                },
              ],
            },
          ]}
          range='monthly'
          zoom={100}
          selectedItemId={null}
          onSelectItem={vi.fn()}
        />
      )
    })

    const scrollRegion = container.querySelector('[data-testid="kibo-gantt-scroll-region"]')

    if (!(scrollRegion instanceof HTMLDivElement)) {
      throw new Error('Expected Kibo gantt scroll region to render')
    }

    Object.defineProperty(scrollRegion, 'clientWidth', {
      configurable: true,
      value: 900,
    })
    Object.defineProperty(scrollRegion, 'scrollWidth', {
      configurable: true,
      value: 1800,
    })

    await act(async () => {
      scrollRegion.scrollLeft = 900
      scrollRegion.dispatchEvent(new Event('scroll', { bubbles: true }))
    })

    expect(container.textContent).toContain('2028')
  })

  it('renders longer spans wider on the daily timeline', async () => {
    await act(async () => {
      root.render(
        <KiboGantt
          groups={[
            {
              id: 'running',
              label: 'Running',
              items: [
                {
                  id: 'short',
                  title: 'Short span',
                  startAt: new Date('2026-04-20T00:00:00.000Z'),
                  endAt: new Date('2026-04-21T00:00:00.000Z'),
                  color: '#22c55e',
                },
                {
                  id: 'long',
                  title: 'Long span',
                  startAt: new Date('2026-04-20T00:00:00.000Z'),
                  endAt: new Date('2026-04-24T00:00:00.000Z'),
                  color: '#2563eb',
                },
              ],
            },
          ]}
          range='daily'
          zoom={100}
          selectedItemId={null}
          onSelectItem={vi.fn()}
        />
      )
    })

    const itemButtons = Array.from(container.querySelectorAll('button')).filter(
      (button) => button.style.width.length > 0
    )

    const shortItem = itemButtons.find((button) => button.textContent?.includes('Short span'))
    const longItem = itemButtons.find((button) => button.textContent?.includes('Long span'))

    if (!(shortItem instanceof HTMLButtonElement) || !(longItem instanceof HTMLButtonElement)) {
      throw new Error('Expected daily timeline feature buttons to render')
    }

    expect(Number.parseFloat(shortItem.style.width)).toBeLessThan(
      Number.parseFloat(longItem.style.width)
    )
  })

  it('renders an empty timeline scaffold when there are no groups', async () => {
    await act(async () => {
      root.render(
        <KiboGantt
          groups={[]}
          range='monthly'
          zoom={100}
          selectedItemId={null}
          onSelectItem={vi.fn()}
        />
      )
    })

    expect(container.querySelector('[data-testid="kibo-gantt-scroll-region"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="kibo-gantt-sidebar"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="kibo-gantt-timeline"]')).not.toBeNull()
    expect(container.textContent).toContain('Current view')
    expect(container.textContent).toContain('No monitors are available for the current timeline view.')
  })
})
