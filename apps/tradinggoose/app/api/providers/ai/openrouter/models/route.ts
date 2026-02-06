import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { filterBlacklistedModels } from '@/providers/ai/utils'

const logger = createLogger('OpenRouterModelsAPI')

export const dynamic = 'force-dynamic'

interface OpenRouterModel {
  id: string
  context_length?: number
  supported_parameters?: string[]
  pricing?: {
    prompt?: string
    completion?: string
  }
}

interface OpenRouterResponse {
  data: OpenRouterModel[]
}

interface OpenRouterModelInfo {
  id: string
  contextLength?: number
  supportsStructuredOutputs?: boolean
  supportsTools?: boolean
  pricing?: {
    input: number
    output: number
  }
}

export async function GET(_request: NextRequest) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 8000)

  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Content-Type': 'application/json' },
      next: { revalidate: 300 },
      signal: controller.signal,
    })

    if (!response.ok) {
      logger.warn('Failed to fetch OpenRouter models', {
        status: response.status,
        statusText: response.statusText,
      })
      return NextResponse.json({ models: [], modelInfo: {} })
    }

    const data = (await response.json()) as OpenRouterResponse
    const modelInfo: Record<string, OpenRouterModelInfo> = {}
    const allModels: string[] = []

    for (const model of data.data ?? []) {
      const modelId = `openrouter/${model.id}`
      allModels.push(modelId)

      const supportedParams = model.supported_parameters ?? []
      modelInfo[modelId] = {
        id: modelId,
        contextLength: model.context_length,
        supportsStructuredOutputs: supportedParams.includes('structured_outputs'),
        supportsTools: supportedParams.includes('tools'),
        pricing: model.pricing
          ? {
              input: Number.parseFloat(model.pricing.prompt ?? '0') * 1000000,
              output: Number.parseFloat(model.pricing.completion ?? '0') * 1000000,
            }
          : undefined,
      }
    }

    const uniqueModels = Array.from(new Set(allModels))
    const models = filterBlacklistedModels(uniqueModels)

    const structuredOutputCount = Object.values(modelInfo).filter(
      (model) => model.supportsStructuredOutputs
    ).length

    logger.info('Successfully fetched OpenRouter models', {
      count: models.length,
      filtered: uniqueModels.length - models.length,
      withStructuredOutputs: structuredOutputCount,
    })

    return NextResponse.json({ models, modelInfo })
  } catch (error) {
    logger.error('Error fetching OpenRouter models', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ models: [], modelInfo: {} })
  } finally {
    clearTimeout(timeoutId)
  }
}
