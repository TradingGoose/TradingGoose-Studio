import { GoogleGenAI } from '@google/genai'
import { runs, task } from '@trigger.dev/sdk'
import { refreshWorkflowExecutionAttemptParticipant } from '@/lib/execution/workflow-execution-deadline-repository'
import {
  claimWorkflowOperationsForTermination,
  getWorkflowExecutionProjection,
  listOpenWorkflowExecutionAttemptsForRoot,
  reconcileWorkflowDeadlineTermination,
  recordWorkflowAttemptTerminalObservation,
  recordWorkflowInfrastructureCandidate,
  recordWorkflowOperationObservation,
  scheduleWorkflowTerminationReconcile,
} from '@/lib/execution/workflow-execution-lifecycle-repository'
import {
  completeWorkflowExecutionOutbox,
  failWorkflowExecutionOutbox,
  type WorkflowExecutionOutboxClaim,
} from '@/lib/execution/workflow-execution-outbox'
import { cancelPendingWorkflowExecution } from '@/lib/workflows/queued-execution-cancellation'

export async function reconcileWorkflowTermination(rootExecutionId: string) {
  const terminal = await getWorkflowExecutionProjection(rootExecutionId)
  const attempts = await listOpenWorkflowExecutionAttemptsForRoot(rootExecutionId)
  for (const attempt of attempts) {
    if (!attempt.drainRunId) continue
    try {
      const run = await runs.retrieve(attempt.drainRunId)
      if (
        ['FAILED', 'CRASHED', 'SYSTEM_FAILURE', 'EXPIRED', 'TIMED_OUT'].includes(run.status) &&
        run.finishedAt
      ) {
        await recordWorkflowInfrastructureCandidate({
          attemptId: attempt.id,
          rootExecutionId,
          failedAt: run.finishedAt,
          diagnostics: { triggerRunId: run.id, status: run.status },
        })
      } else if (['COMPLETED', 'CANCELED'].includes(run.status) && run.finishedAt) {
        await recordWorkflowAttemptTerminalObservation({
          attemptId: attempt.id,
          rootExecutionId,
          state: run.status === 'COMPLETED' ? 'completed' : 'canceled',
          finishedAt: run.finishedAt,
        })
      } else if (!['COMPLETED', 'CANCELED'].includes(run.status)) {
        await refreshWorkflowExecutionAttemptParticipant(attempt.id)
      }
    } catch {
      // An unavailable Trigger snapshot is unresolved, not terminal.
    }
  }
  const operations = await claimWorkflowOperationsForTermination(rootExecutionId)
  for (const operation of operations) {
    if (operation.adapterKind === 'gemini_interaction_status' && operation.remoteOperationId) {
      const observation =
        operation.observation && typeof operation.observation === 'object'
          ? (operation.observation as Record<string, unknown>)
          : {}
      if (
        observation.providerType === 'vertex' &&
        typeof observation.vertexProject === 'string' &&
        typeof observation.vertexLocation === 'string'
      ) {
        try {
          const ai = new GoogleGenAI({
            vertexai: true,
            project: observation.vertexProject,
            location: observation.vertexLocation,
          })
          const interaction = await ai.interactions.get(operation.remoteOperationId)
          const state =
            interaction.status === 'completed'
              ? 'completed'
              : interaction.status === 'cancelled'
                ? 'canceled'
                : interaction.status === 'failed' || interaction.status === 'incomplete'
                  ? 'failed'
                  : undefined
          await recordWorkflowOperationObservation({
            id: operation.id,
            fencingToken: operation.fencingToken,
            state,
            observation: {
              ...observation,
              providerStatus: interaction.status,
            },
          })
          continue
        } catch {
          // Transient provider/credential failures remain nonterminal and retry.
        }
      }
    }
    if (
      operation.capability === 'native_cancel_status' &&
      operation.remoteOperationId &&
      terminal?.actorUserId
    ) {
      const outcome = await cancelPendingWorkflowExecution({
        pendingExecutionId: operation.remoteOperationId,
        userId: terminal.actorUserId,
        descendantOnly: true,
      })
      await recordWorkflowOperationObservation({
        id: operation.id,
        fencingToken: operation.fencingToken,
        state: outcome.status === 'finished' ? 'canceled' : undefined,
        observation: { adapter: operation.adapterKind, outcome: outcome.status },
      })
      continue
    }
    // Local, status-only, and uncancelable work crosses the barrier only when its
    // live adapter or authoritative provider observer confirms a terminal state.
    await recordWorkflowOperationObservation({
      id: operation.id,
      fencingToken: operation.fencingToken,
      observation: { adapter: operation.adapterKind, outcome: 'unknown' },
    })
  }
  const result = await reconcileWorkflowDeadlineTermination(rootExecutionId)
  if (!result) await scheduleWorkflowTerminationReconcile(rootExecutionId)
  return result
}

export const workflowExecutionTerminationReconcile = task({
  id: 'workflow-execution-termination-reconcile',
  retry: { maxAttempts: 10 },
  run: async (claim: WorkflowExecutionOutboxClaim) => {
    const { rootExecutionId } = claim
    try {
      const result = await reconcileWorkflowTermination(rootExecutionId)
      await completeWorkflowExecutionOutbox(claim)
      return result
    } catch (error) {
      await failWorkflowExecutionOutbox({
        ...claim,
        error: error instanceof Error ? error.message : 'Termination reconciliation failed',
      })
      throw error
    }
  },
})
