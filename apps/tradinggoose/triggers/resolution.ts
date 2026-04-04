import { getBlock } from '@/blocks'
import { TRIGGER_REGISTRY } from '@/triggers/registry'

type TriggerSubBlockValue = { value?: unknown } | unknown

type TriggerResolvableBlock = {
  type: string
  triggerMode?: boolean
  subBlocks?: Record<string, TriggerSubBlockValue>
}

function isRegisteredTriggerId(value: unknown): value is string {
  return typeof value === 'string' && value in TRIGGER_REGISTRY
}

function getSubBlockValue(
  subBlocks: Record<string, TriggerSubBlockValue> | undefined,
  subBlockId: string
): unknown {
  const subBlock = subBlocks?.[subBlockId]
  if (!subBlock || typeof subBlock !== 'object' || Array.isArray(subBlock)) {
    return subBlock
  }

  if ('value' in subBlock) {
    return subBlock.value
  }

  return subBlock
}

export function resolveTriggerIdFromSubBlocks(
  subBlocks: Record<string, TriggerSubBlockValue> | undefined,
  availableTriggerIds?: string[]
): string | null {
  const selectedTriggerId = getSubBlockValue(subBlocks, 'selectedTriggerId')
  if (isRegisteredTriggerId(selectedTriggerId)) {
    return selectedTriggerId
  }

  const triggerId = getSubBlockValue(subBlocks, 'triggerId')
  if (isRegisteredTriggerId(triggerId)) {
    return triggerId
  }

  const fallbackTriggerId = availableTriggerIds?.find((candidate) =>
    isRegisteredTriggerId(candidate)
  )
  return fallbackTriggerId ?? null
}

export function resolveTriggerIdForBlock(block: TriggerResolvableBlock): string | null {
  const blockConfig = getBlock(block.type)
  if (!blockConfig) {
    return null
  }

  const isPureTriggerBlock = blockConfig.category === 'triggers'
  if (!isPureTriggerBlock && block.triggerMode !== true) {
    return null
  }

  return resolveTriggerIdFromSubBlocks(block.subBlocks, blockConfig.triggers?.available)
}
