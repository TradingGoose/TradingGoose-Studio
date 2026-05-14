import { type NextRequest, NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { refreshAccessTokenIfNeeded } from '@/lib/oauth/tokens'

type OAuthRouteCredentialInput = {
  credentialId?: unknown
  workflowId?: unknown
  workspaceId?: unknown
}

type OAuthRouteCredentialResult =
  | {
      ok: true
      accessToken: string
      credentialId: string
    }
  | {
      ok: false
      response: NextResponse
    }

function credentialAuthStatus(error?: string) {
  if (!error || error === 'Authentication required') return 401
  if (error === 'Credential not found' || error === 'Workflow not found') return 404
  return 403
}

export async function resolveOAuthRouteCredential(
  request: NextRequest,
  input: OAuthRouteCredentialInput,
  requestId: string
): Promise<OAuthRouteCredentialResult> {
  const credentialId = typeof input.credentialId === 'string' ? input.credentialId.trim() : ''
  const workflowId =
    typeof input.workflowId === 'string' && input.workflowId.trim()
      ? input.workflowId.trim()
      : undefined
  const workspaceId =
    typeof input.workspaceId === 'string' && input.workspaceId.trim()
      ? input.workspaceId.trim()
      : undefined

  if (!credentialId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Credential ID is required' }, { status: 400 }),
    }
  }

  const authz = await authorizeCredentialUse(request, {
    credentialId,
    workflowId,
    workspaceId,
  })

  if (!authz.ok || !authz.credentialOwnerUserId || !authz.resolvedTokenAccountId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: authz.error || 'Unauthorized' },
        { status: credentialAuthStatus(authz.error) }
      ),
    }
  }

  const accessToken = await refreshAccessTokenIfNeeded(
    authz.resolvedTokenAccountId,
    authz.credentialOwnerUserId,
    requestId
  )

  if (!accessToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'OAuth token unavailable. Reconnect the credential.' },
        { status: 401 }
      ),
    }
  }

  return { ok: true, accessToken, credentialId }
}
