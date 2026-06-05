/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrderIdRow } from './order-row'

vi.mock('next-intl', async () => {
  const { getPublicCopy } = await import('@/i18n/public-copy')

  return {
    useLocale: () => 'es',
    useMessages: () => getPublicCopy('es'),
  }
})

describe('OrderIdRow', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    document.body.replaceChildren()
  })

  it('uses localized placeholder copy from the centralized order selector namespace', () => {
    act(() => {
      root.render(<OrderIdRow />)
    })

    expect(container.textContent).toContain('Seleccionar orden')
    expect(container.textContent).toContain('Busca por ID de orden, símbolo o fecha')
  })

  it('localizes order side labels instead of rendering English defaults', () => {
    act(() => {
      root.render(
        <OrderIdRow
          order={{
            id: 'order-1',
            provider: 'alpaca',
            environment: 'paper',
            symbol: 'AAPL',
            companyName: 'Apple',
            side: 'buy',
            quantity: 1,
            notional: null,
            placedAt: '2026-05-20T14:30:00.000Z',
            recordedAt: '2026-05-20T14:30:00.000Z',
            quote: 'USD',
            iconUrl: null,
            assetClass: null,
            listingType: null,
          }}
        />
      )
    })

    expect(container.textContent).toContain('Compra')
    expect(container.textContent).not.toContain('Buy')
    expect(container.textContent).toContain('Acción')
  })
})
