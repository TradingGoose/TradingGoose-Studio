/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TradingAccountSelector } from '@/widgets/widgets/components/trading-account-selector'

describe('TradingAccountSelector', () => {
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

  it('renders selected account text instead of icon-only trigger', () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <TradingAccountSelector
            accountId='acct-1'
            accounts={[{ id: 'acct-1', name: 'Paper Account' }]}
          />
        </TooltipProvider>
      )
    })

    const button = container.querySelector('button[aria-label="Select trading account"]')
    expect(button?.textContent).toContain('Paper Account')
  })

  it('renders placeholder text when no account is selected', () => {
    act(() => {
      root.render(
        <TooltipProvider>
          <TradingAccountSelector accounts={[]} placeholder='Select account' />
        </TooltipProvider>
      )
    })

    const button = container.querySelector('button[aria-label="Select trading account"]')
    expect(button?.textContent).toContain('Select account')
  })
})
