import { readServerJsonCache, writeServerJsonCache } from '@/lib/cache/server-json-cache'
import { updateOpenRouterModels } from '@/providers/ai/models'
import type { ModelPricing } from '@/providers/ai/types'

const CACHE_KEY = 'ai:openrouter:models'
const CACHE_TTL_SECONDS = 300

interface OpenRouterModel {
  id: string
  pricing?: {
    prompt?: string
    completion?: string
  }
}

interface OpenRouterCatalog {
  models: string[]
  pricing: Record<string, ModelPricing>
}

let pendingModels: Promise<OpenRouterCatalog> | undefined

export async function getOpenRouterModels(): Promise<OpenRouterCatalog> {
  pendingModels ??= (async () => {
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
    const allModels: string[] = []

    for (const model of data.data) {
      const modelId = `openrouter/${model.id}`
      allModels.push(modelId)

      const input = Number.parseFloat(model.pricing?.prompt ?? '')
      const output = Number.parseFloat(model.pricing?.completion ?? '')
      if (Number.isFinite(input) && input >= 0 && Number.isFinite(output) && output >= 0) {
        pricing[modelId] = { input: input * 1_000_000, output: output * 1_000_000 }
      }
    }

    const catalog = { models: Array.from(new Set(allModels)), pricing }
    await writeServerJsonCache(CACHE_KEY, catalog, CACHE_TTL_SECONDS)
    return catalog
  })().finally(() => {
    pendingModels = undefined
  })

  const catalog = await pendingModels
  updateOpenRouterModels(catalog.models, catalog.pricing)
  return catalog
}
