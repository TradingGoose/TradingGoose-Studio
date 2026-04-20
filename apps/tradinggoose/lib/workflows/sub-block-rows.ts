import type { SubBlockConfig, SubBlockCondition } from '@/blocks/types'
import { getEnv, isTruthy } from '@/lib/env'
import { buildConfiguredSubBlockParams } from '@/lib/workflows/subblock-values'
import { getTrigger } from '@/triggers'
import { isDeployManagedTriggerSubBlock } from '@/triggers/constants'

interface BuildSubBlockRowsParams {
  subBlocks: SubBlockConfig[]
  stateToUse: Record<string, any>
  isAdvancedMode: boolean
  isTriggerMode: boolean
  isPureTriggerBlock: boolean
  availableTriggerIds?: string[]
  hideFromPreview?: boolean
  triggerSubBlockOwner?: 'editor' | 'deploy' | 'all'
}

type ConditionValue = SubBlockCondition['value']

const normalizeValue = (value: any) =>
  value && typeof value === 'object' && 'id' in value ? value.id : value

const evaluateMatch = (
  condition: { value: ConditionValue; not?: boolean },
  fieldValue: string | number | boolean | null | undefined
) => {
  if (Array.isArray(condition.value)) {
    return (
      fieldValue != null &&
      (condition.not
        ? !condition.value.includes(fieldValue as string | number | boolean)
        : condition.value.includes(fieldValue as string | number | boolean))
    )
  }

  return condition.not ? fieldValue !== condition.value : fieldValue === condition.value
}

export function buildSubBlockRows({
  subBlocks,
  stateToUse,
  isAdvancedMode,
  isTriggerMode,
  isPureTriggerBlock,
  availableTriggerIds,
  hideFromPreview = false,
  triggerSubBlockOwner = 'editor',
}: BuildSubBlockRowsParams): SubBlockConfig[][] {
  const resolvedParams = buildConfiguredSubBlockParams({
    subBlockConfigs: subBlocks,
    subBlocks: stateToUse,
  })
  const selectedTriggerId = resolvedParams.selectedTriggerId
  const triggerIdFromState = resolvedParams.triggerId
  const activeTriggerId =
    typeof selectedTriggerId === 'string'
      ? selectedTriggerId
      : typeof triggerIdFromState === 'string'
        ? triggerIdFromState
        : availableTriggerIds?.[0]
  const hasTriggerDefinition = !!(activeTriggerId && getTrigger(activeTriggerId))

  const getConditionFieldValue = (field: string) => {
    const normalizedValue = normalizeValue(resolvedParams[field])
    if (
      field === 'selectedTriggerId' &&
      (normalizedValue === undefined || normalizedValue === null || normalizedValue === '')
    ) {
      return activeTriggerId
    }
    return normalizedValue
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

    if (subBlock.mode === 'basic' && isAdvancedMode) return false
    if (subBlock.mode === 'advanced' && !isAdvancedMode) return false

    if (!subBlock.condition) return true

    const actualCondition =
      typeof subBlock.condition === 'function' ? subBlock.condition() : subBlock.condition

    const normalizedFieldValue = getConditionFieldValue(actualCondition.field)
    const andConditions = Array.isArray(actualCondition.and)
      ? actualCondition.and
      : actualCondition.and
        ? [actualCondition.and]
        : []

    const isValueMatch = evaluateMatch(actualCondition, normalizedFieldValue)
    const isAndValueMatch =
      andConditions.length === 0 ||
      andConditions.every((andCondition) => {
        const andFieldValue = getConditionFieldValue(andCondition.field)
        return evaluateMatch(andCondition, andFieldValue)
      })

    return isValueMatch && isAndValueMatch
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
