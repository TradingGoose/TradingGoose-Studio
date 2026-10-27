import { createWithEqualityFn as create } from 'zustand/traditional'
import { isHosted } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import {
  updateFireworksModels,
  updateOllamaModels,
  updateOpenRouterModels,
  updateVLLMModels,
} from '@/providers/ai/models'
import type { ProviderConfig, ProviderName, ProvidersStore } from './types'

const logger = createLogger('ProvidersStore')
let hasBootstrappedProviderModels = false

const PROVIDER_CONFIGS: Record<ProviderName, ProviderConfig> = {
  base: {
    apiEndpoint: '/api/providers/ai/base/models',
  },
  ollama: {
    apiEndpoint: '/api/providers/ai/ollama/models',
    updateFunction: updateOllamaModels,
  },
  openrouter: {
    apiEndpoint: '/api/providers/ai/openrouter/models',
    updateFunction: updateOpenRouterModels,
  },
  vllm: {
    apiEndpoint: '/api/providers/ai/vllm/models',
    updateFunction: updateVLLMModels,
  },
  fireworks: {
    apiEndpoint: '/api/providers/ai/fireworks/models',
    updateFunction: updateFireworksModels,
  },
}

export const useProvidersStore = create<ProvidersStore>((set, get) => ({
  providers: {
    base: { models: [], isLoading: false },
    ollama: { models: [], isLoading: false },
    openrouter: { models: [], isLoading: false },
    vllm: { models: [], isLoading: false },
    fireworks: { models: [], isLoading: false },
  },

  setModels: (provider, models) => {
    const config = PROVIDER_CONFIGS[provider]

    set((state) => ({
      providers: {
        ...state.providers,
        [provider]: {
          ...state.providers[provider],
          models,
        },
      },
    }))

    config.updateFunction?.(models)
  },

  fetchModels: async (provider) => {
    if (isHosted && provider === 'ollama') {
      return
    }

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
      const response = await fetch(PROVIDER_CONFIGS[provider].apiEndpoint)
      if (!response.ok) {
        throw new Error(`Failed to fetch ${provider} models: ${response.status}`)
      }
      const { models } = await response.json()
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
  store.fetchModels('vllm')
  store.fetchModels('fireworks')
}
