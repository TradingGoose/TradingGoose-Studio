import { db, workflow, workflowDeploymentVersion } from '@tradinggoose/db'
import { and, desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { resolveApiKeyForDeployment, updateApiKeyLastUsed } from '@/lib/api-key/service'
import {
  hasChatTriggerBlocks,
  removePublishedChatsForWorkflowTx,
} from '@/lib/chat/published-deployment'
import { NativeTargetError } from '@/lib/copilot/native/errors'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { deployWorkflow, requireWorkflowRealtimeState } from '@/lib/workflows/db-helpers'
import { hasWorkflowChanged, validateWorkflowPermissions } from '@/lib/workflows/utils'
import { notifyMonitorsReconcile } from '@/app/api/monitors/reconcile'
import { pauseMonitorsMissingDeployedTrigger } from '@/app/api/monitors/shared'
import {
  createErrorResponse,
  createSuccessResponse,
  createWorkflowRealtimeRequiredResponse,
} from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowDeployAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    logger.debug(`[${requestId}] Fetching deployment info for workflow: ${id}`)

    const {
      error,
      session,
      workflow: workflowData,
    } = await validateWorkflowPermissions(id, requestId, 'read')
    if (error) {
      return createErrorResponse(error.message, error.status)
    }
    const actorUserId = session?.user?.id
    if (!actorUserId) return createErrorResponse('Unauthorized', 401)

    if (!workflowData.isDeployed) {
      logger.info(`[${requestId}] Workflow is not deployed: ${id}`)
      return createSuccessResponse({
        isDeployed: false,
        deployedAt: null,
        apiKey: null,
        pinnedApiKeyId: null,
        needsRedeployment: false,
        hasReusableApiKey: false,
      })
    }

    const keyInfo = await resolveApiKeyForDeployment(
      workflowData.pinnedApiKeyId,
      actorUserId,
      workflowData.workspaceId
    )

    let needsRedeployment = false
    const [active] = await db
      .select({ state: workflowDeploymentVersion.state })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, id),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .orderBy(desc(workflowDeploymentVersion.createdAt))
      .limit(1)

    if (active?.state) {
      const currentState = await requireWorkflowRealtimeState(id)
      if (currentState) {
        needsRedeployment = hasWorkflowChanged(currentState, active.state as any)
      }
    }

    logger.info(`[${requestId}] Successfully retrieved deployment info: ${id}`)

    return createSuccessResponse({
      apiKey: keyInfo ? `${keyInfo.name} (${keyInfo.type})` : null,
      pinnedApiKeyId: workflowData.pinnedApiKeyId,
      isDeployed: workflowData.isDeployed,
      deployedAt: workflowData.deployedAt,
      needsRedeployment,
      hasReusableApiKey: Boolean(keyInfo),
    })
  } catch (error: any) {
    if (error instanceof NativeTargetError) return createErrorResponse(error.message, error.status)
    logger.error(`[${requestId}] Error fetching deployment info: ${id}`, error)
    const realtimeResponse = createWorkflowRealtimeRequiredResponse(error)
    if (realtimeResponse) return realtimeResponse
    return createErrorResponse(error.message || 'Failed to fetch deployment information', 500)
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    logger.debug(`[${requestId}] Deploying workflow: ${id}`)

    const {
      error,
      session,
      workflow: workflowData,
    } = await validateWorkflowPermissions(id, requestId, 'admin')
    if (error) {
      return createErrorResponse(error.message, error.status)
    }

    let nativeContext: unknown
    let providedApiKey: string | null = null
    try {
      const parsed = await request.json()
      nativeContext = parsed?.native
      if (parsed && typeof parsed.apiKey === 'string' && parsed.apiKey.trim().length > 0) {
        providedApiKey = parsed.apiKey.trim()
      }
    } catch (_err) {}

    const actorUserId = session?.user?.id
    if (!actorUserId) return createErrorResponse('Unauthorized', 401)

    const matchedKey = await resolveApiKeyForDeployment(
      providedApiKey || workflowData!.pinnedApiKeyId,
      actorUserId,
      workflowData!.workspaceId
    )
    if (!matchedKey) {
      return NextResponse.json(
        { error: 'Select a valid API key before deploying.', needsApiKey: true },
        { status: 400 }
      )
    }

    if (nativeContext !== undefined) {
      const { authorizeNativeWorkflowDeploymentEffect } = await import(
        '@/lib/copilot/native/workflow-effects'
      )
      await authorizeNativeWorkflowDeploymentEffect(
        actorUserId,
        id,
        nativeContext,
        'deploy',
        request.signal
      )
    }
    const deployResult = await deployWorkflow({
      workflowId: id,
      deployedBy: actorUserId,
      pinnedApiKeyId: matchedKey.id,
      includeDeployedState: true,
      workflowName: workflowData!.name,
      workflowOwnerId: workflowData!.userId,
      previousDeployedState: workflowData!.deployedState,
    })

    if (!deployResult.success) {
      const errorMessage = deployResult.error || 'Failed to deploy workflow'
      const status = errorMessage.includes('identifier') ? 400 : 500
      return createErrorResponse(errorMessage, status)
    }

    const deployedAt = deployResult.deployedAt!

    await updateApiKeyLastUsed(matchedKey.id)

    logger.info(`[${requestId}] Workflow deployed successfully: ${id}`)

    await pauseMonitorsMissingDeployedTrigger(id)
    await notifyMonitorsReconcile({ requestId, logger })

    return createSuccessResponse({
      apiKey: `${matchedKey.name} (${matchedKey.type})`,
      isDeployed: true,
      deployedAt,
    })
  } catch (error: any) {
    if (error instanceof NativeTargetError) return createErrorResponse(error.message, error.status)
    logger.error(`[${requestId}] Error deploying workflow: ${id}`, {
      error: error.message,
      stack: error.stack,
      name: error.name,
      cause: error.cause,
      fullError: error,
    })
    const realtimeResponse = createWorkflowRealtimeRequiredResponse(error)
    if (realtimeResponse) return realtimeResponse
    return createErrorResponse(error.message || 'Failed to deploy workflow', 500)
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    logger.debug(`[${requestId}] Undeploying workflow: ${id}`)

    const {
      error,
      session,
      workflow: workflowData,
    } = await validateWorkflowPermissions(id, requestId, 'admin')
    if (error) {
      return createErrorResponse(error.message, error.status)
    }

    const raw = await request.text()
    const nativeContext: unknown = raw ? JSON.parse(raw)?.native : undefined
    if (nativeContext !== undefined) {
      if (!session?.user?.id) return createErrorResponse('Unauthorized', 401)
      const { authorizeNativeWorkflowDeploymentEffect } = await import(
        '@/lib/copilot/native/workflow-effects'
      )
      await authorizeNativeWorkflowDeploymentEffect(
        session.user.id,
        id,
        nativeContext,
        'undeploy',
        request.signal
      )
    }
    await db.transaction(async (tx) => {
      if (hasChatTriggerBlocks(workflowData?.deployedState)) {
        await removePublishedChatsForWorkflowTx(tx, id)
      }

      await tx
        .update(workflowDeploymentVersion)
        .set({ isActive: false })
        .where(eq(workflowDeploymentVersion.workflowId, id))

      await tx
        .update(workflow)
        .set({ isDeployed: false, deployedAt: null, deployedState: null, pinnedApiKeyId: null })
        .where(eq(workflow.id, id))
    })

    logger.info(`[${requestId}] Workflow undeployed successfully: ${id}`)

    await notifyMonitorsReconcile({ requestId, logger })

    // Track workflow undeployment
    try {
      const { trackPlatformEvent } = await import('@/lib/telemetry/tracer')
      trackPlatformEvent('platform.workflow.undeployed', {
        'workflow.id': id,
      })
    } catch (_e) {
      // Silently fail
    }

    return createSuccessResponse({
      isDeployed: false,
      deployedAt: null,
      apiKey: null,
    })
  } catch (error: any) {
    if (error instanceof NativeTargetError) return createErrorResponse(error.message, error.status)
    logger.error(`[${requestId}] Error undeploying workflow: ${id}`, error)
    return createErrorResponse(error.message || 'Failed to undeploy workflow', 500)
  }
}
