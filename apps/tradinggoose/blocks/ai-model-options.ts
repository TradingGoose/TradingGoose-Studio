import type { SubBlockOption, SubBlockOptionGroup } from '@/blocks/types'
import type { ProviderId } from '@/providers/ai/types'
import {
  getAllModelProviders,
  getHostedModels,
  getProviderIcon,
  providers,
} from '@/providers/ai/utils'
import { useProvidersStore } from '@/stores/providers/store'

type AiModelEntry = {
  model: string
  providerId: ProviderId
}

export function getAvailableAiModels(): string[] {
  return getAvailableAiModelEntries().map(({ model }) => model)
}

export function getAvailableAiModelOptions(): SubBlockOption[] {
  return getAvailableAiModelEntries().map(({ model, providerId }) => {
    const provider = providers[providerId]
    const icon = provider?.icon ?? getProviderIcon(model)
    const label = getModelLabel(model)

    return {
      label,
      id: model,
      group: providerId,
      searchLabel: `${model} ${label} ${provider?.name ?? providerId}`,
      ...(icon && { icon }),
    }
  })
}

export function getAvailableAiModelGroups(): SubBlockOptionGroup[] {
  const seenProviderIds = new Set<ProviderId>()
  const groups: SubBlockOptionGroup[] = []

  for (const { providerId } of getAvailableAiModelEntries()) {
    if (seenProviderIds.has(providerId)) continue

    const provider = providers[providerId]
    seenProviderIds.add(providerId)
    groups.push({
      id: providerId,
      label: provider?.name ?? providerId,
      ...(provider?.icon && { icon: provider.icon }),
    })
  }

  return groups
}

export function getAiModelsWithoutApiKey(): string[] {
  return Array.from(
    new Set([...getHostedModels(), ...useProvidersStore.getState().providers.ollama.models])
  )
}

function getAvailableAiModelEntries(): AiModelEntry[] {
  const providersState = useProvidersStore.getState()
  const modelProviders = getAllModelProviders()
  const seenModels = new Set<string>()
  const entries: AiModelEntry[] = []

  const addModel = (model: string, providerId: ProviderId) => {
    const normalizedModel = model.toLowerCase()
    if (seenModels.has(normalizedModel)) return

    seenModels.add(normalizedModel)
    entries.push({ model, providerId })
  }

  const addCatalogModels = (models: string[]) => {
    for (const model of models) {
      const providerId = modelProviders[model.toLowerCase()]
      if (!providerId) throw new Error(`No AI provider registered for model: ${model}`)
      addModel(model, providerId)
    }
  }

  addCatalogModels(providersState.providers.base.models)
  providersState.providers.ollama.models.forEach((model) => addModel(model, 'ollama'))
  providersState.providers.openrouter.models.forEach((model) => addModel(model, 'openrouter'))

  return entries
}

function getModelLabel(model: string): string {
  const prefixEnd = model.indexOf('/')
  return prefixEnd === -1 ? model : model.slice(prefixEnd + 1)
}
