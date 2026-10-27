export type ProviderName = 'ollama' | 'openrouter' | 'base' | 'vllm' | 'fireworks'

export interface ProviderState {
  models: string[]
  isLoading: boolean
}

export interface ProvidersStore {
  providers: Record<ProviderName, ProviderState>
  setModels: (provider: ProviderName, models: string[]) => void
  fetchModels: (provider: ProviderName) => Promise<void>
}

export interface ProviderConfig {
  apiEndpoint: string
  updateFunction?: (models: string[]) => void
}
