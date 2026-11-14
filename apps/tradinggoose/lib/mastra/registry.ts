import {
  EMBEDDING_MODELS,
  modelSupportsStructuredOutput,
  modelSupportsTemperature,
  parseModelString,
} from '@mastra/core/llm'
import { providers as modelCatalog } from '@opencode-ai/models/snapshot'
import { getModelProviders } from '@/lib/mastra/providers'
import { listSystemServices } from '@/lib/system-services/service'

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

/** Untyped music/audio generators must not enter the text/tool execution path. */
export function isLanguageModel(provider: string, modelId: string): boolean {
  const model = modelCatalog[provider]?.models?.[modelId]
  if (model?.type) return model.type === 'chat'
  if (
    model &&
    (!model.modalities.output.includes('text') ||
      (model.modalities.output.includes('audio') && !model.tool_call))
  )
    return false
  return !EMBEDDING_MODELS.some((entry) => entry.provider === provider && entry.id === modelId)
}

/** Validate only after workflow and environment references have resolved. */
export async function assertListedModel(model: string): Promise<void> {
  const { provider, modelId } = parseModelString(model)
  const providers = getModelProviders()
  const connection =
    provider && Object.hasOwn(providers, provider) ? providers[provider] : undefined
  if (!provider || !connection?.models.includes(modelId) || !isLanguageModel(provider, modelId)) {
    throw Object.assign(
      new Error(
        `Model "${model}" is not a listed Mastra language model. Select a listed provider/model in the Model field.`
      ),
      { status: 400 }
    )
  }
}

/** Project public picker data explicitly: provider auth configuration stays on the server. */
export async function getModelRegistry(): Promise<{
  providers: RegistryProvider[]
  managedProviders: string[]
}> {
  const providers = getModelProviders()
  const services = await listSystemServices()
  return {
    providers: Object.entries(providers).map(([id, provider]) => ({
      id,
      name: provider.name,
      models: provider.models
        .filter((modelId) => isLanguageModel(id, modelId))
        .map((modelId) => getNativeModel(`${id}/${modelId}`)),
    })),
    managedProviders: Object.keys(providers).filter((id) =>
      services.some((service) => service.id === id && service.credentials[0]?.hasValue)
    ),
  }
}

/** Capabilities come directly from Mastra's model catalog. */
export function getNativeModel(model: string): RegistryModel {
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

export async function getEmbeddingModelRegistry(): Promise<RegistryEmbeddingModel[]> {
  const providers = getModelProviders()
  return EMBEDDING_MODELS.flatMap(({ id, provider, dimensions, maxInputTokens }) => {
    const connection = Object.hasOwn(providers, provider) ? providers[provider] : undefined
    return connection?.models.includes(id)
      ? [{ id: `${provider}/${id}`, provider, dimensions, maxInputTokens }]
      : []
  })
}

/** Generation model membership alone does not establish embedding support. */
export async function assertListedEmbeddingModel(model: string): Promise<RegistryEmbeddingModel> {
  const listed = (await getEmbeddingModelRegistry()).find(({ id }) => id === model)
  if (!listed)
    throw Object.assign(
      new Error(
        `Embedding model "${model}" is not listed by Mastra. Select a listed provider/model in the Model field.`
      ),
      { status: 400 }
    )
  return listed
}
