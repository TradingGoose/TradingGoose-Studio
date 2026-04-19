import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { resolveOllamaServiceConfig } from '@/lib/system-services/runtime'
import type { ModelsObject } from '@/providers/ai/ollama/types'

const logger = createLogger('OllamaModelsAPI')

export const dynamic = 'force-dynamic'

/**
 * Get available Ollama models
 */
export async function GET(request: NextRequest) {
  try {
    const ollamaConfig = await resolveOllamaServiceConfig()
    logger.info('Fetching Ollama models', {
      host: ollamaConfig.baseUrl,
    })

    const response = await fetch(`${ollamaConfig.baseUrl}/api/tags`, {
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      logger.warn('Ollama service is not available', {
        status: response.status,
        statusText: response.statusText,
      })
      return NextResponse.json({ models: [] })
    }

    const data = (await response.json()) as ModelsObject
    const models = data.models.map((model) => model.name)

    logger.info('Successfully fetched Ollama models', {
      count: models.length,
      models,
    })

    return NextResponse.json({ models })
  } catch (error) {
      logger.error('Failed to fetch Ollama models', {
        error: error instanceof Error ? error.message : 'Unknown error',
        host: (await resolveOllamaServiceConfig()).baseUrl,
      })

    // Return empty array instead of error to avoid breaking the UI
    return NextResponse.json({ models: [] })
  }
}
