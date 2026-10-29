import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { getOpenRouterModels } from '@/providers/ai/openrouter/models'

const logger = createLogger('OpenRouterModelsAPI')

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json(await getOpenRouterModels())
  } catch (error) {
    logger.error('Error fetching OpenRouter models', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json({ error: 'Failed to fetch OpenRouter models' }, { status: 502 })
  }
}
