import { runs, schedules } from '@trigger.dev/sdk'
import {
  listDueWorkflowExecutionDeadlines,
  reconcileWorkflowExecutionDeadline,
  refreshWorkflowExecutionAttemptParticipant,
} from '@/lib/execution/workflow-execution-deadline-repository'
import {
  listOpenWorkflowExecutionAttempts,
  listWorkflowExecutionsAwaitingTermination,
  recordWorkflowAttemptTerminalObservation,
  recordWorkflowInfrastructureCandidate,
} from '@/lib/execution/workflow-execution-lifecycle-repository'
import {
  claimWorkflowExecutionOutbox,
  dispatchWorkflowExecutionOutbox,
  failWorkflowExecutionOutbox,
} from '@/lib/execution/workflow-execution-outbox'
import { reconcileWorkflowTermination } from './workflow-execution-termination-reconcile'

export const workflowExecutionSweep = schedules.task({
  id: 'workflow-execution-sweep',
  cron: '* * * * *',
  run: async () => {
    let inspectedAttempts = 0
    let attemptCursor: string | undefined
    for (;;) {
      const attempts = await listOpenWorkflowExecutionAttempts(100, attemptCursor)
      for (const attempt of attempts) {
        inspectedAttempts++
        if (!attempt.drainRunId) continue
        try {
          const run = await runs.retrieve(attempt.drainRunId)
          if (
            ['FAILED', 'CRASHED', 'SYSTEM_FAILURE', 'EXPIRED', 'TIMED_OUT'].includes(run.status) &&
            run.finishedAt
          ) {
            await recordWorkflowInfrastructureCandidate({
              attemptId: attempt.id,
              rootExecutionId: attempt.rootExecutionId,
              failedAt: run.finishedAt,
              diagnostics: { triggerRunId: run.id, status: run.status },
            })
            await recordWorkflowAttemptTerminalObservation({
              attemptId: attempt.id,
              rootExecutionId: attempt.rootExecutionId,
              state: 'failed',
              finishedAt: run.finishedAt,
            })
          } else if (['COMPLETED', 'CANCELED'].includes(run.status) && run.finishedAt) {
            await recordWorkflowAttemptTerminalObservation({
              attemptId: attempt.id,
              rootExecutionId: attempt.rootExecutionId,
              state: run.status === 'COMPLETED' ? 'completed' : 'canceled',
              finishedAt: run.finishedAt,
            })
          } else if (!['COMPLETED', 'CANCELED'].includes(run.status)) {
            await refreshWorkflowExecutionAttemptParticipant(attempt.id)
          }
        } catch {
          // One unavailable Trigger snapshot must not starve later attempts.
        }
      }
      if (attempts.length < 100) break
      attemptCursor = attempts.at(-1)?.id
    }
    let reconciled = 0
    let rootCursor: string | undefined
    for (;;) {
      const roots = await listWorkflowExecutionsAwaitingTermination(100, rootCursor)
      for (const { rootExecutionId } of roots) {
        await reconcileWorkflowTermination(rootExecutionId)
        reconciled++
      }
      if (roots.length < 100) break
      rootCursor = roots.at(-1)?.rootExecutionId
    }
    const dueDeadlines = await listDueWorkflowExecutionDeadlines()
    for (const { rootExecutionId } of dueDeadlines) {
      await reconcileWorkflowExecutionDeadline(rootExecutionId)
    }
    const projections = await claimWorkflowExecutionOutbox()
    for (const projection of projections) {
      try {
        await dispatchWorkflowExecutionOutbox(projection)
      } catch (error) {
        await failWorkflowExecutionOutbox({
          ...projection,
          error: error instanceof Error ? error.message : 'Workflow projection failed',
        })
      }
    }
    return {
      inspectedAttempts,
      reconciled,
      reconciledDeadlines: dueDeadlines.length,
      projected: projections.length,
    }
  },
})
