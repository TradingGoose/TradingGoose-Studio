import { db } from '@tradinggoose/db'
import {
  pendingExecution,
  workflowExecutionLogs,
  workflowExecutionOutbox,
  workflowExecutionTerminal,
} from '@tradinggoose/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { createWorkflowExecutionEventWriter } from '@/lib/execution/workflow-execution-events'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { createWorkflowExecutionTerminalEventInput } from '@/lib/workflows/execution-events'
import type { ExecutionResult } from '@/executor/types'
import { wakePendingExecutionDrain } from './pending-execution-drain-wake'

export type WorkflowExecutionProjectionKind =
  | 'workflow_log'
  | 'terminal_event'
  | 'pending_execution'

export async function projectWorkflowExecutionTerminal(
  rootExecutionId: string,
  resultVersion?: number,
  kind: WorkflowExecutionProjectionKind = 'pending_execution'
): Promise<boolean> {
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select ${workflowExecutionTerminal.rootExecutionId}
          from ${workflowExecutionTerminal}
          where ${workflowExecutionTerminal.rootExecutionId} = ${rootExecutionId}
          for update`
    )
    const [terminal] = await tx
      .select({
        state: workflowExecutionTerminal.state,
        result: workflowExecutionTerminal.result,
        resultVersion: workflowExecutionTerminal.resultVersion,
        workflowId: workflowExecutionTerminal.workflowId,
        workspaceId: workflowExecutionTerminal.workspaceId,
        actorUserId: workflowExecutionTerminal.actorUserId,
      })
      .from(workflowExecutionTerminal)
      .where(eq(workflowExecutionTerminal.rootExecutionId, rootExecutionId))
      .limit(1)

    // Retention won the shared terminal lock. A stale projector must not recreate state.
    if (!terminal) return { projected: true, billingScopeId: null }
    if (
      terminal.state !== 'terminal' ||
      !terminal.result ||
      (resultVersion !== undefined && terminal.resultVersion !== resultVersion)
    ) {
      return { projected: false, billingScopeId: null }
    }
    const result = terminal.result as ExecutionResult

    if (kind === 'workflow_log' && terminal.workflowId && terminal.workspaceId) {
      const [log] = await tx
        .select({
          id: workflowExecutionLogs.id,
          executionData: workflowExecutionLogs.executionData,
          endedAt: workflowExecutionLogs.endedAt,
        })
        .from(workflowExecutionLogs)
        .where(eq(workflowExecutionLogs.executionId, rootExecutionId))
        .limit(1)
      if (log && !log.endedAt) {
        const { traceSpans, totalDuration } = buildTraceSpans(result)
        const executionData =
          log.executionData && typeof log.executionData === 'object'
            ? (log.executionData as Record<string, unknown>)
            : {}
        await tx
          .update(workflowExecutionLogs)
          .set({
            level: result.success ? 'info' : 'error',
            endedAt: sql`clock_timestamp()`,
            totalDurationMs: totalDuration || result.metadata?.duration || 0,
            executionData: {
              ...executionData,
              traceSpans,
              finalOutput: result.output ?? {},
              ...(result.error ? { errorMessage: result.error } : {}),
              canonicalResult: result,
            },
          })
          .where(
            and(eq(workflowExecutionLogs.id, log.id), sql`${workflowExecutionLogs.endedAt} is null`)
          )
      }
    }

    if (kind === 'terminal_event' && terminal.workflowId) {
      const writer = await createWorkflowExecutionEventWriter({
        pendingExecutionId: rootExecutionId,
        workflowId: terminal.workflowId,
      })
      await writer.write(createWorkflowExecutionTerminalEventInput(result), {
        idempotencyKey: `terminal:${terminal.resultVersion}`,
      })
    }

    if (kind === 'pending_execution') {
      const prerequisites = await tx.execute<{ completed_count: number }>(sql`
        select count(*)::integer as completed_count
        from ${workflowExecutionOutbox}
        where ${workflowExecutionOutbox.rootExecutionId} = ${rootExecutionId}
          and ${workflowExecutionOutbox.version} = ${terminal.resultVersion}
          and ${workflowExecutionOutbox.kind} in ('workflow_log', 'terminal_event')
          and ${workflowExecutionOutbox.state} = 'completed'
      `)
      if (prerequisites[0]?.completed_count !== 2) {
        return { projected: false, billingScopeId: null }
      }
      const [deleted] = await tx
        .delete(pendingExecution)
        .where(eq(pendingExecution.id, rootExecutionId))
        .returning({ billingScopeId: pendingExecution.billingScopeId })
      return {
        projected: true,
        billingScopeId: deleted?.billingScopeId ?? null,
        terminal,
        result,
      }
    }

    return { projected: true, billingScopeId: null, terminal, result }
  })

  if (!outcome.projected || !('terminal' in outcome) || !outcome.terminal) {
    return outcome.projected
  }
  if (outcome.billingScopeId) {
    await wakePendingExecutionDrain({ billingScopeId: outcome.billingScopeId })
  }
  return outcome.projected
}

export async function projectChildWorkflowExecution(params: {
  rootExecutionId: string
  pendingExecutionId: string
  attemptId: string
  result: ExecutionResult
}): Promise<boolean> {
  const billingScopeId = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select ${workflowExecutionTerminal.rootExecutionId}
          from ${workflowExecutionTerminal}
          where ${workflowExecutionTerminal.rootExecutionId} = ${params.rootExecutionId}
          for update`
    )
    const [root] = await tx
      .select({
        id: workflowExecutionTerminal.rootExecutionId,
        state: workflowExecutionTerminal.state,
        result: workflowExecutionTerminal.result,
      })
      .from(workflowExecutionTerminal)
      .where(eq(workflowExecutionTerminal.rootExecutionId, params.rootExecutionId))
      .limit(1)
    if (!root) return null
    if (root.state === 'termination_pending' && !root.result) return undefined
    const result =
      root.state === 'terminal' && root.result ? (root.result as ExecutionResult) : params.result
    await tx
      .update(workflowExecutionLogs)
      .set({
        level: result.success ? 'info' : 'error',
        endedAt: sql`coalesce(${workflowExecutionLogs.endedAt}, clock_timestamp())`,
        executionData: sql`coalesce(${workflowExecutionLogs.executionData}, '{}'::jsonb)
          || jsonb_build_object('canonicalResult', ${result}::jsonb)`,
      })
      .where(eq(workflowExecutionLogs.executionId, params.pendingExecutionId))
    const [deleted] = await tx
      .delete(pendingExecution)
      .where(
        and(
          eq(pendingExecution.id, params.pendingExecutionId),
          eq(pendingExecution.status, 'processing')
        )
      )
      .returning({ billingScopeId: pendingExecution.billingScopeId })
    return deleted?.billingScopeId ?? null
  })
  if (billingScopeId === undefined) return false
  if (billingScopeId) await wakePendingExecutionDrain({ billingScopeId })
  return true
}
