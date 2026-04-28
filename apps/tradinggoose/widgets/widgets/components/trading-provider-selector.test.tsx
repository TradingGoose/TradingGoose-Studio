/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TradingProviderSelector } from '@/widgets/widgets/components/trading-provider-selector'

describe('TradingProviderSelector', () => {
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

  it('renders the selected broker name instead of an icon-only trigger', () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <TradingProviderSelector
            value='alpaca'
            options={[
              { id: 'alpaca', name: 'Alpaca' },
              { id: 'tradier', name: 'Tradier' },
            ]}
          />
        </TooltipProvider>
      )
    })

    const button = container.querySelector('button[aria-label="Select trading provider"]')
    expect(button?.textContent).toContain('Broker: Alpaca')
  })

  it('renders a clear placeholder before a broker is selected', () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <TradingProviderSelector
            value=''
            options={[{ id: 'alpaca', name: 'Alpaca' }]}
            placeholder='Select broker'
          />
        </TooltipProvider>
      )
    })

    const button = container.querySelector('button[aria-label="Select trading provider"]')
    expect(button?.textContent).toContain('Select broker')
  })
})
