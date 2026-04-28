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

  it('renders trading widgets in the existing selector category flow', async () => {
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

    expect(document.body.textContent).toContain('Trading')
    expect(document.body.textContent).toContain('Heatmap')
    expect(document.body.textContent).toContain('Portfolio Snapshot')
    expect(document.body.textContent).toContain('Quick Order')
    expect(document.body.textContent).toContain('Data Chart')
  })
})
