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

/**
 * Maximum number of consecutive failures before a trigger is auto-disabled.
 */
export const MAX_CONSECUTIVE_FAILURES = 100
