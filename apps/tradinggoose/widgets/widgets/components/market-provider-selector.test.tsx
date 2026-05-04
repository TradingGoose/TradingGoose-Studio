/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MarketProviderSelector } from '@/widgets/widgets/components/market-provider-selector'

describe('MarketProviderSelector', () => {
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

  it('renders the selected market provider name instead of an icon-only trigger', () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <MarketProviderSelector
            value='alpaca'
            options={[
              { id: 'alpaca', name: 'Alpaca' },
              { id: 'yahoo-finance', name: 'Yahoo Finance' },
            ]}
          />
        </TooltipProvider>
      )
    })

    const button = container.querySelector('button[aria-label="Select market provider"]')
    expect(button?.textContent).toContain('Market: Alpaca')
  })

  it('renders a clear placeholder before a market provider is selected', () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <MarketProviderSelector
            value=''
            options={[{ id: 'alpaca', name: 'Alpaca' }]}
            placeholder='Select market data'
          />
        </TooltipProvider>
      )
    })

    const button = container.querySelector('button[aria-label="Select market provider"]')
    expect(button?.textContent).toContain('Select market data')
  })
})
