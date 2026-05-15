import type { SubBlockConfig } from '@/blocks/types'
import { resolveTriggerIdFromSubBlocks } from '@/triggers/resolution'

export function getTriggerAwareSubBlockStableKey(
  blockId: string,
  subBlock: SubBlockConfig,
  stateToUse: Record<string, any>,
  availableTriggerIds?: string[]
) {
  if (subBlock.type === 'mcp-dynamic-args') {
    const serverValue = stateToUse.server?.value || 'no-server'
    const toolValue = stateToUse.tool?.value || 'no-tool'
    return `${blockId}-${subBlock.id}-${serverValue}-${toolValue}`
  }

  if (subBlock.type === 'mcp-tool-selector') {
    const serverValue = stateToUse.server?.value || 'no-server'
    return `${blockId}-${subBlock.id}-${serverValue}`
  }

  if (subBlock.mode === 'trigger') {
    const activeTriggerId =
      resolveTriggerIdFromSubBlocks(stateToUse, availableTriggerIds) || 'no-trigger'
    return `${blockId}-${subBlock.id}-${activeTriggerId}`
  }

  return `${blockId}-${subBlock.id}`
}
