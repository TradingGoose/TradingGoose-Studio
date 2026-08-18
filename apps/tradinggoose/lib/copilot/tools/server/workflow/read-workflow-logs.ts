import { db } from '@tradinggoose/db'
import { permissions, workflowExecutionLogs, workspace } from '@tradinggoose/db/schema'
import { and, desc, eq, or, sql } from 'drizzle-orm'
import {
  MAX_COPILOT_CONTEXT_BYTES_PER_TURN,
  MAX_WORKFLOW_LOGS_PER_READ,
} from '@/lib/copilot/context-limits'
import { projectExecutionLogContext } from '@/lib/copilot/execution-log-context'
import { CopilotTool } from '@/lib/copilot/registry'
import { requireCopilotEntityId } from '@/lib/copilot/tools/entity-target'
import type {
  BaseServerTool,
  ServerToolExecutionContext,
} from '@/lib/copilot/tools/server/base-tool'
import { requireUserId } from '@/lib/copilot/tools/server/entities/shared'
import { createLogger } from '@/lib/logs/console/logger'
import { buildWorkspaceAccessScope } from '@/lib/permissions/utils'

interface ReadWorkflowLogsArgs {
  entityId: string
  limit?: number
}

const DEFAULT_WORKFLOW_LOG_LIMIT = 3

const clampWorkflowLogLimit = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_WORKFLOW_LOG_LIMIT
  return Math.min(MAX_WORKFLOW_LOGS_PER_READ, Math.max(1, Math.trunc(value)))
}

export const readWorkflowLogsServerTool: BaseServerTool<ReadWorkflowLogsArgs, any> = {
  name: CopilotTool.read_workflow_logs,
  async execute(rawArgs: ReadWorkflowLogsArgs, context?: ServerToolExecutionContext): Promise<any> {
    const logger = createLogger('ReadWorkflowLogsServerTool')
    const limit = clampWorkflowLogLimit(rawArgs?.limit)
    const entityId = requireCopilotEntityId(rawArgs, { toolName: CopilotTool.read_workflow_logs })
    const userId = requireUserId(context)

    logger.info('Reading workflow logs', { entityId, limit })

    const workspaceAccess = buildWorkspaceAccessScope(userId, workflowExecutionLogs.workspaceId)
    const apiKeyAccess =
      context?.apiKeyType === 'personal' ? eq(workspace.allowPersonalApiKeys, true) : undefined
    const executionLogs = await db
      .select({
        id: workflowExecutionLogs.id,
        workflowId: workflowExecutionLogs.workflowId,
        workflowSummary: workflowExecutionLogs.workflowSummary,
        executionId: workflowExecutionLogs.executionId,
        level: workflowExecutionLogs.level,
        trigger: workflowExecutionLogs.trigger,
        startedAt: workflowExecutionLogs.startedAt,
        endedAt: workflowExecutionLogs.endedAt,
        totalDurationMs: workflowExecutionLogs.totalDurationMs,
        executionData: workflowExecutionLogs.executionData,
        cost: workflowExecutionLogs.cost,
      })
      .from(workflowExecutionLogs)
      .innerJoin(workspace, workspaceAccess.workspaceJoin)
      .leftJoin(permissions, workspaceAccess.permissionJoin)
      .where(
        and(
          or(
            eq(workflowExecutionLogs.id, entityId),
            eq(workflowExecutionLogs.workflowId, entityId),
            sql`${workflowExecutionLogs.workflowSummary}->>'id' = ${entityId}`
          ),
          workspaceAccess.accessFilter,
          apiKeyAccess
        )
      )
      .orderBy(
        desc(sql`CASE WHEN ${workflowExecutionLogs.id} = ${entityId} THEN 1 ELSE 0 END`),
        desc(workflowExecutionLogs.startedAt)
      )
      .limit(limit + 1)

    const exactLog = executionLogs.find((log) => log.id === entityId)
    const hasMoreLogs = !exactLog && executionLogs.length > limit
    const targetLogs = exactLog ? [exactLog] : executionLogs.slice(0, limit)
    const formattedEntries: Record<string, unknown>[] = []
    let resultBytes = 2
    for (const log of targetLogs) {
      const entry = projectExecutionLogContext(log, exactLog ? 'explicit' : 'implicit').value
      const entryBytes = Buffer.byteLength(JSON.stringify(entry), 'utf8')
      const separatorBytes = formattedEntries.length > 0 ? 1 : 0
      if (resultBytes + separatorBytes + entryBytes > MAX_COPILOT_CONTEXT_BYTES_PER_TURN) break
      resultBytes += separatorBytes + entryBytes
      formattedEntries.push(entry)
    }

    const truncated = hasMoreLogs || formattedEntries.length < targetLogs.length
    logger.info('Workflow logs result prepared', {
      entryCount: formattedEntries.length,
      resultSizeKB: Math.round(resultBytes / 1024),
      resultTruncated: truncated,
    })

    return {
      entries: formattedEntries,
      totalEntries: formattedEntries.length,
      entityId,
      retrievedAt: new Date().toISOString(),
      truncated,
    }
  },
}
