import { apiKey, db, workflow, workflowDeploymentVersion } from '@tradinggoose/db'
import { and, desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  hasChatTriggerBlocks,
  removePublishedChatsForWorkflowTx,
} from '@/lib/chat/published-deployment'
import { createLogger } from '@/lib/logs/console/logger'
import { isTriggerExecutionEnabled } from '@/lib/trigger/settings'
import { generateRequestId } from '@/lib/utils'
import { deployWorkflow, loadWorkflowStateWithFallback } from '@/lib/workflows/db-helpers'
import { hasWorkflowChanged, validateWorkflowPermissions } from '@/lib/workflows/utils'
import { notifyIndicatorMonitorsReconcile } from '@/app/api/indicator-monitors/reconcile'
import { pauseMonitorsMissingDeployedIndicatorTrigger } from '@/app/api/indicator-monitors/shared'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowDeployAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    logger.debug(`[${requestId}] Fetching deployment info for workflow: ${id}`)

    const { error, workflow: workflowData } = await validateWorkflowPermissions(
      id,
      requestId,
      'read'
    )
    if (error) {
      return createErrorResponse(error.message, error.status)
    }

    const asyncExecutionEnabled = await isTriggerExecutionEnabled()

    if (!workflowData.isDeployed) {
      logger.info(`[${requestId}] Workflow is not deployed: ${id}`)
      return createSuccessResponse({
        isDeployed: false,
        deployedAt: null,
        apiKey: null,
        pinnedApiKeyId: null,
        needsRedeployment: false,
        hasReusableApiKey: false,
        asyncExecutionEnabled,
      })
    }

    let keyInfo: { name: string; type: 'personal' | 'workspace' } | null = null
    let hasReusableApiKey = false

    if (workflowData.pinnedApiKeyId) {
      const pinnedKey = await db
        .select({
          key: apiKey.key,
          name: apiKey.name,
          type: apiKey.type,
          expiresAt: apiKey.expiresAt,
        })
        .from(apiKey)
        .where(eq(apiKey.id, workflowData.pinnedApiKeyId))
        .limit(1)

      if (
        pinnedKey.length > 0 &&
        (!pinnedKey[0].expiresAt || pinnedKey[0].expiresAt >= new Date())
      ) {
        keyInfo = { name: pinnedKey[0].name, type: pinnedKey[0].type as 'personal' | 'workspace' }
        hasReusableApiKey = true
      }
    } else {
      const userApiKey = await db
        .select({
          key: apiKey.key,
          name: apiKey.name,
          type: apiKey.type,
        })
        .from(apiKey)
        .where(and(eq(apiKey.userId, workflowData.userId), eq(apiKey.type, 'personal')))
        .orderBy(desc(apiKey.lastUsed), desc(apiKey.createdAt))
        .limit(1)

      if (userApiKey.length > 0) {
        keyInfo = { name: userApiKey[0].name, type: userApiKey[0].type as 'personal' | 'workspace' }
      }
    }

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
      const currentState = await loadWorkflowStateWithFallback(id, workflowData.lastSynced)
      if (currentState) {
        needsRedeployment = hasWorkflowChanged(currentState, active.state as any)
      }
    }

    logger.info(`[${requestId}] Successfully retrieved deployment info: ${id}`)

    const responseApiKeyInfo = keyInfo ? `${keyInfo.name} (${keyInfo.type})` : 'No API key found'

    return createSuccessResponse({
      apiKey: responseApiKeyInfo,
      pinnedApiKeyId: workflowData.pinnedApiKeyId,
      isDeployed: workflowData.isDeployed,
      deployedAt: workflowData.deployedAt,
      needsRedeployment,
      hasReusableApiKey,
      asyncExecutionEnabled,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching deployment info: ${id}`, error)
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

    const userId = workflowData!.userId

    let providedApiKey: string | null = null
    try {
      const parsed = await request.json()
      if (parsed && typeof parsed.apiKey === 'string' && parsed.apiKey.trim().length > 0) {
        providedApiKey = parsed.apiKey.trim()
      }
    } catch (_err) {}

    logger.debug(`[${requestId}] Validating API key for deployment`)

    let keyInfo: { name: string; type: 'personal' | 'workspace' } | null = null
    let matchedKey: {
      id: string
      key: string
      name: string
      type: 'personal' | 'workspace'
    } | null = null

    // Use provided API key, or fall back to existing pinned API key for redeployment
    const apiKeyToUse = providedApiKey || workflowData!.pinnedApiKeyId

    if (!apiKeyToUse) {
      return NextResponse.json(
        { error: 'API key is required. Please create or select an API key before deploying.' },
        { status: 400 }
      )
    }

    let isValidKey = false

    const currentUserId = session?.user?.id

    if (currentUserId) {
      const [personalKey] = await db
        .select({
          id: apiKey.id,
          key: apiKey.key,
          name: apiKey.name,
          expiresAt: apiKey.expiresAt,
        })
        .from(apiKey)
        .where(
          and(
            eq(apiKey.id, apiKeyToUse),
            eq(apiKey.userId, currentUserId),
            eq(apiKey.type, 'personal')
          )
        )
        .limit(1)

      if (personalKey) {
        if (!personalKey.expiresAt || personalKey.expiresAt >= new Date()) {
          matchedKey = { ...personalKey, type: 'personal' }
          isValidKey = true
          keyInfo = { name: personalKey.name, type: 'personal' }
        }
      }
    }

    if (!isValidKey) {
      if (workflowData!.workspaceId) {
        const [workspaceKey] = await db
          .select({
            id: apiKey.id,
            key: apiKey.key,
            name: apiKey.name,
            expiresAt: apiKey.expiresAt,
          })
          .from(apiKey)
          .where(
            and(
              eq(apiKey.id, apiKeyToUse),
              eq(apiKey.workspaceId, workflowData!.workspaceId),
              eq(apiKey.type, 'workspace')
            )
          )
          .limit(1)

        if (workspaceKey) {
          if (!workspaceKey.expiresAt || workspaceKey.expiresAt >= new Date()) {
            matchedKey = { ...workspaceKey, type: 'workspace' }
            isValidKey = true
            keyInfo = { name: workspaceKey.name, type: 'workspace' }
          }
        }
      }
    }

    if (!isValidKey) {
      logger.warn(`[${requestId}] Invalid API key ID provided for workflow deployment: ${id}`)
      return createErrorResponse('Invalid API key provided', 400)
    }

    // Attribution: this route is UI-only; require session user as actor
    const actorUserId: string | null = session?.user?.id ?? null
    if (!actorUserId) {
      logger.warn(`[${requestId}] Unable to resolve actor user for workflow deployment: ${id}`)
      return createErrorResponse('Unable to determine deploying user', 400)
    }

    const deployResult = await deployWorkflow({
      workflowId: id,
      deployedBy: actorUserId,
      pinnedApiKeyId: matchedKey?.id,
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

    if (matchedKey) {
      try {
        await db
          .update(apiKey)
          .set({ lastUsed: new Date(), updatedAt: new Date() })
          .where(eq(apiKey.id, matchedKey.id))
      } catch (e) {
        logger.warn(`[${requestId}] Failed to update lastUsed for api key`)
      }
    }

    logger.info(`[${requestId}] Workflow deployed successfully: ${id}`)

    await pauseMonitorsMissingDeployedIndicatorTrigger(id)
    await notifyIndicatorMonitorsReconcile({ requestId, logger })

    const responseApiKeyInfo = keyInfo ? `${keyInfo.name} (${keyInfo.type})` : 'Default key'

    return createSuccessResponse({
      apiKey: responseApiKeyInfo,
      isDeployed: true,
      deployedAt,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error deploying workflow: ${id}`, {
      error: error.message,
      stack: error.stack,
      name: error.name,
      cause: error.cause,
      fullError: error,
    })
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

    const { error, workflow: workflowData } = await validateWorkflowPermissions(
      id,
      requestId,
      'admin'
    )
    if (error) {
      return createErrorResponse(error.message, error.status)
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

    await notifyIndicatorMonitorsReconcile({ requestId, logger })

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
    logger.error(`[${requestId}] Error undeploying workflow: ${id}`, error)
    return createErrorResponse(error.message || 'Failed to undeploy workflow', 500)
  }
}
