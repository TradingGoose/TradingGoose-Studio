import { createWithEqualityFn as create } from 'zustand/traditional'
import type { ListingIdentity, ListingOption } from '@/lib/listing/identity'

export interface ListingSelectorInstance {
  providerId?: string
  query: string
  isLoading: boolean
  error?: string
  results: ListingOption[]
  selectedListingValue?: ListingIdentity | null
  selectedListing?: ListingOption | null
}

export const createEmptyListingSelectorInstance = (
  overrides: Partial<ListingSelectorInstance> = {}
): ListingSelectorInstance => ({
  providerId: undefined,
  query: '',
  isLoading: false,
  error: undefined,
  results: [],
  selectedListingValue: null,
  selectedListing: null,
  ...overrides,
})

interface ListingSelectorStore {
  instances: Record<string, ListingSelectorInstance>
  ensureInstance: (id: string, initial?: Partial<ListingSelectorInstance>) => void
  updateInstance: (id: string, patch: Partial<ListingSelectorInstance>) => void
  clearSelection: (id: string) => void
  resetInstance: (id: string) => void
}

export const useListingSelectorStore = create<ListingSelectorStore>((set) => ({
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
          [id]: createEmptyListingSelectorInstance(initial),
        },
      }
    }),
  updateInstance: (id, patch) =>
    set((state) => ({
      instances: {
        ...state.instances,
        [id]: {
          ...(state.instances[id] ?? createEmptyListingSelectorInstance()),
          ...patch,
        },
      },
    })),
  clearSelection: (id) =>
    set((state) => ({
      instances: {
        ...state.instances,
        [id]: {
          ...(state.instances[id] ?? createEmptyListingSelectorInstance()),
          selectedListingValue: null,
          selectedListing: null,
        },
      },
    })),
  resetInstance: (id) =>
    set((state) => ({
      instances: {
        ...state.instances,
        [id]: createEmptyListingSelectorInstance(),
      },
    })),
}))
