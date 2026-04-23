import { NextResponse } from 'next/server'
import { getEnv } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { filterBlacklistedModels } from '@/providers/ai/utils'

const logger = createLogger('VLLMModelsAPI')

export const dynamic = 'force-dynamic'

export async function GET() {
  const baseUrl = (getEnv('VLLM_BASE_URL') || '').replace(/\/$/, '')

  if (!baseUrl) {
    logger.info('VLLM_BASE_URL not configured')
    return NextResponse.json({ models: [] })
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    const apiKey = getEnv('VLLM_API_KEY')
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
      baseUrl,
    })
    return NextResponse.json({ models: [] })
  }
}
