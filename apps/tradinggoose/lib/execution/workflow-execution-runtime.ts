import {
  heartbeatWorkflowExecutionParticipant,
  reconcileWorkflowExecutionDeadline,
} from './workflow-execution-deadline-repository'
import {
  completeWorkflowOperation,
  type WorkflowExecutionLifecycle,
} from './workflow-execution-lifecycle-repository'

export type WorkflowExecutionRuntime = {
  signal?: AbortSignal
  start: () => Promise<void>
  rearm: () => Promise<void>
  settleStartup: (state: 'completed' | 'failed' | 'local_abort') => Promise<void>
  close: () => void
}

export function createWorkflowExecutionRuntime(
  lifecycle: WorkflowExecutionLifecycle,
  onHeartbeatError: (error: unknown) => void
): WorkflowExecutionRuntime {
  const controller = lifecycle.policy.kind === 'bounded' ? new AbortController() : null
  let deadlineWake: ReturnType<typeof setTimeout> | undefined
  let participantHeartbeat: ReturnType<typeof setInterval> | undefined
  let startupSettled = false

  const applyReconciliation = (
    reconciliation: Awaited<ReturnType<typeof reconcileWorkflowExecutionDeadline>>
  ) => {
    if (deadlineWake) clearTimeout(deadlineWake)
    if (reconciliation.state === 'scheduled') {
      deadlineWake = setTimeout(() => void arm(), reconciliation.delayMilliseconds)
    } else if (reconciliation.state === 'exhausted' || reconciliation.state === 'closed') {
      controller?.abort()
    }
  }

  const arm = async () => {
    if (!controller) return
    applyReconciliation(await reconcileWorkflowExecutionDeadline(lifecycle.policy.rootExecutionId))
  }

  return {
    signal: controller?.signal,
    start: async () => {
      if (controller) {
        if (!lifecycle.participantId) throw new Error('Bounded workflow participant is missing')
        const reconciliation = await heartbeatWorkflowExecutionParticipant({
          rootExecutionId: lifecycle.policy.rootExecutionId,
          attemptId: lifecycle.attemptId,
          participantId: lifecycle.participantId,
        })
        if (!reconciliation || reconciliation.state === 'closed') {
          controller.abort()
        } else {
          applyReconciliation(reconciliation)
        }
      }
      controller?.signal.throwIfAborted()
      if (controller && lifecycle.participantId) {
        participantHeartbeat = setInterval(() => {
          void heartbeatWorkflowExecutionParticipant({
            rootExecutionId: lifecycle.policy.rootExecutionId,
            attemptId: lifecycle.attemptId,
            participantId: lifecycle.participantId!,
          })
            .then((reconciliation) => {
              if (
                !reconciliation ||
                reconciliation.state === 'closed' ||
                reconciliation.state === 'exhausted'
              ) {
                controller.abort()
              }
            })
            .catch((error) => {
              controller.abort()
              onHeartbeatError(error)
            })
        }, 30_000)
      }
    },
    rearm: arm,
    settleStartup: async (state) => {
      if (startupSettled) return
      const completed = await completeWorkflowOperation({
        operation: {
          id: lifecycle.startupOperationId,
          rootExecutionId: lifecycle.policy.rootExecutionId,
          attemptId: lifecycle.attemptId,
          participantId: lifecycle.participantId,
        },
        state,
      })
      if (!completed) throw new Error('Workflow startup settlement was rejected')
      startupSettled = true
    },
    close: () => {
      if (deadlineWake) clearTimeout(deadlineWake)
      if (participantHeartbeat) clearInterval(participantHeartbeat)
    },
  }
}
