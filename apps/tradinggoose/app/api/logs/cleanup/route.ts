import { db, orderHistoryTable } from '@tradinggoose/db'
import {
  workflowExecutionLogs,
  workflowLogWebhookDelivery,
  workspace,
} from '@tradinggoose/db/schema'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { isBillingEnabledForRuntime } from '@/lib/billing/settings'
import { getTierLogRetentionDays } from '@/lib/billing/tiers'
import { resolveWorkspaceBillingContext } from '@/lib/billing/workspace-billing'
import { createLogger } from '@/lib/logs/console/logger'
import { snapshotService } from '@/lib/logs/execution/snapshot/service'
import { isUsingCloudStorage, StorageService } from '@/lib/uploads'

export const dynamic = 'force-dynamic'

const logger = createLogger('LogsCleanupAPI')

const BATCH_SIZE = 2000

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
        archived: 0,
        archiveFailed: 0,
        deleted: 0,
        deleteFailed: 0,
      },
      files: {
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
              lt(workflowExecutionLogs.createdAt, retentionDate),
              sql`NOT EXISTS (
                SELECT 1 FROM ${workflowLogWebhookDelivery}
                WHERE ${workflowLogWebhookDelivery.executionId} = ${workflowExecutionLogs.executionId}
                AND ${workflowLogWebhookDelivery.status} IN ('pending', 'in_progress')
              )`,
              sql`NOT EXISTS (
                SELECT 1 FROM ${orderHistoryTable}
                WHERE ${orderHistoryTable.workflowLogId} = ${workflowExecutionLogs.id}
              )`
            )
          )
          .limit(BATCH_SIZE)

        results.enhancedLogs.total += oldEnhancedLogs.length

        for (const log of oldEnhancedLogs) {
          const today = new Date().toISOString().split('T')[0]

          const enhancedLogKey = `archived-enhanced-logs/${today}/${log.id}.json`
          const enhancedLogData = JSON.stringify({
            ...log,
            archivedAt: new Date().toISOString(),
            logType: 'enhanced',
          })

          try {
            await StorageService.uploadFile({
              file: Buffer.from(enhancedLogData),
              fileName: enhancedLogKey,
              contentType: 'application/json',
              context: 'general',
              metadata: {
                logId: String(log.id),
                workflowId: String(log.workflowId),
                executionId: String(log.executionId),
                logType: 'enhanced',
                archivedAt: new Date().toISOString(),
              },
            })

            results.enhancedLogs.archived++

            if (isUsingCloudStorage() && log.files && Array.isArray(log.files)) {
              for (const file of log.files) {
                if (file && typeof file === 'object' && file.key) {
                  results.files.total++
                  try {
                    await StorageService.deleteFile({
                      key: file.key,
                      context: 'general',
                    })
                    results.files.deleted++
                    logger.info(`Deleted file: ${file.key}`)
                  } catch (fileError) {
                    results.files.deleteFailed++
                    logger.error(`Failed to delete file ${file.key}:`, { fileError })
                  }
                }
              }
            }

            try {
              const deleteResult = await db
                .delete(workflowExecutionLogs)
                .where(eq(workflowExecutionLogs.id, log.id))
                .returning({ id: workflowExecutionLogs.id })

              if (deleteResult.length > 0) {
                results.enhancedLogs.deleted++
              } else {
                results.enhancedLogs.deleteFailed++
                logger.warn(
                  `Failed to delete enhanced log ${log.id} after archiving: No rows deleted`
                )
              }
            } catch (deleteError) {
              results.enhancedLogs.deleteFailed++
              logger.error(`Error deleting enhanced log ${log.id} after archiving:`, {
                deleteError,
              })
            }
          } catch (archiveError) {
            results.enhancedLogs.archiveFailed++
            logger.error(`Failed to archive enhanced log ${log.id}:`, { archiveError })
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
      message: `Processed ${batchesProcessed} enhanced log batches (${results.enhancedLogs.total} logs, ${results.files.total} files) in ${timeElapsed.toFixed(2)}s${reachedLimit ? ' (batch limit reached)' : ''}`,
      results,
      complete: !hasMoreLogs,
      batchLimitReached: reachedLimit,
    })
  } catch (error) {
    logger.error('Error in log cleanup process:', { error })
    return NextResponse.json({ error: 'Failed to process log cleanup' }, { status: 500 })
  }
}
