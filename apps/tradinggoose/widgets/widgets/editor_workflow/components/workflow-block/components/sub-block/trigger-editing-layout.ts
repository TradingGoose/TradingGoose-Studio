import { buildSubBlockRows } from '@/lib/workflows/sub-block-rows'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'

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
  blockId?: string
  blockConfig?: Pick<BlockConfig, 'category' | 'subBlocks' | 'triggers'>
  blockState?: TriggerEditableBlockState | null
  shouldDisableWrite: boolean
}

export function buildTriggerEditingLayout({
  blockId,
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
  const regularRows = buildSubBlockRows({
    blockId,
    subBlocks: blockConfig.subBlocks,
    stateToUse: blockStateForConditions,
    isAdvancedMode: false,
    isTriggerMode: effectiveTrigger,
    isPureTriggerBlock,
    availableTriggerIds: blockConfig.triggers?.available,
    hideFromPreview: false,
    triggerSubBlockOwner: 'all',
  })
  const advancedRows = buildSubBlockRows({
    blockId,
    subBlocks: blockConfig.subBlocks,
    stateToUse: blockStateForConditions,
    isAdvancedMode: true,
    isTriggerMode: false,
    isPureTriggerBlock: false,
    availableTriggerIds: blockConfig.triggers?.available,
    hideFromPreview: false,
    triggerSubBlockOwner: 'all',
  })

  return {
    regularRows,
    advancedRows,
    stateToUse: blockStateForConditions,
    displayAdvancedOptions: advancedVisibility,
    hasAdvancedOnlyFields: advancedRows.length > 0,
    isTriggerConfigurationView: effectiveTrigger,
  }
}
