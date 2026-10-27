/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PortfolioConditionBuilder } from './portfolio-condition-builder'

describe('PortfolioConditionBuilder', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it('clears unsupported selections and options when the trading provider changes', async () => {
    const render = (tradingProviderId: string) =>
      act(async () =>
        root.render(
          <PortfolioConditionBuilder
            tradingProviderId={tradingProviderId}
            condition={{
              root: {
                combinator: 'and',
                rules: [{ metric: 'summary.totalUnrealizedPnl', operator: 'gt', value: 0 }],
              },
            }}
            onChange={vi.fn()}
          />
        )
      )

    await render('alpaca')
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Portfolio metric"]')
    expect(trigger).toHaveTextContent('Unrealized P/L')
    await render('robinhood')
    expect(trigger).not.toHaveTextContent('Unrealized P/L')

    await act(async () => trigger?.click())

    expect(document.body).toHaveTextContent('Total portfolio value')
    expect(document.body).not.toHaveTextContent('Unrealized P/L')
  })
})
