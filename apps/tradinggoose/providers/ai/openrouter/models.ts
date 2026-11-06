import { type ModelCapabilities, updateOpenRouterModels } from '@/providers/ai/models'
import type { ModelPricing } from '@/providers/ai/types'

const CACHE_KEY = 'ai:openrouter:models:v3'
const CACHE_TTL_SECONDS = 300

interface OpenRouterModel {
  id: string
  supported_parameters?: string[]
  reasoning?: {
    supported_efforts?: string[] | null
    mandatory?: boolean
  }
  pricing?: {
    prompt?: string
    completion?: string
    input_cache_read?: string
  }
}

interface OpenRouterCatalog {
  models: string[]
  pricing: Record<string, ModelPricing>
  capabilities: Record<string, ModelCapabilities>
}

let pendingModels: Promise<OpenRouterCatalog> | undefined

/** Loads browser capabilities through the server endpoint and deduplicates cached server discovery. */
export async function getOpenRouterModels(): Promise<OpenRouterCatalog> {
  if (typeof window !== 'undefined') {
    const response = await fetch('/api/providers/ai/openrouter/models')
    if (!response.ok) throw new Error(`OpenRouter models endpoint returned HTTP ${response.status}`)
    const catalog = (await response.json()) as OpenRouterCatalog
    updateOpenRouterModels(catalog.models, catalog.pricing, catalog.capabilities)
    return catalog
  }

  pendingModels ??=
    /** Loads cached or discovered model capabilities and pricing. */
    (async () => {
      const { readServerJsonCache, writeServerJsonCache } = await import(
        '@/lib/cache/server-json-cache'
      )
      const cached = await readServerJsonCache<OpenRouterCatalog>(CACHE_KEY)
      if (cached) return cached

      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      })

      if (!response.ok) {
        throw new Error(`OpenRouter returned HTTP ${response.status}`)
      }

      const data = (await response.json()) as { data: OpenRouterModel[] }
      const pricing: Record<string, ModelPricing> = {}
      const capabilities: Record<string, ModelCapabilities> = {}
      const allModels: string[] = []

      for (const model of data.data) {
        const modelId = `openrouter/${model.id}`
        allModels.push(modelId)

        const supportedParameters = new Set(model.supported_parameters ?? [])
        // Null accepts every gateway effort; omission exposes no effort selector.
        const supportedEfforts = (
          model.reasoning?.supported_efforts === null
            ? ['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none']
            : (model.reasoning?.supported_efforts ?? [])
        ).filter(
          /** Excludes the disabled-reasoning effort when the model requires reasoning. */
          (effort) => effort !== 'none' || !model.reasoning?.mandatory
        )
        const modelCapabilities: ModelCapabilities = {
          ...(supportedParameters.has('temperature') && {
            temperature: { min: 0, max: 2 },
          }),
          ...(supportedEfforts.length > 0 && {
            reasoningEffort: { values: supportedEfforts },
          }),
          ...(supportedParameters.has('verbosity') && {
            verbosity: { values: ['low', 'medium', 'high'] },
          }),
        }
        if (Object.keys(modelCapabilities).length > 0) {
          capabilities[modelId] = modelCapabilities
        }

        const input = Number.parseFloat(model.pricing?.prompt ?? '')
        const output = Number.parseFloat(model.pricing?.completion ?? '')
        const cachedInput = Number.parseFloat(model.pricing?.input_cache_read ?? '')
        if (Number.isFinite(input) && input >= 0 && Number.isFinite(output) && output >= 0) {
          pricing[modelId] = {
            input: input * 1_000_000,
            output: output * 1_000_000,
            ...(Number.isFinite(cachedInput) &&
              cachedInput >= 0 && { cachedInput: cachedInput * 1_000_000 }),
          }
        }
      }

      const catalog = { models: Array.from(new Set(allModels)), pricing, capabilities }
      await writeServerJsonCache(CACHE_KEY, catalog, CACHE_TTL_SECONDS)
      return catalog
    })().finally(() => {
      pendingModels = undefined
    })

  const catalog = await pendingModels
  updateOpenRouterModels(catalog.models, catalog.pricing, catalog.capabilities)
  return catalog
}
