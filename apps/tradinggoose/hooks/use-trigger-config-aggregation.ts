import { createLogger } from '@/lib/logs/console/logger'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { getTrigger, isTriggerValid } from '@/triggers'
import { SYSTEM_SUBBLOCK_IDS } from '@/triggers/constants'

const logger = createLogger('useTriggerConfigAggregation')

function mapOldFieldNameToNewSubBlockId(oldFieldName: string): string {
  const fieldMapping: Record<string, string> = {
    credentialId: 'triggerCredentials',
    includeCellValuesInFieldIds: 'includeCellValues',
  }
  return fieldMapping[oldFieldName] || oldFieldName
}

export function useTriggerConfigAggregation(
  blockId: string,
  triggerId: string | undefined,
  workflowId?: string
): Record<string, any> | null {
  if (!triggerId || !blockId) {
    return null
  }

  if (!isTriggerValid(triggerId)) {
    logger.warn(`Trigger definition not found for ID: ${triggerId}`)
    return null
  }

  const triggerDef = getTrigger(triggerId)
  if (!triggerDef) {
    return null
  }
  const subBlockStore = useSubBlockStore.getState()

  const aggregatedConfig: Record<string, any> = {}
  let hasAnyValue = false

  triggerDef.subBlocks
    .filter((sb) => sb.mode === 'trigger' && !SYSTEM_SUBBLOCK_IDS.includes(sb.id))
    .forEach((subBlock) => {
      const fieldValue = subBlockStore.getValue(blockId, subBlock.id, workflowId)

      let valueToUse = fieldValue
      if (
        (fieldValue === null || fieldValue === undefined || fieldValue === '') &&
        subBlock.required &&
        subBlock.defaultValue !== undefined
      ) {
        valueToUse = subBlock.defaultValue
      }

      if (valueToUse !== null && valueToUse !== undefined && valueToUse !== '') {
        aggregatedConfig[subBlock.id] = valueToUse
        hasAnyValue = true
      }
    })

  if (!hasAnyValue) {
    return null
  }

  logger.debug('Aggregated trigger config fields', {
    blockId,
    triggerId,
    aggregatedConfig,
  })

  return aggregatedConfig
}

export function populateTriggerFieldsFromConfig(
  blockId: string,
  triggerConfig: Record<string, any> | null | undefined,
  triggerId: string | undefined,
  workflowId?: string
) {
  if (!triggerConfig || !triggerId || !blockId) {
    return
  }

  if (Object.keys(triggerConfig).length === 0) {
    return
  }

  if (!isTriggerValid(triggerId)) {
    return
  }

  const triggerDef = getTrigger(triggerId)
  if (!triggerDef) {
    return
  }
  const subBlockStore = useSubBlockStore.getState()

  triggerDef.subBlocks
    .filter((sb) => sb.mode === 'trigger' && !SYSTEM_SUBBLOCK_IDS.includes(sb.id))
    .forEach((subBlock) => {
      let configValue: any

      if (subBlock.id in triggerConfig) {
        configValue = triggerConfig[subBlock.id]
      } else {
        for (const [oldFieldName, value] of Object.entries(triggerConfig)) {
          const mappedFieldName = mapOldFieldNameToNewSubBlockId(oldFieldName)
          if (mappedFieldName === subBlock.id) {
            configValue = value
            break
          }
        }
      }

      if (configValue !== undefined) {
        const currentValue = subBlockStore.getValue(blockId, subBlock.id, workflowId)

        let normalizedValue = configValue
        if (subBlock.id === 'labelIds' || subBlock.id === 'folderIds') {
          if (typeof configValue === 'string' && configValue.trim() !== '') {
            try {
              normalizedValue = JSON.parse(configValue)
            } catch {
              normalizedValue = [configValue]
            }
          } else if (
            !Array.isArray(configValue) &&
            configValue !== null &&
            configValue !== undefined
          ) {
            normalizedValue = [configValue]
          }
        }

        if (currentValue === null || currentValue === undefined || currentValue === '') {
          subBlockStore.setValue(blockId, subBlock.id, normalizedValue, workflowId)
        }
      }
    })
}
