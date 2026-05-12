import { type NextRequest, NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { getCredential, getOAuthToken, refreshTokenIfNeeded } from '@/lib/oauth/tokens'
import { getTrelloApiKey } from '@/lib/trello/auth'
import { generateRequestId } from '@/lib/utils'
import { isTradingProviderOAuthServiceId } from '@/providers/trading/providers'

export const dynamic = 'force-dynamic'

const logger = createLogger('OAuthTokenAPI')

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  logger.info(`[${requestId}] OAuth token API POST request received`)

  try {
    const body = await request.json()
    const credentialId = typeof body.credentialId === 'string' ? body.credentialId.trim() : ''
    const serviceId = typeof body.serviceId === 'string' ? body.serviceId.trim() : ''
    const workflowId = typeof body.workflowId === 'string' ? body.workflowId.trim() : undefined

    if (!credentialId && !serviceId) {
      logger.warn(`[${requestId}] Credential ID or service ID is required`)
      return NextResponse.json(
        { error: 'Credential ID or service ID is required' },
        { status: 400 }
      )
    }

    if (serviceId && !credentialId) {
      if (isTradingProviderOAuthServiceId(serviceId)) {
        return NextResponse.json(
          { error: 'credentialId is required for trading provider tokens' },
          { status: 400 }
        )
      }

      const auth = await checkHybridAuth(request, { requireWorkflowId: false })
      if (!auth.success) {
        return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 403 })
      }

      if (!auth.userId) {
        return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
      }

      const accessToken = await getOAuthToken(auth.userId, serviceId)
      if (!accessToken) {
        return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
      }

      return NextResponse.json({ accessToken, providerId: serviceId }, { status: 200 })
    }

    const authz = await authorizeCredentialUse(request, {
      credentialId,
      workflowId,
    })
    if (!authz.ok || !authz.credentialOwnerUserId) {
      const status = authz.error === 'Credential not found' ? 404 : 403
      return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status })
    }

    const credential = await getCredential(requestId, credentialId, authz.credentialOwnerUserId)
    if (!credential) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    try {
      const { accessToken } = await refreshTokenIfNeeded(requestId, credential, credentialId)
      const apiKey = credential.providerId === 'trello' ? await getTrelloApiKey() : undefined
      return NextResponse.json(
        {
          accessToken,
          idToken: credential.idToken || undefined,
          apiKey,
          providerId: credential.providerId,
        },
        { status: 200 }
      )
    } catch (error) {
      logger.error(`[${requestId}] Failed to refresh access token:`, error)
      return NextResponse.json({ error: 'Failed to refresh access token' }, { status: 401 })
    }
  } catch (error) {
    logger.error(`[${requestId}] Error getting access token`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
