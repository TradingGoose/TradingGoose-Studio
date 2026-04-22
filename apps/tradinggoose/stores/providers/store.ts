import { createWithEqualityFn as create } from 'zustand/traditional'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import { updateOllamaProviderModels, updateOpenRouterProviderModels } from '@/providers/ai/utils'
import type { ProviderConfig, ProviderName, ProvidersStore } from './types'

const logger = createLogger('ProvidersStore')
let hasBootstrappedProviderModels = false

const PROVIDER_CONFIGS: Record<ProviderName, ProviderConfig> = {
  base: {
    apiEndpoint: '/api/providers/ai/base/models',
    dedupeModels: true,
    updateFunction: () => {},
  },
  ollama: {
    apiEndpoint: '/api/providers/ai/ollama/models',
    updateFunction: updateOllamaProviderModels,
  },
  openrouter: {
    apiEndpoint: '/api/providers/ai/openrouter/models',
    dedupeModels: true,
    updateFunction: updateOpenRouterProviderModels,
  },
  vllm: {
    apiEndpoint: '/api/providers/vllm/models',
    updateFunction: () => {},
  },
}

const resolveApiEndpoint = (endpoint: string): string => {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint
  }

  const baseUrl =
    typeof window !== 'undefined' && window.location?.origin ? window.location.origin : getBaseUrl()

  try {
    return new URL(endpoint, baseUrl).toString()
  } catch (_error) {
    return endpoint
  }
}

const fetchProviderModels = async (provider: ProviderName): Promise<string[]> => {
  try {
    const config = PROVIDER_CONFIGS[provider]
    const apiEndpoint = resolveApiEndpoint(config.apiEndpoint)
    const response = await fetch(apiEndpoint)

    if (!response.ok) {
      logger.warn(`Failed to fetch ${provider} models from API`, {
        status: response.status,
        statusText: response.statusText,
        apiEndpoint,
      })
      return []
    }

    const data = await response.json()
    return data.models || []
  } catch (error) {
    logger.warn(`Error fetching ${provider} models`, {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return []
  }
}

export const useProvidersStore = create<ProvidersStore>((set, get) => ({
  providers: {
    base: { models: [], isLoading: false },
    ollama: { models: [], isLoading: false },
    openrouter: { models: [], isLoading: false },
    vllm: { models: [], isLoading: false },
  },

  setModels: (provider, models) => {
    const config = PROVIDER_CONFIGS[provider]

    const processedModels = config.dedupeModels ? Array.from(new Set(models)) : models

    set((state) => ({
      providers: {
        ...state.providers,
        [provider]: {
          ...state.providers[provider],
          models: processedModels,
        },
      },
    }))

    void Promise.resolve(config.updateFunction(models)).catch((error) => {
      logger.warn(`Failed to update ${provider} provider models`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    })
  },

  fetchModels: async (provider) => {
    if (typeof window === 'undefined') {
      logger.info(`Skipping client-side ${provider} model fetch on server`)
      return
    }

    const currentState = get().providers[provider]
    if (currentState.isLoading) {
      logger.info(`${provider} model fetch already in progress`)
      return
    }

    logger.info(`Fetching ${provider} models from API`)

    set((state) => ({
      providers: {
        ...state.providers,
        [provider]: {
          ...state.providers[provider],
          isLoading: true,
        },
      },
    }))

    try {
      const models = await fetchProviderModels(provider)
      logger.info(`Successfully fetched ${provider} models`, {
        count: models.length,
        ...(provider === 'ollama' ? { models } : {}),
      })
      get().setModels(provider, models)
    } catch (error) {
      logger.error(`Failed to fetch ${provider} models`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      set((state) => ({
        providers: {
          ...state.providers,
          [provider]: {
            ...state.providers[provider],
            isLoading: false,
          },
        },
      }))
    }
  },

  getProvider: (provider) => {
    return get().providers[provider]
  },
}))

export function bootstrapProviderModels() {
  if (typeof window === 'undefined' || hasBootstrappedProviderModels) {
    return
  }

  hasBootstrappedProviderModels = true

  const store = useProvidersStore.getState()
  store.fetchModels('base')
  store.fetchModels('ollama')
  store.fetchModels('openrouter')
}
