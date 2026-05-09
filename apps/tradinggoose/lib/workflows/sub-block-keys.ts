import type { SubBlockConfig } from '@/blocks/types'

function readStateValue(stateEntry: any) {
  if (stateEntry && typeof stateEntry === 'object' && 'value' in stateEntry) {
    return stateEntry.value
  }

  return stateEntry
}

export function resolveActiveTriggerId(
  stateToUse: Record<string, any>,
  availableTriggerIds?: string[]
): string | null {
  const selectedTriggerId = readStateValue(stateToUse.selectedTriggerId)
  if (typeof selectedTriggerId === 'string' && selectedTriggerId.trim().length > 0) {
    return selectedTriggerId
  }

  const triggerId = readStateValue(stateToUse.triggerId)
  if (typeof triggerId === 'string' && triggerId.trim().length > 0) {
    return triggerId
  }

  return availableTriggerIds?.[0] ?? null
}

function hasResolvedStateValue(stateToUse: Record<string, any>, field: string): boolean {
  const value = readStateValue(stateToUse[field])
  if (typeof value === 'string') {
    return value.trim().length > 0
  }

  return value !== undefined && value !== null
}

export function withResolvedTriggerState(
  stateToUse: Record<string, any>,
  activeTriggerId: string | null
): Record<string, any> {
  if (!activeTriggerId) {
    return stateToUse
  }

  let nextState = stateToUse

  if (!hasResolvedStateValue(nextState, 'selectedTriggerId')) {
    nextState = {
      ...nextState,
      selectedTriggerId: { value: activeTriggerId },
    }
  }

  if (!hasResolvedStateValue(nextState, 'triggerId')) {
    nextState = {
      ...nextState,
      triggerId: { value: activeTriggerId },
    }
  }

  return nextState
}

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
    const activeTriggerId = resolveActiveTriggerId(stateToUse, availableTriggerIds) || 'no-trigger'
    return `${blockId}-${subBlock.id}-${activeTriggerId}`
  }

  return `${blockId}-${subBlock.id}`
}
