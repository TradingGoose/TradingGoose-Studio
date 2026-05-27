/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MarketProviderSelector } from '@/components/market-selector/provider-selector'
import { TooltipProvider } from '@/components/ui/tooltip'

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

  it('uses form input styling without the widget market prefix when requested', () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <MarketProviderSelector
            value='yahoo-finance'
            options={[{ id: 'yahoo-finance', name: 'Yahoo Finance' }]}
            variant='form'
          />
        </TooltipProvider>
      )
    })

    const button = container.querySelector('button[aria-label="Select market provider"]')
    expect(button?.textContent).toContain('Yahoo Finance')
    expect(button?.textContent).not.toContain('Market:')
    expect(button?.className).toContain('h-10')
    expect(button?.className).toContain('rounded-md')
  })
})
