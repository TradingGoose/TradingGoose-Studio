import { isMonitorTriggerId } from '@/lib/monitors/sources'
import { generateMockPayloadFromOutputsDefinition } from '@/lib/workflows/triggers/trigger-utils'
import type { SubBlockConfig } from '@/blocks/types'
import { TRIGGER_REGISTRY } from '@/triggers/registry'
import type { TriggerConfig } from '@/triggers/types'

const NATIVE_TRIGGER_PROVIDER_KEYS = new Set([
  'core',
  'schedule',
  'indicator',
  'portfolio',
  'generic',
  'imap',
  'rss',
])

const TRIGGER_SYSTEM_SUBBLOCK_IDS = new Set([
  'selectedTriggerId',
  'webhookUrlDisplay',
  'triggerSave',
])

export function getTrigger(triggerId: string): TriggerConfig | undefined {
  const trigger = TRIGGER_REGISTRY[triggerId]
  if (!trigger) {
    return undefined
  }

  const clonedTrigger: TriggerConfig = {
    ...trigger,
    subBlocks: [...trigger.subBlocks],
  }

  const originalSelectedTrigger = trigger.subBlocks.find(
    (subBlock) => subBlock.id === 'selectedTriggerId'
  )
  const originalWebhookUrlDisplay = trigger.subBlocks.find(
    (subBlock) => subBlock.id === 'webhookUrlDisplay'
  )
  const originalTriggerInstructions = trigger.subBlocks.find(
    (subBlock) => subBlock.id === 'triggerInstructions'
  )
  const hasSystemShell = trigger.subBlocks.some((subBlock) =>
    TRIGGER_SYSTEM_SUBBLOCK_IDS.has(subBlock.id)
  )
  const triggerOptions = originalSelectedTrigger?.options
    ? (typeof originalSelectedTrigger.options === 'function'
        ? originalSelectedTrigger.options()
        : originalSelectedTrigger.options
      ).map((option) => ({
        id: option.id,
        label: option.label,
      }))
    : []

  if (hasSystemShell) {
    const extraFields = clonedTrigger.subBlocks.filter(
      (subBlock) =>
        !TRIGGER_SYSTEM_SUBBLOCK_IDS.has(subBlock.id) &&
        subBlock.id !== 'triggerInstructions' &&
        subBlock.id !== 'samplePayload'
    )

    clonedTrigger.subBlocks = buildTriggerSubBlocks({
      triggerId: trigger.id,
      triggerOptions,
      includeDropdown: Boolean(originalSelectedTrigger && !originalSelectedTrigger.hidden),
      includeWebhookUrl: Boolean(originalWebhookUrlDisplay?.useWebhookUrl),
      extraFields,
      webhookPlaceholder:
        typeof originalWebhookUrlDisplay?.placeholder === 'string'
          ? originalWebhookUrlDisplay.placeholder
          : undefined,
      instructionsDefaultValue: originalTriggerInstructions?.defaultValue,
    })
  }

  if (!clonedTrigger.subBlocks.some((subBlock) => subBlock.id === 'selectedTriggerId')) {
    clonedTrigger.subBlocks.unshift({
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      hidden: true,
    })
  }

  if (
    clonedTrigger.subBlocks &&
    (trigger.webhook ||
      trigger.id.includes('webhook') ||
      trigger.id.includes('poller') ||
      isMonitorTriggerId(trigger.id))
  ) {
    const samplePayloadExists = clonedTrigger.subBlocks.some((sb) => sb.id === 'samplePayload')

    if (!samplePayloadExists && trigger.outputs) {
      const mockPayload = generateMockPayloadFromOutputsDefinition(trigger.outputs)
      const hasSamplePayloadContent =
        mockPayload &&
        typeof mockPayload === 'object' &&
        !Array.isArray(mockPayload) &&
        Object.keys(mockPayload).length > 0

      if (!hasSamplePayloadContent) {
        return clonedTrigger
      }

      const generatedPayload = JSON.stringify(mockPayload, null, 2)

      const samplePayloadSubBlock: SubBlockConfig = {
        id: 'samplePayload',
        title: 'Event Payload Example',
        type: 'code',
        language: 'json',
        defaultValue: generatedPayload,
        readOnly: true,
        collapsible: true,
        defaultCollapsed: true,
        hideFromPreview: true,
        mode: 'trigger',
        condition: {
          field: 'selectedTriggerId',
          value: trigger.id,
        },
      }

      clonedTrigger.subBlocks.push(samplePayloadSubBlock)
    }
  }

  return clonedTrigger
}

export function getTriggersByWebhookProvider(webhookProvider: string): TriggerConfig[] {
  return Object.values(TRIGGER_REGISTRY)
    .filter((trigger) => trigger.webhookProvider === webhookProvider)
    .map((trigger) => getTrigger(trigger.id)!)
}

export function getAllTriggers(): TriggerConfig[] {
  return Object.keys(TRIGGER_REGISTRY).map((triggerId) => getTrigger(triggerId)!)
}

export function isNativeTrigger(triggerId: string): boolean {
  const trigger = TRIGGER_REGISTRY[triggerId]
  return trigger ? NATIVE_TRIGGER_PROVIDER_KEYS.has(trigger.webhookProvider) : false
}

export function getTriggerIds(): string[] {
  return Object.keys(TRIGGER_REGISTRY)
}

export function isTriggerValid(triggerId: string): boolean {
  return triggerId in TRIGGER_REGISTRY
}

export type { TriggerConfig, TriggerRegistry } from '@/triggers/types'

export interface BuildTriggerSubBlocksOptions {
  triggerId: string
  triggerOptions: Array<{ label: string; id: string }>
  includeDropdown?: boolean
  includeWebhookUrl?: boolean
  extraFields?: SubBlockConfig[]
  webhookPlaceholder?: string
  instructionsDefaultValue?: SubBlockConfig['defaultValue']
}

export function buildTriggerSubBlocks(options: BuildTriggerSubBlocksOptions): SubBlockConfig[] {
  const {
    triggerId,
    triggerOptions,
    includeDropdown = false,
    includeWebhookUrl = true,
    extraFields = [],
    webhookPlaceholder = 'Webhook URL will be generated',
    instructionsDefaultValue = '',
  } = options

  const blocks: SubBlockConfig[] = []
  const triggerCondition = includeDropdown
    ? { field: 'selectedTriggerId', value: triggerId }
    : undefined

  if (includeDropdown) {
    blocks.push({
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: triggerOptions,
      value: () => triggerId,
      required: true,
    })
  }

  if (includeWebhookUrl) {
    blocks.push({
      id: 'webhookUrlDisplay',
      title: 'Webhook URL',
      type: 'short-input',
      readOnly: true,
      showCopyButton: true,
      useWebhookUrl: true,
      placeholder: webhookPlaceholder,
      mode: 'trigger',
      condition: triggerCondition,
    })
  }

  if (extraFields.length > 0) {
    blocks.push(...extraFields)
  }

  blocks.push({
    id: 'triggerSave',
    title: '',
    type: 'trigger-save',
    hideFromPreview: true,
    mode: 'trigger',
    condition: triggerCondition,
  })

  blocks.push({
    id: 'triggerInstructions',
    title: 'Setup Instructions',
    hideFromPreview: true,
    type: 'text',
    defaultValue: instructionsDefaultValue,
    mode: 'trigger',
    condition: triggerCondition,
  })

  return blocks
}
