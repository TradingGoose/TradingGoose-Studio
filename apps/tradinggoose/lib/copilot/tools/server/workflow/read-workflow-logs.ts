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
    const workflowId = requireCopilotEntityId(rawArgs, { toolName: CopilotTool.read_workflow_logs })
    const userId = requireUserId(context)

    logger.info('Reading workflow logs', { workflowId, limit })

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
            eq(workflowExecutionLogs.workflowId, workflowId),
            sql`${workflowExecutionLogs.workflowSummary}->>'id' = ${workflowId}`
          ),
          workspaceAccess.accessFilter,
          apiKeyAccess
        )
      )
      .orderBy(desc(workflowExecutionLogs.startedAt))
      .limit(limit)

    const formattedEntries: Record<string, unknown>[] = []
    let resultBytes = 2
    for (const log of executionLogs) {
      const entry = projectExecutionLogContext(log, 'implicit').value
      const entryBytes = Buffer.byteLength(JSON.stringify(entry), 'utf8')
      const separatorBytes = formattedEntries.length > 0 ? 1 : 0
      if (resultBytes + separatorBytes + entryBytes > MAX_COPILOT_CONTEXT_BYTES_PER_TURN) break
      resultBytes += separatorBytes + entryBytes
      formattedEntries.push(entry)
    }

    logger.info('Workflow logs result prepared', {
      entryCount: formattedEntries.length,
      resultSizeKB: Math.round(resultBytes / 1024),
      resultTruncated: formattedEntries.length < executionLogs.length,
    })

    return {
      entries: formattedEntries,
      totalEntries: formattedEntries.length,
      workflowId,
      retrievedAt: new Date().toISOString(),
      truncated: formattedEntries.length < executionLogs.length,
    }
  },
}
