import { NextResponse } from 'next/server'
import { isHosted } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { resolveOllamaServiceConfig } from '@/lib/system-services/runtime'

const logger = createLogger('OllamaModelsAPI')

export const dynamic = 'force-dynamic'

export async function GET() {
  if (isHosted) {
    return NextResponse.json({ models: [] })
  }

  try {
    const { baseUrl } = await resolveOllamaServiceConfig()
    const response = await fetch(`${baseUrl}/api/tags`)

    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status}`)
    }

    const { models } = (await response.json()) as { models: { name: string }[] }
    return NextResponse.json({ models: models.map((model) => `ollama/${model.name}`) })
  } catch (error) {
    logger.error('Failed to fetch Ollama models', error)
    return NextResponse.json({ error: 'Failed to fetch Ollama models' }, { status: 502 })
  }
}
