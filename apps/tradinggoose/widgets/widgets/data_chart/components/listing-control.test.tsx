/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListingOption } from '@/lib/listing/identity'
import { useListingSelectorStore } from '@/stores/market/selector/store'
import { DataChartListingControl } from '@/widgets/widgets/data_chart/components/listing-control'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const fetchListingsMock = vi.fn()

vi.mock('@/components/listing-selector/fetchers', () => ({
  fetchListings: (...args: Parameters<typeof fetchListingsMock>) => fetchListingsMock(...args),
}))

vi.mock('@/hooks/workflow/use-accessible-reference-prefixes', () => ({
  useAccessibleReferencePrefixes: () => undefined,
}))

vi.mock('@/components/ui/tag-dropdown', () => ({
  checkTagTrigger: () => ({ show: false }),
  TagDropdown: () => null,
}))

vi.mock('@/components/ui/formatted-text', () => ({
  formatDisplayText: (value: string) => value,
}))

vi.mock('@/components/ui/avatar', () => ({
  Avatar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AvatarFallback: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AvatarImage: () => null,
}))

vi.mock('@/components/listing-selector/selector/resolve-request', () => ({
  requestListingResolution: vi.fn(async () => null),
}))

vi.mock('@/components/listing-selector/listing/rank-updates', () => ({
  triggerCryptoRankUpdate: vi.fn(),
  triggerCurrencyRankUpdate: vi.fn(),
  triggerListingRankUpdate: vi.fn(),
}))

vi.mock('@/widgets/widgets/components/widget-header-control', () => ({
  widgetHeaderControlClassName: (className?: string) =>
    ['trigger', className].filter(Boolean).join(' '),
}))

vi.mock('@/widgets/utils/chart-params', () => ({
  emitDataChartParamsChange: vi.fn(),
}))

describe('DataChartListingControl', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    fetchListingsMock.mockReset()
    fetchListingsMock.mockResolvedValue([])
    useListingSelectorStore.setState({ instances: {} })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    useListingSelectorStore.setState({ instances: {} })
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    vi.useRealTimers()
  })

  it('preserves the typed query while editing an existing chart listing selection', async () => {
    const selectedListing: ListingOption = {
      listing_id: 'TG_LSTG_E7581A',
      base_id: '',
      quote_id: '',
      listing_type: 'default',
      base: 'AAPL',
      quote: 'USD',
      name: 'Apple Inc.',
      iconUrl: '',
      assetClass: 'stock',
    }

    await act(async () => {
      root.render(
        <DataChartListingControl
          widgetKey='listing-control-test'
          params={{
            listing: selectedListing as never,
            data: {
              provider: 'alpaca',
            },
          }}
          pairColor='gray'
        />
      )
    })

    const input = container.querySelector('input') as HTMLInputElement | null
    expect(input).toBeTruthy()

    await act(async () => {
      input?.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
    })

    await act(async () => {
      if (!input) return
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set
      valueSetter?.call(input, 'M')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    const instance = useListingSelectorStore.getState().instances['chart-listing-control-test']
    expect(instance?.query).toBe('M')
    expect(instance?.selectedListingValue).toBeNull()
    expect(instance?.selectedListing).toBeNull()
  })
})
