import {
  EMBEDDING_MODELS,
  getModelReasoningOptions,
  getProviderConfig,
  type ModelReasoningOption,
  modelSupportsAttachments,
  modelSupportsStructuredOutput,
  modelSupportsTemperature,
  PROVIDER_REGISTRY,
  parseModelString,
} from '@mastra/core/llm'
import { getConfiguredProviders } from './connections'

export interface RegistryModel {
  id: string
  reasoning?: ModelReasoningOption[]
  temperature?: boolean
  structuredOutput?: boolean
  attachments?: boolean
}

export interface RegistryProvider {
  id: string
  name: string
  models: RegistryModel[]
}

/** Exact native embedding identities are excluded only from generation. */
function isListedGenerationModel(provider: string, modelId: string, models: string[]): boolean {
  return (
    models.includes(modelId) &&
    !EMBEDDING_MODELS.some((entry) => entry.provider === provider && entry.id === modelId)
  )
}

/** Validate only after workflow and environment references have resolved. */
export function assertListedModel(model: string): void {
  const { provider, modelId } = parseModelString(model)
  const connection = provider
    ? (getConfiguredProviders()[provider] ??
      (Object.keys(PROVIDER_REGISTRY).includes(provider) ? getProviderConfig(provider) : undefined))
    : undefined
  if (!provider || !connection || !isListedGenerationModel(provider, modelId, connection.models)) {
    throw Object.assign(
      new Error(
        `Model "${model}" is not listed by Mastra. Select a listed provider/model in the Model field.`
      ),
      { status: 400 }
    )
  }
}

/** Project public picker data explicitly: provider auth configuration stays on the server. */
export function getModelRegistry(): RegistryProvider[] {
  const configuredProviders = getConfiguredProviders()
  return Array.from(
    new Set([...Object.keys(PROVIDER_REGISTRY), ...Object.keys(configuredProviders)])
  ).flatMap((id) => {
    const provider = configuredProviders[id] ?? getProviderConfig(id)
    if (!provider) return []
    return [
      {
        id,
        name: provider.name,
        models: provider.models
          .filter((modelId) => isListedGenerationModel(id, modelId, provider.models))
          .map((modelId) => {
            const model = `${id}/${modelId}`
            return {
              id: model,
              reasoning: getModelReasoningOptions(model),
              temperature: modelSupportsTemperature(model),
              structuredOutput: modelSupportsStructuredOutput(model),
              attachments: modelSupportsAttachments(model),
            }
          }),
      },
    ]
  })
}

/** Server capability resolution does not depend on browser bootstrap state. */
export function getNativeRegistryModel(model: string): RegistryModel {
  return {
    id: model,
    reasoning: getModelReasoningOptions(model),
    temperature: modelSupportsTemperature(model),
    structuredOutput: modelSupportsStructuredOutput(model),
    attachments: modelSupportsAttachments(model),
  }
}

/** Public native embedding metadata only; no server connection configuration crosses this DTO. */
export interface RegistryEmbeddingModel {
  id: string
  provider: string
  dimensions: number
  maxInputTokens: number
}

export function getEmbeddingModelRegistry(): RegistryEmbeddingModel[] {
  const configured = getConfiguredProviders()
  return EMBEDDING_MODELS.flatMap(({ id, provider, dimensions, maxInputTokens }) => {
    const connection =
      configured[provider] ??
      (Object.hasOwn(PROVIDER_REGISTRY, provider) ? getProviderConfig(provider) : undefined)
    return connection?.models.includes(id)
      ? [{ id: `${provider}/${id}`, provider, dimensions, maxInputTokens }]
      : []
  })
}

/** Generation model membership alone does not establish embedding support. */
export function assertListedEmbeddingModel(model: string): RegistryEmbeddingModel {
  const listed = getEmbeddingModelRegistry().find(({ id }) => id === model)
  if (!listed)
    throw Object.assign(
      new Error(
        `Embedding model "${model}" is not listed by Mastra. Select a listed provider/model in the Model field.`
      ),
      { status: 400 }
    )
  return listed
}
