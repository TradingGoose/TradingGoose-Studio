import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { resolveNvidiaServiceConfig } from '@/lib/system-services/runtime'
import { filterBlacklistedModels } from '@/providers/ai/utils'

const logger = createLogger('NvidiaModelsAPI')

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const config = await resolveNvidiaServiceConfig()
    const baseUrl = config.baseUrl.replace(/\/$/, '')

    if (!config.apiKey) {
      logger.info('NVIDIA API key not configured')
      return NextResponse.json({ models: [] })
    }

    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      next: { revalidate: 300 },
    })

    if (!response.ok) {
      logger.warn('NVIDIA model listing is not available', {
        status: response.status,
        statusText: response.statusText,
      })
      return NextResponse.json({ models: [] })
    }

    const data = (await response.json()) as { data?: Array<{ id: string }> }
    const models = filterBlacklistedModels(
      Array.from(new Set((data.data ?? []).map((model) => `nvidia/${model.id}`)))
    )

    logger.info('Successfully fetched NVIDIA models', { count: models.length })

    return NextResponse.json({ models })
  } catch (error) {
    logger.error('Failed to fetch NVIDIA models', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ models: [] })
  }
}
