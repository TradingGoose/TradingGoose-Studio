/**
 * @vitest-environment jsdom
 */

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'
import { TradingProviderSelector } from '@/components/trading-selector/provider-selector'
import { TooltipProvider } from '@/components/ui/tooltip'

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

  const renderWithLocale = (locale: 'en' | 'es' | 'zh', node: ReactNode) => {
    act(() => {
      root.render(
        <NextIntlClientProvider locale={locale} messages={getPublicCopy(locale)}>
          <TooltipProvider>{node}</TooltipProvider>
        </NextIntlClientProvider>
      )
    })
  }

  it('renders the selected broker name instead of an icon-only trigger', () => {
    const copy = getPublicCopy('en').workspace.widgets.providerControls.tradingSelector
    renderWithLocale(
      'en',
      <TradingProviderSelector
        value='alpaca'
        options={[
          { id: 'alpaca', name: 'Alpaca' },
          { id: 'tradier', name: 'Tradier' },
        ]}
      />
    )

    const button = container.querySelector(`button[aria-label="${copy.ariaLabel}"]`)
    expect(button?.textContent).toContain('Broker: Alpaca')
  })

  it('renders localized placeholder and aria copy before a broker is selected', () => {
    const copy = getPublicCopy('es').workspace.widgets.providerControls.tradingSelector
    renderWithLocale(
      'es',
      <TradingProviderSelector value='' options={[{ id: 'alpaca', name: 'Alpaca' }]} />
    )

    const button = container.querySelector(`button[aria-label="${copy.ariaLabel}"]`)
    expect(button?.textContent).toContain(copy.placeholder)
  })

  it('uses form input styling without the widget broker prefix when requested', () => {
    const copy = getPublicCopy('zh').workspace.widgets.providerControls.tradingSelector
    renderWithLocale(
      'zh',
      <TradingProviderSelector
        value='alpaca'
        options={[{ id: 'alpaca', name: 'Alpaca' }]}
        variant='form'
      />
    )

    const button = container.querySelector(`button[aria-label="${copy.ariaLabel}"]`)
    expect(button?.textContent).toContain('Alpaca')
    expect(button?.textContent).not.toContain('Broker:')
    expect(button?.className).toContain('h-10')
    expect(button?.className).toContain('rounded-md')
  })
})
