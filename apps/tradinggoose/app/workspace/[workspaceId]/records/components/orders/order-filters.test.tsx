/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ORDERS_FILTER_STATE } from '@/lib/records/order-filters'
import { OrderFilters } from './order-filters'

vi.mock('@/components/ui/select', () => ({
  Select: ({ children, onValueChange, value }: any) => (
    <select value={value} onChange={(event) => onValueChange(event.currentTarget.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: ({ placeholder }: any) => <option value='all'>{placeholder}</option>,
}))

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

describe('OrderFilters', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  const findSelect = (label: string) => {
    const select = Array.from(container.querySelectorAll('select')).find((node) =>
      node.textContent?.includes(label)
    )
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error(`Expected select for ${label}`)
    }
    return select
  }

  it('renders and emits all order dimensions supported by the API filters', async () => {
    const onChange = vi.fn()

    await act(async () => {
      root.render(
        <OrderFilters
          state={DEFAULT_ORDERS_FILTER_STATE}
          searchValue=''
          loadedCount={1}
          totalCount={3}
          onSearchChange={vi.fn()}
          onChange={onChange}
          onReset={vi.fn()}
        />
      )
    })

    const side = findSelect('All sides')
    const orderType = findSelect('All order types')
    const timeInForce = findSelect('All TIF')

    await act(async () => {
      side.value = 'buy'
      side.dispatchEvent(new Event('change', { bubbles: true }))
      orderType.value = 'limit'
      orderType.dispatchEvent(new Event('change', { bubbles: true }))
      timeInForce.value = 'day'
      timeInForce.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(onChange).toHaveBeenCalledWith({ side: 'buy' })
    expect(onChange).toHaveBeenCalledWith({ orderType: 'limit' })
    expect(onChange).toHaveBeenCalledWith({ timeInForce: 'day' })
    expect(container.textContent).toContain('Showing 1 of 3')
  })
})
