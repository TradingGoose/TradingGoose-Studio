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
 * Trigger subblock IDs that remain editable in the workflow canvas.
 * Everything else should be configured in the deploy dialog.
 */
export const EDITOR_MANAGED_TRIGGER_SUBBLOCK_IDS: string[] = [
  'inputFormat',
  'samplePayload',
  'monitorGuidance',
]

const editorManagedTriggerSubBlockSet = new Set(EDITOR_MANAGED_TRIGGER_SUBBLOCK_IDS)

export function isEditorManagedTriggerSubBlock(subBlockId: string): boolean {
  return editorManagedTriggerSubBlockSet.has(subBlockId)
}

export function isDeployManagedTriggerSubBlock(subBlockId: string): boolean {
  return !isEditorManagedTriggerSubBlock(subBlockId)
}

/**
 * Maximum number of consecutive failures before a trigger is auto-disabled.
 */
export const MAX_CONSECUTIVE_FAILURES = 100
