import {
  EMBEDDING_MODELS,
  modelSupportsStructuredOutput,
  modelSupportsTemperature,
  parseModelString,
} from '@mastra/core/llm'
import { providers as modelCatalog } from '@opencode-ai/models/snapshot'
import { getReasoningOptions } from '@/lib/mastra/native-reasoning'
import { getModelProviders } from '@/lib/mastra/providers'
import type { ReasoningOption } from '@/lib/mastra/reasoning'
import { listSystemServices } from '@/lib/system-services/service'

export interface RegistryModel {
  id: string
  temperature?: boolean
  structuredOutput?: boolean
  toolCall?: boolean
  reasoningOptions?: ReasoningOption[]
}

export interface RegistryProvider {
  id: string
  name: string
  models: RegistryModel[]
}

/** Check native text generation compatibility, including function tools when required. */
export function isLanguageModel(provider: string, modelId: string, requireTools = false): boolean {
  const model = modelCatalog[provider]?.models?.[modelId]
  if (requireTools && model?.tool_call === false) return false
  if (
    model &&
    ((model.type && model.type !== 'chat') ||
      !model.modalities.input.includes('text') ||
      !model.modalities.output.includes('text') ||
      (model.modalities.output.includes('audio') && !model.tool_call))
  )
    return false
  return !EMBEDDING_MODELS.some((entry) => entry.provider === provider && entry.id === modelId)
}

/** Validate only after workflow and environment references have resolved. */
export async function assertListedModel(model: string, requireTools = false): Promise<void> {
  const { provider, modelId } = parseModelString(model)
  const providers = getModelProviders()
  const connection =
    provider && Object.hasOwn(providers, provider) ? providers[provider] : undefined
  if (
    !provider ||
    !connection?.models.includes(modelId) ||
    !isLanguageModel(provider, modelId, requireTools)
  ) {
    throw Object.assign(
      new Error(
        `Model "${model}" is not a listed language model${requireTools ? ' with function tool support' : ''}. Select a listed provider/model in the Model field.`
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

/** Native capabilities with function-tool support from the published model catalog. */
export function getNativeModel(model: string): RegistryModel {
  const { provider, modelId } = parseModelString(model)
  return {
    id: model,
    temperature: modelSupportsTemperature(model),
    structuredOutput: modelSupportsStructuredOutput(model),
    toolCall: provider ? modelCatalog[provider]?.models?.[modelId]?.tool_call : undefined,
    reasoningOptions: getReasoningOptions(model),
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
        `Embedding model "${model}" is not available. Select a listed provider/model in the Model field.`
      ),
      { status: 400 }
    )
  return listed
}
