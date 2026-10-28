export type ProviderName = 'ollama' | 'openrouter' | 'base' | 'vllm' | 'fireworks'

export interface ProviderState {
  models: string[]
  isLoading: boolean
}

export interface ProvidersStore {
  providers: Record<ProviderName, ProviderState>
  fetchModels: (provider: ProviderName) => Promise<void>
}
