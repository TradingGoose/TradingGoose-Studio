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

  const arm = async () => {
    if (!controller) return
    if (deadlineWake) clearTimeout(deadlineWake)
    const reconciliation = await reconcileWorkflowExecutionDeadline(
      lifecycle.policy.rootExecutionId
    )
    if (reconciliation.state === 'scheduled') {
      deadlineWake = setTimeout(() => void arm(), reconciliation.delayMilliseconds)
    } else if (reconciliation.state === 'exhausted') {
      controller.abort()
    }
  }

  return {
    signal: controller?.signal,
    start: async () => {
      await arm()
      controller?.signal.throwIfAborted()
      if (controller && lifecycle.participantId) {
        participantHeartbeat = setInterval(() => {
          void heartbeatWorkflowExecutionParticipant(lifecycle.participantId!).catch(
            onHeartbeatError
          )
        }, 30_000)
      }
    },
    rearm: arm,
    settleStartup: async (state) => {
      if (startupSettled) return
      await completeWorkflowOperation({ id: lifecycle.startupOperationId, state })
      startupSettled = true
    },
    close: () => {
      if (deadlineWake) clearTimeout(deadlineWake)
      if (participantHeartbeat) clearInterval(participantHeartbeat)
    },
  }
}
