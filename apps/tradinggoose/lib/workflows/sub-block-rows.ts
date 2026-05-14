import { getEnv, isTruthy } from '@/lib/env'
import { evaluateSubBlockCondition } from '@/lib/workflows/sub-block-conditions'
import { buildConfiguredSubBlockParams } from '@/lib/workflows/subblock-values'
import type { SubBlockConfig } from '@/blocks/types'
import { getTrigger } from '@/triggers'
import { isDeployManagedTriggerSubBlock } from '@/triggers/constants'
import { resolveTriggerIdFromSubBlocks } from '@/triggers/resolution'

interface BuildSubBlockRowsParams {
  blockId?: string
  subBlocks: SubBlockConfig[]
  stateToUse: Record<string, any>
  isAdvancedMode: boolean
  isTriggerMode: boolean
  isPureTriggerBlock: boolean
  availableTriggerIds?: string[]
  hideFromPreview?: boolean
  triggerSubBlockOwner?: 'editor' | 'deploy' | 'all'
}

type BuildSubBlockPreviewRowsParams = Omit<
  BuildSubBlockRowsParams,
  | 'isAdvancedMode'
  | 'hideFromPreview'
  | 'triggerSubBlockOwner'
  | 'isPureTriggerBlock'
  | 'isTriggerMode'
> & {
  isPureTriggerBlock?: boolean
  isTriggerMode?: boolean
}

const hasStoredValue = (value: unknown) =>
  value && typeof value === 'object' && 'value' in value
    ? (value as { value: unknown }).value !== undefined
    : value !== undefined

export function buildSubBlockRows({
  blockId,
  subBlocks,
  stateToUse,
  isAdvancedMode,
  isTriggerMode,
  isPureTriggerBlock,
  availableTriggerIds,
  hideFromPreview = false,
  triggerSubBlockOwner = 'editor',
}: BuildSubBlockRowsParams): SubBlockConfig[][] {
  const conditionParams = buildConfiguredSubBlockParams({
    blockId,
    subBlockConfigs: subBlocks,
    subBlocks: stateToUse,
  })
  const activeTriggerId = resolveTriggerIdFromSubBlocks(conditionParams, availableTriggerIds)
  const hasTriggerDefinition = !!(activeTriggerId && getTrigger(activeTriggerId))

  const getConditionFieldValue = (field: string) => {
    if (field === 'selectedTriggerId') {
      if (availableTriggerIds !== undefined) {
        return activeTriggerId ?? undefined
      }

      if (activeTriggerId) {
        return activeTriggerId
      }
    }

    return conditionParams[field]
  }

  const visibleSubBlocks = subBlocks.filter((subBlock) => {
    if (subBlock.hidden) return false
    if (hideFromPreview && subBlock.hideFromPreview) return false

    if (subBlock.requiresFeature && !isTruthy(getEnv(subBlock.requiresFeature))) {
      return false
    }

    if (isTriggerMode) {
      const isValidTriggerSubblock = isPureTriggerBlock
        ? subBlock.mode === 'trigger' || !subBlock.mode
        : subBlock.mode === 'trigger'

      if (!isValidTriggerSubblock) {
        return false
      }
    } else if (subBlock.mode === 'trigger') {
      return false
    }

    if (isTriggerMode && subBlock.mode === 'trigger' && hasTriggerDefinition) {
      const isDeployManaged = isDeployManagedTriggerSubBlock(subBlock.id)
      if (triggerSubBlockOwner === 'editor' && isDeployManaged) {
        return false
      }
      if (triggerSubBlockOwner === 'deploy' && !isDeployManaged) {
        return false
      }
    }

    if (isAdvancedMode && subBlock.mode !== 'advanced') return false
    if (!isAdvancedMode && subBlock.mode === 'advanced') return false

    if (!subBlock.condition) return true

    return evaluateSubBlockCondition(subBlock.condition, getConditionFieldValue)
  })

  const rows: SubBlockConfig[][] = []
  let currentRow: SubBlockConfig[] = []
  let currentRowWidth = 0

  visibleSubBlocks.forEach((subBlock) => {
    const subBlockWidth = subBlock.layout === 'half' ? 0.5 : 1

    if (currentRowWidth + subBlockWidth > 1) {
      if (currentRow.length > 0) {
        rows.push([...currentRow])
      }
      currentRow = [subBlock]
      currentRowWidth = subBlockWidth
      return
    }

    currentRow.push(subBlock)
    currentRowWidth += subBlockWidth
  })

  if (currentRow.length > 0) {
    rows.push(currentRow)
  }

  return rows
}

export function buildSubBlockPreviewRows({
  isPureTriggerBlock = false,
  isTriggerMode = false,
  subBlocks,
  stateToUse,
  ...params
}: BuildSubBlockPreviewRowsParams): SubBlockConfig[] {
  return buildSubBlockRows({
    ...params,
    stateToUse,
    subBlocks: subBlocks
      .filter((subBlock) => subBlock.mode !== 'advanced' || hasStoredValue(stateToUse[subBlock.id]))
      .map((subBlock) =>
        subBlock.mode === 'advanced' ? { ...subBlock, mode: 'both' as const } : subBlock
      ),
    isAdvancedMode: false,
    isPureTriggerBlock,
    isTriggerMode,
    hideFromPreview: true,
    triggerSubBlockOwner: 'all',
  }).flat()
}
