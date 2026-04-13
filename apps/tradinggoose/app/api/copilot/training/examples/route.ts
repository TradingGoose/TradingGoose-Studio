import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { resolveAgentIndexerServiceConfig } from '@/lib/system-services/runtime'

const logger = createLogger('CopilotTrainingExamplesAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const { baseUrl, apiKey } = await resolveAgentIndexerServiceConfig()
  if (!baseUrl) {
    logger.error('Missing agent indexer base URL')
    return NextResponse.json({ error: 'Agent indexer not configured' }, { status: 500 })
  }

  if (!apiKey) {
    logger.error('Missing agent indexer API key')
    return NextResponse.json(
      { error: 'Agent indexer authentication not configured' },
      { status: 500 }
    )
  }

  try {
    const body = await request.json()

    logger.info('Sending workflow example to agent indexer', {
      hasJsonField: typeof body?.json === 'string',
    })

    const upstream = await fetch(`${baseUrl}/examples/add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
    })

    if (!upstream.ok) {
      const errorText = await upstream.text()
      logger.error('Agent indexer rejected the example', {
        status: upstream.status,
        error: errorText,
      })
      return NextResponse.json({ error: errorText }, { status: upstream.status })
    }

    const data = await upstream.json()
    logger.info('Successfully sent workflow example to agent indexer')

    return NextResponse.json(data, {
      headers: { 'content-type': 'application/json' },
    })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to add example'
    logger.error('Failed to send workflow example', { error: err })
    return NextResponse.json({ error: errorMessage }, { status: 502 })
  }
}
