import { db, workflowDeploymentVersion } from '@tradinggoose/db'
import { and, desc, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { loadWorkflowStateWithFallback } from '@/lib/workflows/db-helpers'
import { hasWorkflowChanged } from '@/lib/workflows/utils'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowStatusAPI')

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()

  try {
    const { id } = await params

    const validation = await validateWorkflowAccess(request, id, false)
    if (validation.error) {
      logger.warn(`[${requestId}] Workflow access validation failed: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    // Check if the workflow has meaningful changes that would require redeployment
    let needsRedeployment = false

    if (validation.workflow.isDeployed) {
      // Load current state (Yjs-first, fall back to normalized tables) and
      // the active deployment version in parallel.
      const [currentState, [active]] = await Promise.all([
        loadWorkflowStateWithFallback(id),
        db
          .select({ state: workflowDeploymentVersion.state })
          .from(workflowDeploymentVersion)
          .where(
            and(
              eq(workflowDeploymentVersion.workflowId, id),
              eq(workflowDeploymentVersion.isActive, true)
            )
          )
          .orderBy(desc(workflowDeploymentVersion.createdAt))
          .limit(1),
      ])

      if (!currentState) {
        return createErrorResponse('Failed to load workflow state', 500)
      }

      if (active?.state) {
        needsRedeployment = hasWorkflowChanged(currentState as any, active.state as any)
      }
    }

    return createSuccessResponse({
      isDeployed: validation.workflow.isDeployed,
      deployedAt: validation.workflow.deployedAt,
      isPublished: validation.workflow.isPublished,
      needsRedeployment,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error getting status for workflow: ${(await params).id}`, error)
    return createErrorResponse('Failed to get status', 500)
  }
}
