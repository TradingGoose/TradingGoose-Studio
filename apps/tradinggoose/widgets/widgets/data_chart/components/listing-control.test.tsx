/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListingResolved } from '@/lib/listing/identity'
import { useListingSelectorStore } from '@/stores/market/selector/store'
import { DataChartListingControl } from '@/widgets/widgets/data_chart/components/listing-control'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const fetchListingsMock = vi.fn()
const listingInputState = vi.hoisted(() => ({
  onListingChange: null as ((listing: ListingResolved | null) => void) | null,
}))

vi.mock('@/lib/listing/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/listing/search')>()
  return {
    ...actual,
    fetchListings: (...args: Parameters<typeof fetchListingsMock>) => fetchListingsMock(...args),
  }
})

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

vi.mock('@/components/widget-header-control', () => ({
  widgetHeaderControlClassName: (className?: string) =>
    ['trigger', className].filter(Boolean).join(' '),
}))

vi.mock('@/components/listing-selector/selector/input', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/components/listing-selector/selector/input')>()
  return {
    ...actual,
    ListingSearchInput: (props: React.ComponentProps<typeof actual.ListingSearchInput>) => {
      listingInputState.onListingChange = props.onListingChange ?? null
      const Component = actual.ListingSearchInput
      return <Component {...props} />
    },
  }
})

const patchWidgetParamsMock = vi.fn()
const patchWidgetLinkedParamsMock = vi.fn()

vi.mock('@/widgets/widget-config-runtime', () => ({
  useWidgetConfigRuntimeActions: () => ({
    patchWidgetParams: (...args: Parameters<typeof patchWidgetParamsMock>) =>
      patchWidgetParamsMock(...args),
    patchWidgetLinkedParams: (...args: Parameters<typeof patchWidgetLinkedParamsMock>) =>
      patchWidgetLinkedParamsMock(...args),
  }),
}))

describe('DataChartListingControl', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    fetchListingsMock.mockReset()
    fetchListingsMock.mockResolvedValue([])
    patchWidgetParamsMock.mockReset()
    patchWidgetLinkedParamsMock.mockReset()
    listingInputState.onListingChange = null
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
    const selectedListing: ListingResolved = {
      listingIdentity: {
        listing_id: 'TG_LSTG_E7581A',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
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
            listing: selectedListing.listingIdentity,
            data: {
              provider: 'alpaca',
            },
          }}
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
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, 'M')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    const instance = useListingSelectorStore.getState().instances['chart-listing-control-test']
    expect(instance?.query).toBe('M')
    expect(instance?.selectedListing).toBeNull()
  })

  it('does not emit patches for non-identity listing values', async () => {
    await act(async () => {
      root.render(
        <DataChartListingControl
          widgetKey='listing-control-test'
          panelId='panel-1'
          params={{
            listing: 'AAPL' as never,
            data: {
              provider: 'alpaca',
            },
          }}
        />
      )
    })

    expect(patchWidgetParamsMock).not.toHaveBeenCalled()
  })

  it('routes listing changes through the linked-parameter owner', async () => {
    const selectedListing: ListingResolved = {
      listingIdentity: {
        listing_id: 'TG_LSTG_AAPL',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
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
          panelId='panel-1'
          params={{ data: { provider: 'alpaca' } }}
        />
      )
    })
    await act(async () => {
      listingInputState.onListingChange?.(selectedListing)
    })

    expect(patchWidgetLinkedParamsMock).toHaveBeenCalledWith({
      listing: {
        listing_id: 'TG_LSTG_AAPL',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
    })
    expect(patchWidgetParamsMock).not.toHaveBeenCalled()
  })
})
