import {
  EMBEDDING_MODELS,
  GatewayRegistry,
  modelSupportsStructuredOutput,
  modelSupportsTemperature,
  parseModelString,
} from '@mastra/core/llm'
import { providers as modelCatalog } from '@opencode-ai/models/snapshot'
import { getConfiguredProviders } from './connections'

export interface RegistryModel {
  id: string
  temperature?: boolean
  structuredOutput?: boolean
}

export interface RegistryProvider {
  id: string
  name: string
  models: RegistryModel[]
}

function getRegistryProviders() {
  return { ...GatewayRegistry.getInstance().getProviders(), ...getConfiguredProviders() }
}

/** Provider identities without model capabilities or connection configuration. */
export function getModelProviders(): Pick<RegistryProvider, 'id' | 'name'>[] {
  return Object.entries(getRegistryProviders()).map(([id, { name }]) => ({ id, name }))
}

/** models.dev omits type for chat models; model names and modalities do not establish API type. */
export function isLanguageModel(provider: string, modelId: string): boolean {
  return (
    (modelCatalog[provider]?.models?.[modelId]?.type ?? 'chat') === 'chat' &&
    !EMBEDDING_MODELS.some((entry) => entry.provider === provider && entry.id === modelId)
  )
}

function isListedGenerationModel(provider: string, modelId: string, models: string[]): boolean {
  return models.includes(modelId) && isLanguageModel(provider, modelId)
}

/** Validate only after workflow and environment references have resolved. */
export function assertListedModel(model: string): void {
  const { provider, modelId } = parseModelString(model)
  const providers = getRegistryProviders()
  const connection =
    provider && Object.hasOwn(providers, provider) ? providers[provider] : undefined
  if (!provider || !connection || !isListedGenerationModel(provider, modelId, connection.models)) {
    throw Object.assign(
      new Error(
        `Model "${model}" is not a listed Mastra language model. Select a listed provider/model in the Model field.`
      ),
      { status: 400 }
    )
  }
}

/** Project public picker data explicitly: provider auth configuration stays on the server. */
export function getModelRegistry(): RegistryProvider[] {
  return Object.entries(getRegistryProviders()).map(([id, provider]) => ({
    id,
    name: provider.name,
    models: provider.models
      .filter((modelId) => isListedGenerationModel(id, modelId, provider.models))
      .map((modelId) => getNativeRegistryModel(`${id}/${modelId}`)),
  }))
}

/** Server capability resolution does not depend on browser bootstrap state. */
export function getNativeRegistryModel(model: string): RegistryModel {
  const { provider } = parseModelString(model)
  // A configured endpoint does not inherit the built-in provider's capability data.
  if (provider && getConfiguredProviders()[provider]) return { id: model }
  return {
    id: model,
    temperature: modelSupportsTemperature(model),
    structuredOutput: modelSupportsStructuredOutput(model),
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
  const providers = getRegistryProviders()
  return EMBEDDING_MODELS.flatMap(({ id, provider, dimensions, maxInputTokens }) => {
    const connection = Object.hasOwn(providers, provider) ? providers[provider] : undefined
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
