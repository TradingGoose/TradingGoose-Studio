import { db } from '@tradinggoose/db'
import { workflowExecutionLogs, workflowExecutionSnapshots } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { loadDeployedWorkflowState } from '@/lib/workflows/db-helpers'

const logger = createLogger('LogsByExecutionIdAPI')

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  try {
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

    // Get the workflow state snapshot
    const [snapshot] = await db
      .select()
      .from(workflowExecutionSnapshots)
      .where(eq(workflowExecutionSnapshots.id, workflowLog.stateSnapshotId))
      .limit(1)

    if (!snapshot) {
      return NextResponse.json({ error: 'Workflow state snapshot not found' }, { status: 404 })
    }

    let workflowState = snapshot.stateData
    const snapshotBlockCount = Object.keys((workflowState as any)?.blocks || {}).length

    if (snapshotBlockCount === 0) {
      try {
        const deployedData = await loadDeployedWorkflowState(workflowLog.workflowId)
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
      workflowId: workflowLog.workflowId,
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
