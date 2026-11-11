import { db, orderHistoryTable } from '@tradinggoose/db'
import {
  workflowExecutionLogs,
  workflowLogWebhookDelivery,
  workspace,
} from '@tradinggoose/db/schema'
import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { isBillingEnabledForRuntime } from '@/lib/billing/settings'
import { getTierLogRetentionDays } from '@/lib/billing/tiers'
import { resolveWorkspaceBillingContext } from '@/lib/billing/workspace-billing'
import { createLogger } from '@/lib/logs/console/logger'
import { snapshotService } from '@/lib/logs/execution/snapshot/service'
import { deleteAgentHistory } from '@/lib/mastra/agent-history'

export const dynamic = 'force-dynamic'

const logger = createLogger('LogsCleanupAPI')

const BATCH_SIZE = 2000
const completedLogReadyForRetention = and(
  isNotNull(workflowExecutionLogs.endedAt),
  sql`NOT EXISTS (
    SELECT 1 FROM ${workflowExecutionLogs} AS retention_parent
    WHERE retention_parent.execution_id = ${workflowExecutionLogs.executionData}->'trigger'->'data'->'queuedExecution'->>'parentExecutionId'
    AND retention_parent.ended_at IS NULL
    AND ${workflowExecutionLogs.executionData}->'trigger'->'data'->'queuedExecution'->>'source' = 'workflow_block'
  )`
)

function parseLogRetentionDays(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }

  return null
}

async function getWorkspaceRetentionGroups(): Promise<
  Array<{ retentionDays: number; workspaceIds: string[] }>
> {
  const workspaceRows = await db
    .select({
      id: workspace.id,
      ownerId: workspace.ownerId,
    })
    .from(workspace)

  const workspaceIdsByRetentionDays = new Map<number, string[]>()
  const billingContextByScopeKey = new Map<
    string,
    Promise<Awaited<ReturnType<typeof resolveWorkspaceBillingContext>>>
  >()

  for (const workspaceRow of workspaceRows) {
    const scopeKey = `workspace:${workspaceRow.id}`

    let billingContextPromise = billingContextByScopeKey.get(scopeKey)
    if (!billingContextPromise) {
      billingContextPromise = resolveWorkspaceBillingContext({
        workspaceId: workspaceRow.id,
        actorUserId: workspaceRow.ownerId,
      })
      billingContextByScopeKey.set(scopeKey, billingContextPromise)
    }

    try {
      const billingContext = await billingContextPromise
      const retentionDays = parseLogRetentionDays(getTierLogRetentionDays(billingContext.tier))
      if (retentionDays === null) {
        continue
      }

      const workspaceIds = workspaceIdsByRetentionDays.get(retentionDays) ?? []
      workspaceIds.push(workspaceRow.id)
      workspaceIdsByRetentionDays.set(retentionDays, workspaceIds)
    } catch (error) {
      logger.error('Failed to resolve workspace billing context for log cleanup', {
        workspaceId: workspaceRow.id,
        ownerId: workspaceRow.ownerId,
        error,
      })
    }
  }

  const workspaceGroups = Array.from(workspaceIdsByRetentionDays.entries()).map(
    ([retentionDays, workspaceIds]) => ({
      retentionDays,
      workspaceIds,
    })
  )

  return workspaceGroups.filter((workspaceGroup) => workspaceGroup.workspaceIds.length > 0)
}

