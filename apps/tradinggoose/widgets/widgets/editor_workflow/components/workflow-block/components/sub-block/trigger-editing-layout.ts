import { buildSubBlockRows, hasConfiguredSubBlockValue } from '@/lib/workflows/sub-block-rows'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import {
  localizeWorkflowSubBlockConfigWithCopy,
  type WorkflowInspectorCopy,
} from '@/i18n/workflow-inspector-core'
import { resolveTriggerIdFromSubBlocks } from '@/triggers/resolution'

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
  inspectorCopy: WorkflowInspectorCopy
  blockType: string
  blockId?: string
  blockConfig?: Pick<BlockConfig, 'category' | 'subBlocks' | 'triggers'>
  blockState?: TriggerEditableBlockState | null
  shouldDisableWrite: boolean
}

export function buildTriggerEditingLayout({
  inspectorCopy,
  blockType,
  blockId,
  blockConfig,
  blockState,
  shouldDisableWrite,
}: BuildTriggerEditingLayoutParams) {
  if (!blockConfig?.subBlocks) {
    return {
      regularRows: [] as SubBlockConfig[][],
      additionalRows: [] as SubBlockConfig[][],
      stateToUse: {},
      displayAdditionalFields: false,
      hasAdditionalFields: false,
      hasAdvancedFields: false,
      isTriggerConfigurationView: false,
    }
  }

  const blockStateForConditions = blockState?.subBlocks || {}
  const isPureTriggerBlock = blockConfig.category === 'triggers'
  const effectiveTrigger = Boolean(blockState?.triggerMode) || isPureTriggerBlock
  const triggerId = effectiveTrigger
    ? resolveTriggerIdFromSubBlocks(blockStateForConditions, blockConfig.triggers?.available)
    : null
  const localizedSubBlocks = blockConfig.subBlocks.map((subBlock) =>
    localizeWorkflowSubBlockConfigWithCopy(
      inspectorCopy,
      subBlock,
      blockType,
      triggerId ?? undefined
    )
  )
  const normalRows = buildSubBlockRows({
    blockId,
    subBlocks: localizedSubBlocks,
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
    subBlocks: localizedSubBlocks,
    stateToUse: blockStateForConditions,
    isAdvancedMode: true,
    isTriggerMode: false,
    isPureTriggerBlock: false,
    availableTriggerIds: blockConfig.triggers?.available,
    hideFromPreview: false,
    triggerSubBlockOwner: 'all',
  })
  const additionalRows = [
    ...normalRows.map((row) => row.filter((field) => field.additional)),
    ...advancedRows,
  ].filter((row) => row.length > 0)
  const hasAdvancedFields = advancedRows.length > 0
  const additionalValuesPresent = additionalRows
    .flat()
    .some((field) => hasConfiguredSubBlockValue(blockStateForConditions[field.id]))

  return {
    regularRows: normalRows
      .map((row) => row.filter((field) => !field.additional))
      .filter((row) => row.length > 0),
    additionalRows,
    stateToUse: blockStateForConditions,
    displayAdditionalFields: hasAdvancedFields
      ? Boolean(blockState?.advancedMode) || (shouldDisableWrite && additionalValuesPresent)
      : additionalValuesPresent,
    hasAdditionalFields: additionalRows.length > 0,
    hasAdvancedFields,
    isTriggerConfigurationView: effectiveTrigger,
  }
}
