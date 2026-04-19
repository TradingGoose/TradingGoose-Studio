import { env } from '@/lib/env'
import { getResolvedSystemSettings } from '@/lib/system-settings/service'

// Trigger.dev credentials remain deployment-owned in env; DB-backed settings only gate execution.
export function isTriggerConfigurationReady() {
  return Boolean(env.TRIGGER_PROJECT_ID?.trim() && env.TRIGGER_SECRET_KEY?.trim())
}

export async function getTriggerExecutionState() {
  const [settings, configurationReady] = await Promise.all([
    getResolvedSystemSettings(),
    Promise.resolve(isTriggerConfigurationReady()),
  ])

  return {
    configurationReady,
    triggerDevEnabled: settings.triggerDevEnabled,
    executionEnabled: settings.triggerDevEnabled && configurationReady,
  }
}

export async function isTriggerExecutionEnabled() {
  const { executionEnabled } = await getTriggerExecutionState()
  return executionEnabled
}

export class TriggerExecutionUnavailableError extends Error {
  statusCode: number
  code: string

  constructor(
    message = 'Trigger.dev execution is disabled or not configured.',
    statusCode = 503
  ) {
    super(message)
    this.name = 'TriggerExecutionUnavailableError'
    this.statusCode = statusCode
    this.code = 'TRIGGER_EXECUTION_DISABLED'
  }
}

export async function ensureTriggerExecutionEnabled(options?: {
  message?: string
  statusCode?: number
}) {
  if (await isTriggerExecutionEnabled()) {
    return
  }

  throw new TriggerExecutionUnavailableError(options?.message, options?.statusCode)
}
