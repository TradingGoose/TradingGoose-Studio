import type { ModelCapabilities } from '@/providers/ai/models'
import type { ModelPricing } from '@/providers/ai/types'

export type ProviderName = 'ollama' | 'openrouter' | 'base' | 'vllm' | 'fireworks'

export interface ProviderState {
  models: string[]
  isLoading: boolean
}

export interface ProvidersStore {
  providers: Record<ProviderName, ProviderState>
  publishCatalog: (
    provider: ProviderName,
    models: string[],
    pricing?: Record<string, ModelPricing>,
    capabilities?: Record<string, ModelCapabilities>
  ) => void
  fetchModels: (provider: ProviderName) => Promise<void>
}
