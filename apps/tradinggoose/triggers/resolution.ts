import { getBlock } from '@/blocks'
import type { BlockConfig, SubBlockType } from '@/blocks/types'
import { TRIGGER_REGISTRY } from '@/triggers/registry'

type TriggerSubBlockValue = { value?: unknown } | unknown
type TriggerSelectableSubBlockState = {
  id: string
  type: SubBlockType
  value: unknown
}

type TriggerResolvableBlock = {
  type: string
  triggerMode?: boolean
  subBlocks?: Record<string, TriggerSubBlockValue>
}

function isAvailableTriggerId(value: unknown, availableTriggerIds?: string[]): value is string {
  if (typeof value !== 'string' || !(value in TRIGGER_REGISTRY)) {
    return false
  }

  return availableTriggerIds === undefined || availableTriggerIds.includes(value)
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
  if (isAvailableTriggerId(selectedTriggerId, availableTriggerIds)) {
    return selectedTriggerId
  }

  return null
}

export function persistSingletonTriggerSelection<
  TSubBlocks extends Record<string, TriggerSelectableSubBlockState>,
>(
  subBlocks: TSubBlocks,
  blockConfig: Pick<BlockConfig, 'category' | 'subBlocks' | 'triggers'>,
  triggerMode: boolean
): TSubBlocks {
  if (!triggerMode && blockConfig.category !== 'triggers') {
    return subBlocks
  }

  const availableTriggerIds = blockConfig.triggers?.available ?? []
  const triggerId = availableTriggerIds.length === 1 ? availableTriggerIds[0] : null
  const selectedTriggerConfig = blockConfig.subBlocks.find(
    (subBlock) => subBlock.id === 'selectedTriggerId'
  )
  if (!triggerId || !selectedTriggerConfig) {
    return subBlocks
  }

  return {
    ...subBlocks,
    selectedTriggerId: {
      id: 'selectedTriggerId',
      type: selectedTriggerConfig.type,
      value: triggerId,
    },
  }
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
