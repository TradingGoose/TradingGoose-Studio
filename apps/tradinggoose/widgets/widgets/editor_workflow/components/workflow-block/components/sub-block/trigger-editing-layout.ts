import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import { buildSubBlockRows } from '@/lib/workflows/sub-block-rows'

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

export function removeTriggerModeSelectorFromRows(rows: SubBlockConfig[][]): SubBlockConfig[][] {
  return rows
    .map((row) => row.filter((subBlock) => subBlock.id !== 'selectedTriggerId'))
    .filter((row) => row.length > 0)
}

interface TriggerEditableBlockState {
  subBlocks?: Record<string, any>
  triggerMode?: boolean
  advancedMode?: boolean
}

interface BuildTriggerEditingLayoutParams {
  blockConfig?: Pick<BlockConfig, 'category' | 'subBlocks' | 'triggers'>
  blockState?: TriggerEditableBlockState | null
  shouldDisableWrite: boolean
}

export function buildTriggerEditingLayout({
  blockConfig,
  blockState,
  shouldDisableWrite,
}: BuildTriggerEditingLayoutParams) {
  if (!blockConfig?.subBlocks) {
    return {
      regularRows: [] as SubBlockConfig[][],
      advancedRows: [] as SubBlockConfig[][],
      stateToUse: {},
      displayAdvancedOptions: false,
      hasAdvancedOnlyFields: false,
      isTriggerConfigurationView: false,
    }
  }

  const blockStateForConditions = blockState?.subBlocks || {}
  const isPureTriggerBlock = blockConfig.category === 'triggers'
  const effectiveTrigger = Boolean(blockState?.triggerMode) || isPureTriggerBlock
  const activeTriggerId = effectiveTrigger
    ? resolveActiveTriggerId(blockStateForConditions, blockConfig.triggers?.available)
    : null
  const normalizedConditionState = effectiveTrigger
    ? withResolvedTriggerState(blockStateForConditions, activeTriggerId)
    : blockStateForConditions
  const effectiveAdvanced = Boolean(blockState?.advancedMode)
  const advancedValuesPresent = blockConfig.subBlocks.some((subBlock) => {
    if (subBlock.mode !== 'advanced') return false
    const value = blockStateForConditions[subBlock.id]?.value
    if (value === undefined || value === null) return false
    if (typeof value === 'string') return value.trim().length > 0
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === 'object') return Object.keys(value).length > 0
    return true
  })
  const advancedVisibility = shouldDisableWrite
    ? effectiveAdvanced || advancedValuesPresent
    : effectiveAdvanced
  const advancedOnlySubBlocks = blockConfig.subBlocks.filter(
    (subBlock) => subBlock.mode === 'advanced'
  )

  const regularRows = buildSubBlockRows({
    subBlocks: blockConfig.subBlocks,
    stateToUse: normalizedConditionState,
    isAdvancedMode: false,
    isTriggerMode: effectiveTrigger,
    isPureTriggerBlock,
    availableTriggerIds: blockConfig.triggers?.available,
    hideFromPreview: false,
    triggerSubBlockOwner: 'all',
  })
  const advancedRows = buildSubBlockRows({
    subBlocks: advancedOnlySubBlocks,
    stateToUse: normalizedConditionState,
    isAdvancedMode: true,
    isTriggerMode: effectiveTrigger,
    isPureTriggerBlock,
    availableTriggerIds: blockConfig.triggers?.available,
    hideFromPreview: false,
    triggerSubBlockOwner: 'all',
  })

  return {
    regularRows,
    advancedRows,
    stateToUse: normalizedConditionState,
    displayAdvancedOptions: advancedVisibility,
    hasAdvancedOnlyFields: advancedRows.length > 0,
    isTriggerConfigurationView: effectiveTrigger,
  }
}
