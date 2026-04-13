import { env } from '@/lib/env'
import { getResolvedSystemSettings } from '@/lib/system-settings/service'

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
