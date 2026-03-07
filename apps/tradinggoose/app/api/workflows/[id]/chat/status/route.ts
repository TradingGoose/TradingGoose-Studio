import { db } from '@tradinggoose/db'
import { chat, workflowDeploymentVersion } from '@tradinggoose/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('ChatStatusAPI')

/**
 * GET endpoint to check if a workflow has an active chat deployment
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const requestId = generateRequestId()

  try {
    logger.debug(`[${requestId}] Checking chat deployment status for workflow: ${id}`)

    const [activeDeployment] = await db
      .select({ id: workflowDeploymentVersion.id })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, id),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .orderBy(desc(workflowDeploymentVersion.createdAt))
      .limit(1)

    if (!activeDeployment) {
      return createSuccessResponse({
        isDeployed: false,
        deployment: null,
      })
    }

    const deploymentResults = await db
      .select({
        id: chat.id,
        identifier: chat.identifier,
        isActive: chat.isActive,
      })
      .from(chat)
      .where(
        and(
          eq(chat.workflowId, id),
          eq(chat.deploymentVersionId, activeDeployment.id),
          eq(chat.isActive, true)
        )
      )
      .limit(1)

    const legacyDeploymentResults =
      deploymentResults.length > 0
        ? deploymentResults
        : await db
            .select({
              id: chat.id,
              identifier: chat.identifier,
              isActive: chat.isActive,
            })
            .from(chat)
            .where(and(eq(chat.workflowId, id), eq(chat.isActive, true)))
            .limit(1)

    const isDeployed = legacyDeploymentResults.length > 0
    const deploymentInfo =
      legacyDeploymentResults.length > 0
        ? {
            id: legacyDeploymentResults[0].id,
            identifier: legacyDeploymentResults[0].identifier,
          }
        : null

    return createSuccessResponse({
      isDeployed,
      deployment: deploymentInfo,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error checking chat deployment status:`, error)
    return createErrorResponse(error.message || 'Failed to check chat deployment status', 500)
  }
}
