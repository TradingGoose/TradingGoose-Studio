import { type NextRequest, NextResponse } from 'next/server'
import { authorizeCredentialUse, credentialAuthStatus } from '@/lib/auth/credential-access'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import {
  type ProviderRouteBody as AIProviderRouteBody,
  handleAIProviderRequest,
} from '@/app/api/providers/ai/handler'
import {
  handleMarketProviderRequest,
  type MarketProviderRouteBody,
} from '@/app/api/providers/market/handler'
import { getMarketProviderDefinition } from '@/providers/market/providers'

const logger = createLogger('ProvidersAPI')

export const dynamic = 'force-dynamic'

type ProviderNamespace = 'ai' | 'market'
type ProviderRouteBody = AIProviderRouteBody | MarketProviderRouteBody

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
      const aiBody = body as AIProviderRouteBody
      const auth = aiBody.tools?.length
        ? await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
        : null
      if (auth && (!auth.success || !auth.userId)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      return handleAIProviderRequest({
        body: aiBody,
        providerId,
        requestId,
        startTime,
        authUserId: auth?.userId,
      })
    }

    if (namespace === 'market') {
      const marketBody = body as MarketProviderRouteBody
      const oauth = getMarketProviderDefinition(providerId.split('/')[0])?.oauth
      const searchParams = new URL(request.url).searchParams
      const workflowId = searchParams.get('workflowId')?.trim()
      let authUserId: string | undefined
      if (oauth && workflowId) {
        const credentialId = marketBody.providerParams?.credentialId
        if (typeof credentialId !== 'string' || !credentialId.trim()) {
          return NextResponse.json({ error: 'Credential ID is required' }, { status: 400 })
        }
        const authz = await authorizeCredentialUse(request, {
          credentialId: credentialId.trim(),
          workflowId,
          workspaceId: searchParams.get('workspaceId')?.trim() || undefined,
        })
        if (!authz.ok || !authz.credentialOwnerUserId || !authz.resolvedTokenAccountId) {
          return NextResponse.json(
            { error: authz.error || 'Unauthorized' },
            { status: credentialAuthStatus(authz.error) }
          )
        }
        if (authz.resolvedProviderId !== oauth.provider) {
          return NextResponse.json({ error: 'Credential provider mismatch' }, { status: 403 })
        }
        marketBody.providerParams = {
          ...marketBody.providerParams,
          credentialId: authz.resolvedTokenAccountId,
        }
        authUserId = authz.credentialOwnerUserId
      } else if (oauth) {
        const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
        if (!auth.success || !auth.userId) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        authUserId = auth.userId
      }
      return handleMarketProviderRequest({
        body: marketBody,
        providerId,
        requestId,
        startTime,
        authUserId,
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
