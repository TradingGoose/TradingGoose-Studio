import { tasks } from '@trigger.dev/sdk'
import { isDev } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { getTriggerExecutionState, TriggerExecutionUnavailableError } from '@/lib/trigger/settings'

export const PENDING_EXECUTION_DRAIN_TASK_ID = 'pending-execution-drain'

const logger = createLogger('PendingExecutionQueue')
type TriggerExecutionState = Awaited<ReturnType<typeof getTriggerExecutionState>>

export async function triggerPendingExecutionDrain(params: {
  billingScopeId: string
  requestId?: string
  triggerState?: TriggerExecutionState
}) {
  const triggerState = params.triggerState ?? (await getTriggerExecutionState())

  if (triggerState.triggerDevEnabled && !triggerState.configurationReady) {
    throw new TriggerExecutionUnavailableError(
      'Trigger.dev execution is enabled but not configured.'
    )
  }

  if (triggerState.executionEnabled) {
    await tasks.trigger(PENDING_EXECUTION_DRAIN_TASK_ID, {
      billingScopeId: params.billingScopeId,
    })
    return
  }

  if (!triggerState.triggerDevEnabled && isDev) {
    const { drainPendingExecutionsForBillingScope } = await import(
      '@/background/pending-execution-drain'
    )
    void drainPendingExecutionsForBillingScope({ billingScopeId: params.billingScopeId }).catch(
      (error) => {
        logger.error('Local pending execution drain failed', {
          billingScopeId: params.billingScopeId,
          requestId: params.requestId,
          error,
        })
      }
    )
    return
  }

  throw new TriggerExecutionUnavailableError(
    'Queued server execution requires Trigger.dev outside local development.'
  )
}

export async function wakePendingExecutionDrain(params: {
  billingScopeId: string
  requestId?: string
}) {
  try {
    await triggerPendingExecutionDrain(params)
  } catch (error) {
    logger.error('Pending execution drain wake failed', {
      billingScopeId: params.billingScopeId,
      requestId: params.requestId,
      error,
    })
  }
}
