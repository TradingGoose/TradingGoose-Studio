import type { SubBlockConfig } from '@/blocks/types'

/**
 * System subblock IDs that are part of the trigger UI infrastructure
 * and should NOT be aggregated into triggerConfig or validated as user fields.
 */
export const SYSTEM_SUBBLOCK_IDS: string[] = [
  'triggerCredentials',
  'triggerInstructions',
  'webhookUrlDisplay',
  'triggerSave',
  'samplePayload',
  'setupScript',
  'triggerId',
  'selectedTriggerId',
]

/**
 * Trigger-related subblock IDs whose values should be persisted and
 * propagated when workflows are edited programmatically.
 */
export const TRIGGER_PERSISTED_SUBBLOCK_IDS: string[] = [
  'triggerConfig',
  'triggerCredentials',
  'triggerId',
  'selectedTriggerId',
  'webhookId',
  'triggerPath',
]

/**
 * Trigger-related subblock IDs that represent runtime metadata.
 */
export const TRIGGER_RUNTIME_SUBBLOCK_IDS: string[] = ['webhookId', 'triggerPath', 'triggerConfig']

export const NON_CONFIGURABLE_TRIGGER_SUBBLOCK_IDS: string[] = [
  'webhookUrlDisplay',
  'triggerSave',
  'triggerInstructions',
]

const nonConfigurableTriggerSubBlockSet = new Set(NON_CONFIGURABLE_TRIGGER_SUBBLOCK_IDS)

export function isConfigurableTriggerDeploySubBlock(subBlock: SubBlockConfig): boolean {
  if (nonConfigurableTriggerSubBlockSet.has(subBlock.id)) {
    return false
  }
  if (subBlock.type === 'trigger-save' || subBlock.type === 'text') {
    return false
  }
  return !subBlock.readOnly
}

/**
 * Maximum number of consecutive failures before a trigger is auto-disabled.
 */
export const MAX_CONSECUTIVE_FAILURES = 100
