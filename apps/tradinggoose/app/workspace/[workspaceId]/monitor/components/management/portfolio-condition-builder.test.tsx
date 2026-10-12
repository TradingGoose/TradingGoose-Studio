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

  it('keeps the current unsupported metric visible with supported provider options', async () => {
    await act(async () => {
      root.render(
        <PortfolioConditionBuilder
          tradingProviderId='robinhood'
          condition={{
            root: {
              combinator: 'and',
              rules: [{ metric: 'summary.totalUnrealizedPnl', operator: 'gt', value: 0 }],
            },
          }}
          onChange={vi.fn()}
        />
      )
    })

    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Portfolio metric"]')
    expect(trigger).toHaveTextContent('Unrealized P/L (Unsupported)')

    await act(async () => trigger?.click())

    expect(document.body).toHaveTextContent('Total portfolio value')
    expect(document.body).toHaveTextContent('Unrealized P/L (Unsupported)')
    const unsupportedOption = Array.from(document.body.querySelectorAll('[role="option"]')).find(
      (option) => option.textContent?.includes('Unrealized P/L (Unsupported)')
    )
    expect(unsupportedOption).toHaveAttribute('aria-disabled', 'true')
  })
})
