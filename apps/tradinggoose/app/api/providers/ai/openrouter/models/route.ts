import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import type { ModelPricing } from '@/providers/ai/types'

const logger = createLogger('OpenRouterModelsAPI')

export const dynamic = 'force-dynamic'

interface OpenRouterModel {
  id: string
  pricing?: {
    prompt?: string
    completion?: string
  }
}

interface OpenRouterResponse {
  data: OpenRouterModel[]
}

export async function GET() {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 8000)

  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Content-Type': 'application/json' },
      next: { revalidate: 300 },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`OpenRouter returned HTTP ${response.status}`)
    }

    const data = (await response.json()) as OpenRouterResponse
    const pricing: Record<string, ModelPricing> = {}
    const allModels: string[] = []
    const updatedAt = new Date().toISOString().split('T')[0]

    for (const model of data.data) {
      const modelId = `openrouter/${model.id}`
      allModels.push(modelId)

      const input = Number.parseFloat(model.pricing?.prompt ?? '')
      const output = Number.parseFloat(model.pricing?.completion ?? '')
      if (Number.isFinite(input) && input >= 0 && Number.isFinite(output) && output >= 0) {
        pricing[modelId] = { input: input * 1_000_000, output: output * 1_000_000, updatedAt }
      }
    }

    const models = Array.from(new Set(allModels))

    logger.info('Successfully fetched OpenRouter models', {
      count: models.length,
    })

    return NextResponse.json({ models, pricing })
  } catch (error) {
    logger.error('Error fetching OpenRouter models', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ error: 'Failed to fetch OpenRouter models' }, { status: 502 })
  } finally {
    clearTimeout(timeoutId)
  }
}
