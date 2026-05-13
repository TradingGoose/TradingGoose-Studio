import { db } from '@tradinggoose/db'
import { workflow } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { listOAuthCredentialsForUser } from '@/lib/credentials/oauth'
import { createLogger } from '@/lib/logs/console/logger'
import type { OAuthService } from '@/lib/oauth'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('OAuthCredentialsAPI')

async function resolveWorkflowWorkspaceId(workflowId: string, requesterUserId: string) {
  const [wf] = await db
    .select({ workspaceId: workflow.workspaceId })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)

  if (!wf?.workspaceId) {
    return { error: NextResponse.json({ error: 'Workflow not found' }, { status: 404 }) }
  }

  const access = await checkWorkspaceAccess(wf.workspaceId, requesterUserId)
  if (!access.hasAccess) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { workspaceId: wf.workspaceId }
}

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const { searchParams } = new URL(request.url)
    const providerParam = searchParams.get('provider') as OAuthService | null
    const workflowId = searchParams.get('workflowId')?.trim()
    const workspaceId = searchParams.get('workspaceId')?.trim()
    const credentialId = searchParams.get('credentialId')?.trim()

    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthenticated credentials request rejected`)
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    const requesterUserId = authResult.userId
    let effectiveWorkspaceId = workspaceId || undefined
    if (workflowId) {
      const workflowScope = await resolveWorkflowWorkspaceId(workflowId, requesterUserId)
      if (workflowScope.error) return workflowScope.error
      effectiveWorkspaceId = workflowScope.workspaceId
    } else if (effectiveWorkspaceId) {
      const access = await checkWorkspaceAccess(effectiveWorkspaceId, requesterUserId)
      if (!access.hasAccess) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    if (!providerParam && !credentialId) {
      logger.warn(`[${requestId}] Missing provider parameter`)
      return NextResponse.json({ error: 'Provider or credentialId is required' }, { status: 400 })
    }

    const credentials = await listOAuthCredentialsForUser({
      userId: requesterUserId,
      workspaceId: effectiveWorkspaceId,
      providerIds: providerParam ? [providerParam] : undefined,
      credentialId: credentialId || undefined,
    })

    return NextResponse.json({ credentials }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching OAuth credentials`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
