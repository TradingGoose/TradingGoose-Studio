import { type NextRequest, NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { createLogger } from '@/lib/logs/console/logger'
import { getOAuthTokenAccount, refreshTokenIfNeeded } from '@/lib/oauth/tokens'
import { getTrelloApiKey } from '@/lib/trello/auth'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('OAuthTokenAPI')

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  logger.info(`[${requestId}] OAuth token API POST request received`)

  try {
    const body = await request.json()
    const credentialId = typeof body.credentialId === 'string' ? body.credentialId.trim() : ''
    const workflowId = typeof body.workflowId === 'string' ? body.workflowId.trim() : undefined
    const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId.trim() : undefined

    if (!credentialId) {
      logger.warn(`[${requestId}] Credential ID is required`)
      return NextResponse.json({ error: 'Credential ID is required' }, { status: 400 })
    }

    const authz = await authorizeCredentialUse(request, {
      credentialId,
      workflowId,
      workspaceId,
    })
    if (!authz.ok || !authz.credentialOwnerUserId) {
      const status = authz.error === 'Credential not found' ? 404 : 403
      return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status })
    }

    const tokenAccountId = authz.resolvedTokenAccountId
    if (!tokenAccountId) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    const tokenAccount = await getOAuthTokenAccount(
      requestId,
      tokenAccountId,
      authz.credentialOwnerUserId
    )
    if (!tokenAccount) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    try {
      const { accessToken } = await refreshTokenIfNeeded(requestId, tokenAccount, tokenAccountId)
      const apiKey = tokenAccount.providerId === 'trello' ? await getTrelloApiKey() : undefined
      return NextResponse.json(
        {
          accessToken,
          idToken: tokenAccount.idToken || undefined,
          apiKey,
          providerId: tokenAccount.providerId,
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
