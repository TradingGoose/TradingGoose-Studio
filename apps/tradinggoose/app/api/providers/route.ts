import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { handleAIProviderRequest, type ProviderRouteBody } from '@/app/api/providers/ai/handler'
import { handleMarketProviderRequest } from '@/app/api/providers/market/handler'

const logger = createLogger('ProvidersAPI')

export const dynamic = 'force-dynamic'

type ProviderNamespace = 'ai' | 'market'

/**
 * Server-side proxy for provider requests
 */
export async function POST(request: NextRequest) {
  const requestId = generateRequestId()
  const startTime = Date.now()

  try {
    logger.info(`[${requestId}] Provider API request started`, {
      timestamp: new Date().toISOString(),
      userAgent: request.headers.get('User-Agent'),
      contentType: request.headers.get('Content-Type'),
    })

    const body = (await request.json()) as ProviderRouteBody
    const { provider, providerNamespace, providerType } = body

    const { namespace, providerId } = resolveProviderNamespace(
      provider,
      providerNamespace ?? providerType
    )

    if (!providerId) {
      logger.warn(`[${requestId}] Provider not specified in request body`)
      return NextResponse.json({ error: 'Provider identifier is required' }, { status: 400 })
    }

    logger.info(`[${requestId}] Provider request details`, {
      provider: providerId,
      providerNamespace: namespace,
    })

    if (namespace === 'ai') {
      return handleAIProviderRequest({
        body,
        providerId,
        requestId,
        startTime,
      })
    }

    if (namespace === 'market') {
      return handleMarketProviderRequest({
        body,
        providerId,
        requestId,
        startTime,
      })
    }

    logger.warn(`[${requestId}] Unsupported provider namespace`, {
      namespace,
      providerId,
    })
    return NextResponse.json(
      { error: `Provider namespace '${namespace}' is not supported` },
      { status: 501 }
    )
  } catch (error) {
    const executionTime = Date.now() - startTime
    logger.error(`[${requestId}] Provider request failed:`, {
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : 'Unknown',
      errorStack: error instanceof Error ? error.stack : undefined,
      executionTime,
      timestamp: new Date().toISOString(),
    })

    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

function resolveProviderNamespace(
  provider: string | undefined,
  explicit?: ProviderNamespace
): { namespace: ProviderNamespace; providerId: string } {
  if (!provider) {
    return { namespace: explicit ?? 'ai', providerId: '' }
  }

  if (explicit) {
    return { namespace: explicit, providerId: provider }
  }

  if (provider.includes(':')) {
    const [maybeNamespace, remainder] = provider.split(':', 2)
    if (
      (maybeNamespace === 'ai' || maybeNamespace === 'market') &&
      typeof remainder === 'string' &&
      remainder.length > 0
    ) {
      return { namespace: maybeNamespace as ProviderNamespace, providerId: remainder }
    }
  }

  return { namespace: 'ai', providerId: provider }
}
