import { create } from 'zustand'
import type { ListingIdentity, ListingOption } from '@/lib/market/listings'

export interface MarketSelectorInstance {
  providerId?: string
  query: string
  isLoading: boolean
  error?: string
  results: ListingOption[]
  selectedListingValue?: ListingIdentity | null
  selectedListing?: ListingOption | null
}

export const createEmptyMarketSelectorInstance = (
  overrides: Partial<MarketSelectorInstance> = {}
): MarketSelectorInstance => ({
  providerId: undefined,
  query: '',
  isLoading: false,
  error: undefined,
  results: [],
  selectedListingValue: null,
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
          selectedListingValue: null,
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
