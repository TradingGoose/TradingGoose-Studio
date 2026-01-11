import { create } from 'zustand'
import type { AssetClass } from '@/providers/market/types'

export type ListingOption = {
  id: string
  base: string
  quote?: string | null
  name?: string | null
  iconUrl?: string | null
  assetClass?: string | null
  primaryMicCode?: string | null
  countryCode?: string | null
  cityName?: string | null
  timeZoneName?: string | null
  equity_id?: string | null
  base_id?: string | null
  quote_id?: string | null
  base_asset_class?: string | null
  quote_asset_class?: string | null
}

export type CurrencyOption = {
  id: string
  code: string
  name?: string | null
  iconUrl?: string | null
}

export interface MarketSelectorInstance {
  providerId?: string
  assetClass?: AssetClass
  currencyId?: string
  currency?: CurrencyOption | null
  micCode?: string
  query: string
  isLoading: boolean
  error?: string
  results: ListingOption[]
  selectedListingId?: string
  selectedListing?: ListingOption | null
}

export const createEmptyMarketSelectorInstance = (
  overrides: Partial<MarketSelectorInstance> = {}
): MarketSelectorInstance => ({
  providerId: undefined,
  assetClass: undefined,
  currencyId: undefined,
  currency: null,
  micCode: undefined,
  query: '',
  isLoading: false,
  error: undefined,
  results: [],
  selectedListingId: undefined,
  selectedListing: null,
  ...overrides,
})

interface MarketSelectorStore {
  instances: Record<string, MarketSelectorInstance>
  ensureInstance: (id: string, initial?: Partial<MarketSelectorInstance>) => void
  updateInstance: (id: string, patch: Partial<MarketSelectorInstance>) => void
  clearSelection: (id: string) => void
  resetInstance: (id: string) => void
}

export const useMarketSelectorStore = create<MarketSelectorStore>((set) => ({
  instances: {},
  ensureInstance: (id, initial) =>
    set((state) => {
      if (state.instances[id]) {
        return initial
          ? {
              instances: {
                ...state.instances,
                [id]: {
                  ...state.instances[id],
                  ...initial,
                },
              },
            }
          : state
      }
      return {
        instances: {
          ...state.instances,
          [id]: createEmptyMarketSelectorInstance(initial),
        },
      }
    }),
  updateInstance: (id, patch) =>
    set((state) => ({
      instances: {
        ...state.instances,
        [id]: {
          ...(state.instances[id] ?? createEmptyMarketSelectorInstance()),
          ...patch,
        },
      },
    })),
  clearSelection: (id) =>
    set((state) => ({
      instances: {
        ...state.instances,
        [id]: {
          ...(state.instances[id] ?? createEmptyMarketSelectorInstance()),
          selectedListingId: undefined,
          selectedListing: null,
        },
      },
    })),
  resetInstance: (id) =>
    set((state) => ({
      instances: {
        ...state.instances,
        [id]: createEmptyMarketSelectorInstance(),
      },
    })),
}))
