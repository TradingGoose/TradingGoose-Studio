import { db } from '@tradinggoose/db'
import { credential, workflow } from '@tradinggoose/db/schema'
import { eq, isNotNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuthType, checkHybridAuth } from '@/lib/auth/hybrid'
import { listOAuthConnectionsForUser, listOAuthCredentialsForUser } from '@/lib/credentials/oauth'
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

  return { workspaceId: wf.workspaceId, canWrite: access.canWrite }
}

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const { searchParams } = new URL(request.url)
    const providerParam = searchParams.get('provider') as OAuthService | null
    const workflowId = searchParams.get('workflowId')?.trim()
    const workspaceId = searchParams.get('workspaceId')?.trim()
    const credentialId = searchParams.get('credentialId')?.trim()

    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthenticated credentials request rejected`)
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    const requesterUserId = authResult.userId
    const apiKeyWorkspaceId =
      authResult.authType === AuthType.API_KEY ? authResult.workspaceId : undefined
    let effectiveWorkspaceId = apiKeyWorkspaceId ?? workspaceId ?? undefined
    if (workflowId) {
      const workflowScope = await resolveWorkflowWorkspaceId(workflowId, requesterUserId)
      if (workflowScope.error) return workflowScope.error
      if (apiKeyWorkspaceId && workflowScope.workspaceId !== apiKeyWorkspaceId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      effectiveWorkspaceId = workflowScope.workspaceId
    } else if (effectiveWorkspaceId && !apiKeyWorkspaceId) {
      const access = await checkWorkspaceAccess(effectiveWorkspaceId, requesterUserId)
      if (!access.hasAccess) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }
    if (!effectiveWorkspaceId) {
      return NextResponse.json({ error: 'Credential scope is required' }, { status: 400 })
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

    const connections =
      providerParam && authResult.authType === AuthType.SESSION
        ? await listOAuthConnectionsForUser({
            userId: requesterUserId,
            providerIds: [providerParam],
          })
        : []
    return NextResponse.json({
      credentials,
      connections: connections.filter(
        (connection) => !credentials.some((entry) => entry.accountId === connection.id)
      ),
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching OAuth credentials`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId || auth.authType !== AuthType.SESSION) {
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }
    const parsed = z
      .object({ workflowId: z.string().trim().min(1), accountId: z.string().trim().min(1) })
      .safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Workflow and connection are required' }, { status: 400 })
    }
    const scope = await resolveWorkflowWorkspaceId(parsed.data.workflowId, auth.userId)
    if (scope.error) return scope.error
    if (!scope.canWrite) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const connection = (await listOAuthConnectionsForUser({ userId: auth.userId })).find(
      (entry) => entry.id === parsed.data.accountId
    )
    if (!connection) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }
    const [saved] = await db
      .insert(credential)
      .values({
        id: crypto.randomUUID(),
        workspaceId: scope.workspaceId,
        type: 'oauth',
        providerId: connection.provider,
        displayName: connection.name,
        accountId: connection.id,
        createdBy: auth.userId,
      })
      .onConflictDoUpdate({
        target: [credential.workspaceId, credential.accountId],
        targetWhere: isNotNull(credential.accountId),
        set: { displayName: connection.name },
      })
      .returning({ id: credential.id })
    return NextResponse.json({ credentialId: saved.id })
  } catch (error) {
    logger.error('Error saving OAuth credential', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
