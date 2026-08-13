import { env } from '@/lib/env'
import { isHosted } from '@/lib/environment'
import {
  getResolvedSystemSettings,
  type SystemSettingsReadStore,
} from '@/lib/system-settings/service'

export type ServerExecutionMode = 'trigger' | 'local' | 'unavailable'

// Trigger.dev credentials remain deployment-owned in env; DB-backed settings only gate execution.
export function isTriggerConfigurationReady() {
  return Boolean(env.TRIGGER_PROJECT_ID?.trim() && env.TRIGGER_SECRET_KEY?.trim())
}

export async function getTriggerExecutionState(store?: SystemSettingsReadStore) {
  const settings = await getResolvedSystemSettings(store)
  const mode: ServerExecutionMode = settings.triggerDevEnabled
    ? isTriggerConfigurationReady()
      ? 'trigger'
      : 'unavailable'
    : isHosted
      ? 'unavailable'
      : 'local'

  return { mode }
}

export class TriggerExecutionUnavailableError extends Error {
  statusCode: number
  code: string

  constructor(message = 'Trigger.dev execution is disabled or not configured.', statusCode = 503) {
    super(message)
    this.name = 'TriggerExecutionUnavailableError'
    this.statusCode = statusCode
    this.code = 'TRIGGER_EXECUTION_DISABLED'
  }
}
