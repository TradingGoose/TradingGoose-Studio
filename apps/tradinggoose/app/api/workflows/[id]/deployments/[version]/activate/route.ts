import { db, workflow, workflowDeploymentVersion } from '@tradinggoose/db'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { resolveApiKeyForDeployment } from '@/lib/api-key/service'
import { reconcilePublishedChatsForDeploymentTx } from '@/lib/chat/published-deployment'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { validateWorkflowPermissions } from '@/lib/workflows/utils'
import { notifyMonitorsReconcile } from '@/app/api/monitors/reconcile'
import { pauseMonitorsMissingDeployedTrigger } from '@/app/api/monitors/shared'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowActivateDeploymentAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; version: string }> }
) {
  const requestId = generateRequestId()
  const { id, version } = await params

  try {
    const {
      error,
      session,
      workflow: workflowData,
    } = await validateWorkflowPermissions(id, requestId, 'admin')
    if (error) {
      return createErrorResponse(error.message, error.status)
    }
    const actorUserId = session?.user?.id
    if (!actorUserId) return createErrorResponse('Unauthorized', 401)

    const versionNum = Number(version)
    if (!Number.isFinite(versionNum)) {
      return createErrorResponse('Invalid version', 400)
    }

    let providedApiKey: string | null = null
    try {
      const parsed = await request.json()
      if (parsed && typeof parsed.apiKey === 'string' && parsed.apiKey.trim().length > 0) {
        providedApiKey = parsed.apiKey.trim()
      }
    } catch (_err) {}

    const matchedKey = await resolveApiKeyForDeployment(
      providedApiKey || workflowData!.pinnedApiKeyId,
      actorUserId,
      workflowData!.workspaceId
    )
    if (!matchedKey) return createErrorResponse('Select a valid API key before deploying.', 400)

    const now = new Date()

    await db.transaction(async (tx) => {
      await tx
        .update(workflowDeploymentVersion)
        .set({ isActive: false })
        .where(
          and(
            eq(workflowDeploymentVersion.workflowId, id),
            eq(workflowDeploymentVersion.isActive, true)
          )
        )

      const updated = await tx
        .update(workflowDeploymentVersion)
        .set({ isActive: true })
        .where(
          and(
            eq(workflowDeploymentVersion.workflowId, id),
            eq(workflowDeploymentVersion.version, versionNum)
          )
        )
        .returning({
          id: workflowDeploymentVersion.id,
          state: workflowDeploymentVersion.state,
        })

      if (updated.length === 0) {
        throw new Error('Deployment version not found')
      }

      await tx
        .update(workflow)
        .set({
          isDeployed: true,
          deployedAt: now,
          deployedState: updated[0].state,
          pinnedApiKeyId: matchedKey.id,
        })
        .where(eq(workflow.id, id))

      await reconcilePublishedChatsForDeploymentTx({
        tx,
        workflowId: id,
        workflowOwnerId: workflowData!.userId,
        deploymentVersionId: updated[0].id,
        state: updated[0].state as any,
        previousState: workflowData!.deployedState,
      })
    })

    await pauseMonitorsMissingDeployedTrigger(id)
    await notifyMonitorsReconcile({ requestId, logger })

    return createSuccessResponse({ success: true, deployedAt: now })
  } catch (error: any) {
    logger.error(`[${requestId}] Error activating deployment for workflow: ${id}`, error)
    const errorMessage = error.message || 'Failed to activate deployment'
    const status = errorMessage.includes('identifier') ? 400 : 500
    return createErrorResponse(errorMessage, status)
  }
}