export async function GET(request: NextRequest) {
  try {
    const authError = verifyCronAuth(request, 'logs cleanup')
    if (authError) {
      return authError
    }

    if (!(await isBillingEnabledForRuntime())) {
      logger.info('Skipping log cleanup because billing is disabled')
      return NextResponse.json({ message: 'Billing disabled, skipping cleanup' })
    }

    const workspaceGroups = await getWorkspaceRetentionGroups()

    if (workspaceGroups.length === 0) {
      logger.info('No workspaces found for finite log retention cleanup')
      return NextResponse.json({ message: 'No workspaces found for cleanup' })
    }

    const results = {
      enhancedLogs: {
        total: 0,
        deleted: 0,
        deleteFailed: 0,
      },
      snapshots: {
        cleaned: 0,
        cleanupFailed: 0,
      },
    }

    const startTime = Date.now()
    const MAX_BATCHES = 10

    let batchesProcessed = 0
    let hasMoreLogs = false

    logger.info('Starting enhanced logs cleanup', {
      workspaceGroupCount: workspaceGroups.length,
      workspaceCount: workspaceGroups.reduce(
        (totalWorkspaceCount, workspaceGroup) =>
          totalWorkspaceCount + workspaceGroup.workspaceIds.length,
        0
      ),
    })

    for (const workspaceGroup of workspaceGroups) {
      if (batchesProcessed >= MAX_BATCHES) {
        break
      }

      const retentionDate = new Date()
      retentionDate.setDate(retentionDate.getDate() - workspaceGroup.retentionDays)
      let groupHasMoreLogs = true

      while (groupHasMoreLogs && batchesProcessed < MAX_BATCHES) {
        const oldEnhancedLogs = await db
          .select({
            id: workflowExecutionLogs.id,
            workspaceId: workflowExecutionLogs.workspaceId,
            workflowId: workflowExecutionLogs.workflowId,
            executionId: workflowExecutionLogs.executionId,
            stateSnapshotId: workflowExecutionLogs.stateSnapshotId,
            level: workflowExecutionLogs.level,
            trigger: workflowExecutionLogs.trigger,
            startedAt: workflowExecutionLogs.startedAt,
            endedAt: workflowExecutionLogs.endedAt,
            totalDurationMs: workflowExecutionLogs.totalDurationMs,
            executionData: workflowExecutionLogs.executionData,
            cost: workflowExecutionLogs.cost,
            files: workflowExecutionLogs.files,
            createdAt: workflowExecutionLogs.createdAt,
          })
          .from(workflowExecutionLogs)
          .where(
            and(
              inArray(workflowExecutionLogs.workspaceId, workspaceGroup.workspaceIds),
              completedLogReadyForRetention,
              lt(workflowExecutionLogs.createdAt, retentionDate),
              sql`NOT EXISTS (
                SELECT 1 FROM ${workflowLogWebhookDelivery}
                WHERE ${workflowLogWebhookDelivery.executionId} = ${workflowExecutionLogs.executionId}
                AND ${workflowLogWebhookDelivery.status} IN ('pending', 'in_progress')
              )`,
              sql`NOT EXISTS (
                SELECT 1 FROM ${orderHistoryTable}
                WHERE ${orderHistoryTable.logId} = ${workflowExecutionLogs.id}
              )`
            )
          )
          .limit(BATCH_SIZE)

        results.enhancedLogs.total += oldEnhancedLogs.length

        for (const log of oldEnhancedLogs) {
          try {
            const deleted = await db
              .delete(workflowExecutionLogs)
              .where(and(eq(workflowExecutionLogs.id, log.id), completedLogReadyForRetention))
              .returning({ id: workflowExecutionLogs.id })
            if (!deleted.length) continue
            results.enhancedLogs.deleted++
            await deleteAgentHistory(log)
          } catch (error) {
            results.enhancedLogs.deleteFailed++
            logger.error(`Failed to clean up execution ${log.id}`, { error })
          }
        }

        batchesProcessed++
        groupHasMoreLogs = oldEnhancedLogs.length === BATCH_SIZE
        hasMoreLogs = hasMoreLogs || groupHasMoreLogs

        logger.info(
          `Processed enhanced logs batch ${batchesProcessed}: ${oldEnhancedLogs.length} logs`,
          {
            retentionDays: workspaceGroup.retentionDays,
          }
        )
      }
    }

    try {
      const snapshotRetentionDays =
        Math.min(...workspaceGroups.map((workspaceGroup) => workspaceGroup.retentionDays)) + 1
      const cleanedSnapshots = await snapshotService.cleanupOrphanedSnapshots(snapshotRetentionDays)
      results.snapshots.cleaned = cleanedSnapshots
      logger.info(`Cleaned up ${cleanedSnapshots} orphaned snapshots`)
    } catch (snapshotError) {
      results.snapshots.cleanupFailed = 1
      logger.error('Error cleaning up orphaned snapshots:', { snapshotError })
    }

    const timeElapsed = (Date.now() - startTime) / 1000
    const reachedLimit = batchesProcessed >= MAX_BATCHES && hasMoreLogs

    return NextResponse.json({
      message: `Processed ${batchesProcessed} enhanced log batches (${results.enhancedLogs.total} logs) in ${timeElapsed.toFixed(2)}s${reachedLimit ? ' (batch limit reached)' : ''}`,
      results,
      complete: !hasMoreLogs,
      batchLimitReached: reachedLimit,
    })
  } catch (error) {
    logger.error('Error in log cleanup process:', { error })
    return NextResponse.json({ error: 'Failed to process log cleanup' }, { status: 500 })
  }
}
