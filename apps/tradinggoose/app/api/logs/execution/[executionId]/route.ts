import { db } from '@tradinggoose/db'
import {
  permissions,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
} from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { loadDeployedWorkflowState } from '@/lib/workflows/db-helpers'

const logger = createLogger('LogsByExecutionIdAPI')

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const { executionId } = await params

    logger.debug(`Fetching execution data for: ${executionId}`)

    // Get the workflow execution log to find the snapshot
    const [workflowLog] = await db
      .select()
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, executionId))
      .limit(1)

    if (!workflowLog) {
      return NextResponse.json({ error: 'Workflow execution not found' }, { status: 404 })
    }

    const [permission] = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workflowLog.workspaceId),
          eq(permissions.userId, userId)
        )
      )
      .limit(1)

    if (!permission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get the workflow state snapshot
    const [snapshot] = await db
      .select()
      .from(workflowExecutionSnapshots)
      .where(
        and(
          eq(workflowExecutionSnapshots.id, workflowLog.stateSnapshotId),
          eq(workflowExecutionSnapshots.workspaceId, workflowLog.workspaceId)
        )
      )
      .limit(1)

    if (!snapshot) {
      return NextResponse.json({ error: 'Workflow state snapshot not found' }, { status: 404 })
    }

    let workflowState = snapshot.stateData
    const snapshotBlockCount = Object.keys((workflowState as any)?.blocks || {}).length
    const workflowSummary =
      workflowLog.workflowSummary && typeof workflowLog.workflowSummary === 'object'
        ? (workflowLog.workflowSummary as { id?: string })
        : null
    const workflowId = workflowLog.workflowId ?? workflowSummary?.id ?? null

    if (snapshotBlockCount === 0 && workflowId) {
      try {
        const deployedData = await loadDeployedWorkflowState(workflowId)
        if (Object.keys(deployedData.blocks || {}).length > 0) {
          workflowState = {
            blocks: deployedData.blocks || {},
            edges: deployedData.edges || [],
            loops: deployedData.loops || {},
            parallels: deployedData.parallels || {},
          }
          logger.warn(
            `Snapshot for execution ${executionId} had no blocks, using deployed state fallback`
          )
        }
      } catch (fallbackError) {
        logger.warn(
          `Failed deployed-state fallback for execution ${executionId}; using stored snapshot`,
          fallbackError
        )
      }
    }

    const response = {
      workflowId,
      workflowState,
    }

    logger.debug(`Successfully fetched execution data for: ${executionId}`)
    logger.debug(
      `Workflow state contains ${Object.keys((workflowState as any)?.blocks || {}).length} blocks`
    )

    return NextResponse.json(response)
  } catch (error) {
    logger.error('Error fetching execution data:', error)
    return NextResponse.json({ error: 'Failed to fetch execution data' }, { status: 500 })
  }
}
