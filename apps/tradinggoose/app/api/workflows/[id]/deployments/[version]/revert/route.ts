import { db, workflow, workflowDeploymentVersion } from '@tradinggoose/db'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import {
  ensureUniqueBlockIds,
  ensureUniqueEdgeIds,
  saveWorkflowToNormalizedTables,
} from '@/lib/workflows/db-helpers'
import { validateWorkflowPermissions } from '@/lib/workflows/utils'
import { applyWorkflowState } from '@/lib/yjs/server/apply-workflow-state'
import { createWorkflowSnapshot } from '@/lib/yjs/workflow-session'
import { notifyMonitorsReconcile } from '@/app/api/monitors/reconcile'
import { pauseMonitorsMissingDeployedTrigger } from '@/app/api/monitors/shared'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('RevertToDeploymentVersionAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; version: string }> }
) {
  const requestId = generateRequestId()
  const { id, version } = await params

  try {
    const { error } = await validateWorkflowPermissions(id, requestId, 'admin')
    if (error) {
      return createErrorResponse(error.message, error.status)
    }

    const versionSelector = version === 'active' ? null : Number(version)
    if (version !== 'active' && !Number.isFinite(versionSelector)) {
      return createErrorResponse('Invalid version', 400)
    }

    let stateRow: { state: any } | null = null
    if (version === 'active') {
      const [row] = await db
        .select({ state: workflowDeploymentVersion.state })
        .from(workflowDeploymentVersion)
        .where(
          and(
            eq(workflowDeploymentVersion.workflowId, id),
            eq(workflowDeploymentVersion.isActive, true)
          )
        )
        .limit(1)
      stateRow = row || null
    } else {
      const [row] = await db
        .select({ state: workflowDeploymentVersion.state })
        .from(workflowDeploymentVersion)
        .where(
          and(
            eq(workflowDeploymentVersion.workflowId, id),
            eq(workflowDeploymentVersion.version, versionSelector as number)
          )
        )
        .limit(1)
      stateRow = row || null
    }

    if (!stateRow?.state) {
      return createErrorResponse('Deployment version not found', 404)
    }

    const deployedState = stateRow.state
    if (!deployedState.blocks || !deployedState.edges) {
      return createErrorResponse('Invalid deployed state structure', 500)
    }

    const now = new Date()
    const revertVariables = deployedState.variables || undefined

    const revertedState = {
      blocks: deployedState.blocks,
      edges: deployedState.edges,
      loops: deployedState.loops || {},
      parallels: deployedState.parallels || {},
      lastSaved: Date.now(),
      isDeployed: true,
      deployedAt: new Date(),
    }

    const stateWithUniqueBlockIds = await ensureUniqueBlockIds(id, revertedState)
    const persistedRevertedState = await ensureUniqueEdgeIds(id, stateWithUniqueBlockIds)
    const revertSnapshot = createWorkflowSnapshot({
      blocks: persistedRevertedState.blocks,
      edges: persistedRevertedState.edges,
      loops: persistedRevertedState.loops,
      parallels: persistedRevertedState.parallels,
      lastSaved: now.toISOString(),
      isDeployed: true,
      deployedAt: now.toISOString(),
    })

    await applyWorkflowState(id, revertSnapshot, revertVariables)

    const saveResult = await saveWorkflowToNormalizedTables(id, persistedRevertedState)
    if (!saveResult.success) {
      return createErrorResponse(saveResult.error || 'Failed to materialize deployed state', 500)
    }

    await db
      .update(workflow)
      .set({
        lastSynced: now,
        updatedAt: now,
        ...(revertVariables ? { variables: revertVariables } : {}),
      })
      .where(eq(workflow.id, id))

    await pauseMonitorsMissingDeployedTrigger(id)
    await notifyMonitorsReconcile({ requestId, logger })

    return createSuccessResponse({
      message: 'Reverted to deployment version',
      lastSaved: Date.now(),
    })
  } catch (error: any) {
    logger.error('Error reverting to deployment version', error)
    return createErrorResponse(error.message || 'Failed to revert', 500)
  }
}
