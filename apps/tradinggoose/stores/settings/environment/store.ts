import { createWithEqualityFn as create } from 'zustand/traditional'
import { createLogger } from '@/lib/logs/console/logger'
import { API_ENDPOINTS } from '@/stores/constants'
import type { EnvironmentStore, EnvironmentVariable } from '@/stores/settings/environment/types'

const logger = createLogger('EnvironmentStore')

export const useEnvironmentStore = create<EnvironmentStore>()((set, get) => ({
  variables: {},
  isLoading: false,
  error: null,

  loadEnvironmentVariables: async () => {
    try {
      set({ isLoading: true, error: null })

      const response = await fetch(API_ENDPOINTS.ENVIRONMENT, { cache: 'no-store' })
      if (!response.ok) {
        throw new Error(`Failed to load environment variables: ${response.statusText}`)
      }

      const { data } = await response.json()

      set({
        variables: data && typeof data === 'object' ? data : {},
        isLoading: false,
      })
    } catch (error) {
      logger.error('Error loading environment variables:', { error })
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      })
    }
  },

  setVariables: (variables: Record<string, EnvironmentVariable>) => {
    set({ variables })
  },

  getAllVariables: (): Record<string, EnvironmentVariable> => {
    return get().variables
  },
}))
