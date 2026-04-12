import { generateMockPayloadFromOutputsDefinition } from '@/lib/workflows/triggers/trigger-utils'
import type { SubBlockConfig } from '@/blocks/types'
import { TRIGGER_REGISTRY } from '@/triggers/registry'
import type { TriggerConfig } from '@/triggers/types'

const NATIVE_TRIGGER_PROVIDER_KEYS = new Set([
  'core',
  'schedule',
  'indicator',
  'generic',
  'imap',
  'rss',
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

  if (
    clonedTrigger.subBlocks &&
    (trigger.webhook ||
      trigger.id.includes('webhook') ||
      trigger.id.includes('poller') ||
      trigger.id === 'indicator_trigger')
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
  setupInstructions: string
  extraFields?: SubBlockConfig[]
  webhookPlaceholder?: string
}

export function buildTriggerSubBlocks(options: BuildTriggerSubBlocksOptions): SubBlockConfig[] {
  const {
    triggerId,
    triggerOptions,
    includeDropdown = false,
    setupInstructions,
    extraFields = [],
    webhookPlaceholder = 'Webhook URL will be generated',
  } = options

  const blocks: SubBlockConfig[] = []

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

  blocks.push({
    id: 'webhookUrlDisplay',
    title: 'Webhook URL',
    type: 'short-input',
    readOnly: true,
    showCopyButton: true,
    useWebhookUrl: true,
    placeholder: webhookPlaceholder,
    mode: 'trigger',
    condition: { field: 'selectedTriggerId', value: triggerId },
  })

  if (extraFields.length > 0) {
    blocks.push(...extraFields)
  }

  blocks.push({
    id: 'triggerSave',
    title: '',
    type: 'trigger-save',
    hideFromPreview: true,
    mode: 'trigger',
    triggerId: triggerId,
    condition: { field: 'selectedTriggerId', value: triggerId },
  })

  blocks.push({
    id: 'triggerInstructions',
    title: 'Setup Instructions',
    hideFromPreview: true,
    type: 'text',
    defaultValue: setupInstructions,
    mode: 'trigger',
    condition: { field: 'selectedTriggerId', value: triggerId },
  })

  return blocks
}
