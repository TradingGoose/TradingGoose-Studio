import { createWithEqualityFn as create } from 'zustand/traditional'
import { isHosted } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import {
  updateFireworksModels,
  updateOllamaModels,
  updateOpenRouterModels,
  updateVLLMModels,
} from '@/providers/ai/models'
import type { ProviderName, ProviderState, ProvidersStore } from './types'

const logger = createLogger('ProvidersStore')
let hasBootstrappedProviderModels = false

const MODEL_UPDATERS: Partial<Record<ProviderName, typeof updateOpenRouterModels>> = {
  ollama: updateOllamaModels,
  openrouter: updateOpenRouterModels,
  vllm: updateVLLMModels,
  fireworks: updateFireworksModels,
}

export const useProvidersStore = create<ProvidersStore>((set, get) => {
  const updateProvider = (provider: ProviderName, update: Partial<ProviderState>) => {
    set((state) => ({
      providers: {
        ...state.providers,
        [provider]: { ...state.providers[provider], ...update },
      },
    }))
  }

  return {
    providers: {
      base: { models: [], isLoading: false },
      ollama: { models: [], isLoading: false },
      openrouter: { models: [], isLoading: false },
      vllm: { models: [], isLoading: false },
      fireworks: { models: [], isLoading: false },
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

      updateProvider(provider, { isLoading: true })

      try {
        const response = await fetch(`/api/providers/ai/${provider}/models`)
        if (!response.ok) {
          throw new Error(`Failed to fetch ${provider} models: ${response.status}`)
        }
        const { models, pricing } = await response.json()
        logger.info(`Successfully fetched ${provider} models`, {
          count: models.length,
          ...(provider === 'ollama' ? { models } : {}),
        })
        MODEL_UPDATERS[provider]?.(models, pricing)
        updateProvider(provider, { models })
      } catch (error) {
        logger.error(`Failed to fetch ${provider} models`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      } finally {
        updateProvider(provider, { isLoading: false })
      }
    },
  }
})

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
