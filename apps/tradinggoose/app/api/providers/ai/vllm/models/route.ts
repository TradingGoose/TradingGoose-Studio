import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { resolveVllmServiceConfig } from '@/lib/system-services/runtime'
import { filterBlacklistedModels } from '@/providers/ai/utils'

const logger = createLogger('VLLMModelsAPI')

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const config = await resolveVllmServiceConfig()
    const baseUrl = (config.baseUrl || '').replace(/\/$/, '')

    if (!baseUrl) {
      logger.info('vLLM base URL not configured')
      return NextResponse.json({ models: [] })
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    const apiKey = config.apiKey
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
    }

    const response = await fetch(`${baseUrl}/v1/models`, {
      headers,
      next: { revalidate: 60 },
    })

    if (!response.ok) {
      logger.warn('vLLM service is not available', {
        status: response.status,
        statusText: response.statusText,
      })
      return NextResponse.json({ models: [] })
    }

    const data = (await response.json()) as { data: Array<{ id: string }> }
    const models = filterBlacklistedModels(data.data.map((model) => `vllm/${model.id}`))

    logger.info('Successfully fetched vLLM models', {
      count: models.length,
    })

    return NextResponse.json({ models })
  } catch (error) {
    logger.error('Failed to fetch vLLM models', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ models: [] })
  }
}
