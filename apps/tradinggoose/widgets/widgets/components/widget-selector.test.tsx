/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WidgetSelectorComponent } from '@/widgets/widgets/components/widget-selector'

describe('WidgetSelectorComponent', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('renders trading first and includes watchlist under Trading', async () => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <WidgetSelectorComponent
            currentKey='heatmap'
            renderTrigger={() => <button type='button'>Select widget</button>}
          />
        </TooltipProvider>
      )
    })

    await act(async () => {
      container.querySelector('button')?.dispatchEvent(
        new MouseEvent('pointerdown', {
          bubbles: true,
        })
      )
    })

    const content = document.body.textContent ?? ''

    expect(content.indexOf('Trading')).toBeLessThan(content.indexOf('Lists'))
    expect(content.indexOf('Lists')).toBeLessThan(content.indexOf('Editor'))
    expect(content.indexOf('Editor')).toBeLessThan(content.indexOf('Utils'))

    const tradingStart = content.indexOf('Trading')
    const listsStart = content.indexOf('Lists')
    const tradingSection = content.slice(tradingStart, listsStart)

    expect(tradingSection).toContain('Watchlist')
    expect(tradingSection).toContain('Heatmap')
    expect(tradingSection).toContain('Portfolio Snapshot')
    expect(tradingSection).toContain('Quick Order')
    expect(tradingSection).toContain('Data Chart')
  })
})
