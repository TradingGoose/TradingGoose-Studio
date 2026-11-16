import { type NextRequest, NextResponse } from 'next/server'
import { authorizeCredentialUse, credentialAuthStatus } from '@/lib/auth/credential-access'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { authorizeWorkflowScope } from '@/lib/auth/workflow-scope'
import { createLogger } from '@/lib/logs/console/logger'
import { getFailureAccounting, safeInferenceError } from '@/lib/mastra/errors'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
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

type ProviderRouteBody = AIProviderRouteBody | MarketProviderRouteBody

/**
 * Server-side proxy for provider requests
 */
export async function POST(request: NextRequest) {
  const requestId = generateRequestId()
  const startTime = Date.now()

  let requestApiKey: string | undefined
  try {
    logger.info(`[${requestId}] Provider API request started`, {
      timestamp: new Date().toISOString(),
      userAgent: request.headers.get('User-Agent'),
      contentType: request.headers.get('Content-Type'),
    })

    const body = (await request.json()) as ProviderRouteBody
    const namespace = body.providerNamespace
    if (namespace !== 'ai' && namespace !== 'market')
      return NextResponse.json({ error: 'A valid providerNamespace is required' }, { status: 400 })
    if (namespace === 'ai') {
      const aiBody = body as AIProviderRouteBody
      requestApiKey = aiBody.apiKey
      const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const scope: Pick<AIProviderRouteBody, 'workflowId' | 'workspaceId'> = {}
      let executionId: string | undefined
      const query = new URL(request.url).searchParams
      for (const field of ['workflowId', 'workspaceId'] as const) {
        const values = query.getAll(field)
        const value = aiBody[field]
        if (
          (Object.hasOwn(aiBody, field) && (typeof value !== 'string' || !value.trim())) ||
          values.length > 1 ||
          (values.length === 1 && !values[0].trim()) ||
          (typeof value === 'string' && values.length === 1 && value.trim() !== values[0].trim())
        )
          return NextResponse.json({ error: `Invalid or conflicting ${field}` }, { status: 400 })
        scope[field] = typeof value === 'string' ? value.trim() : values[0]?.trim()
      }
      if (scope.workflowId) {
        const owner = await authorizeWorkflowScope(auth, scope.workflowId, 'read')
        if (!owner.ok) return NextResponse.json({ error: owner.error }, { status: owner.status })
        if (scope.workspaceId && scope.workspaceId !== owner.workspaceId)
          return NextResponse.json(
            { error: 'Workspace scope differs from the workflow' },
            { status: 403 }
          )
        scope.workspaceId = owner.workspaceId
        executionId = owner.executionId
      } else if (
        scope.workspaceId &&
        !(await checkWorkspaceAccess(scope.workspaceId, auth.userId)).hasAccess
      ) {
        return NextResponse.json({ error: 'Workspace access denied' }, { status: 403 })
      }
      return await handleAIProviderRequest({
        body: { ...aiBody, ...scope },
        requestId,
        authUserId: auth.userId,
        executionId,
        signal: request.signal,
      })
    }

    const marketBody = body as MarketProviderRouteBody
    const providerId = marketBody.provider
    if (!providerId)
      return NextResponse.json({ error: 'Provider identifier is required' }, { status: 400 })
    const oauth = getMarketProviderDefinition(providerId.split('/')[0])?.oauth
    const searchParams = new URL(request.url).searchParams
    const workflowId = searchParams.get('workflowId')?.trim()
    const workspaceId =
      (typeof marketBody.workspaceId === 'string' && marketBody.workspaceId.trim()) ||
      searchParams.get('workspaceId')?.trim() ||
      undefined
    let authUserId: string | undefined
    if (oauth) {
      const credentialId = marketBody.providerParams?.credentialId
      if (typeof credentialId !== 'string' || !credentialId.trim()) {
        return NextResponse.json({ error: 'Credential ID is required' }, { status: 400 })
      }
      const authz = await authorizeCredentialUse(request, {
        credentialId: credentialId.trim(),
        workflowId,
        workspaceId,
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
    }
    return handleMarketProviderRequest({
      body: marketBody,
      providerId,
      requestId,
      startTime,
      authUserId,
    })
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
      { error: safeInferenceError(error, requestApiKey), ...getFailureAccounting(error) },
      {
        status: [400, 403].includes((error as { status?: number })?.status ?? 0)
          ? (error as { status: number }).status
          : 500,
      }
    )
  }
}
