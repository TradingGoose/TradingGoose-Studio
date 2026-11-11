import { createWithEqualityFn as create } from 'zustand/traditional'
import type { RegistryModel, RegistryProvider } from '@/lib/mastra/registry'
import { getProviderIcon } from '@/lib/ui/provider-icon'

interface ModelRegistryState {
  providers: RegistryProvider[]
  isLoading: boolean
  error?: string
  load: () => Promise<void>
}

export const useModelRegistry = create<ModelRegistryState>((set, get) => ({
  providers: [],
  isLoading: false,
  load: async () => {
    if (get().isLoading) return
    set({ isLoading: true, error: undefined })
    try {
      const response = await fetch('/api/models')
      if (!response.ok) throw new Error(`Model registry is unavailable (HTTP ${response.status}).`)
      const { providers } = await response.json()
      set({ providers })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Model registry is unavailable.' })
    } finally {
      set({ isLoading: false })
    }
  },
}))

export function getRegistryModel(model: string): RegistryModel | undefined {
  for (const provider of useModelRegistry.getState().providers) {
    const found = provider.models.find(({ id }) => id === model)
    if (found) return found
  }
  return undefined
}

export function getModelProvider(model: string): string | undefined {
  return useModelRegistry
    .getState()
    .providers.find((provider) => provider.models.some(({ id }) => id === model))?.id
}

export function getModelOptions() {
  return useModelRegistry.getState().providers.flatMap((provider) => {
    const icon = getProviderIcon(provider.id)
    return provider.models.map(({ id }) => ({
      id,
      label: id,
      group: provider.id,
      searchLabel: `${id} ${provider.name}`,
      icon,
    }))
  })
}

export function getModelGroups() {
  return useModelRegistry
    .getState()
    .providers.map(({ id, name }) => ({ id, label: name, icon: getProviderIcon(id) }))
}

export function getDefaultModel() {
  return getRegistryModel('openai/gpt-4.1') ? 'openai/gpt-4.1' : undefined
}
