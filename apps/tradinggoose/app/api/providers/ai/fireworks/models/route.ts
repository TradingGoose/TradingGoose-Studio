import { NextResponse } from 'next/server'
import { getEnv } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { filterBlacklistedModels } from '@/providers/ai/utils'

const logger = createLogger('FireworksModelsAPI')

export const dynamic = 'force-dynamic'

interface FireworksModelsResponse {
  data?: Array<{ id: string }>
}

export async function GET() {
  const apiKey = getEnv('FIREWORKS_API_KEY')
  if (!apiKey) {
    logger.info('No Fireworks API key available')
    return NextResponse.json({ models: [] })
  }

  try {
    const response = await fetch('https://api.fireworks.ai/inference/v1/models', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      next: { revalidate: 300 },
    })

    if (!response.ok) {
      logger.warn('Failed to fetch Fireworks models', {
        status: response.status,
        statusText: response.statusText,
      })
      return NextResponse.json({ models: [] })
    }

    const data = (await response.json()) as FireworksModelsResponse
    const models = filterBlacklistedModels(
      Array.from(new Set((data.data ?? []).map((model) => `fireworks/${model.id}`)))
    )

    logger.info('Successfully fetched Fireworks models', {
      count: models.length,
    })

    return NextResponse.json({ models })
  } catch (error) {
    logger.error('Error fetching Fireworks models', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ models: [] })
  }
}
