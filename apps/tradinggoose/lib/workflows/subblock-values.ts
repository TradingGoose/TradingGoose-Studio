import { getBaseUrl } from '@/lib/urls/utils'
import type { SubBlockConfig } from '@/blocks/types'

type SubBlockStateLike = Record<string, { value?: unknown } | undefined>

function readStoredSubBlockValue(value: unknown): unknown {
  return typeof value === 'function' ? undefined : value
}

function resolveConfiguredSubBlockValue(
  subBlock: Pick<SubBlockConfig, 'value'>,
  params: Record<string, any>
): unknown {
  if (typeof subBlock.value === 'function') {
    return subBlock.value(params)
  }

  return subBlock.value
}

function cloneSubBlockValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (Array.isArray(value) || (typeof value === 'object' && value.constructor === Object)) {
    return structuredClone(value)
  }

  return value
}

export function buildConfiguredSubBlockParams(args: {
  blockId?: string
  subBlockConfigs: SubBlockConfig[]
  subBlocks: SubBlockStateLike | undefined
  isAdvancedMode?: boolean
}): Record<string, any> {
  const { blockId, subBlockConfigs, subBlocks, isAdvancedMode } = args
  const params: Record<string, any> = {}

  for (const subBlockConfig of subBlockConfigs) {
    if (isAdvancedMode === false && subBlockConfig.mode === 'advanced') continue
    if (isAdvancedMode === true && subBlockConfig.mode === 'basic') continue

    const resolvedValue = readStoredSubBlockValue(subBlocks?.[subBlockConfig.id]?.value)
    if (resolvedValue !== undefined) {
      params[subBlockConfig.canonicalParamId ?? subBlockConfig.id] = resolvedValue
    }
  }

  if (blockId && subBlockConfigs.some((subBlock) => subBlock.id === 'webhookUrlDisplay')) {
    const triggerPath =
      typeof params.triggerPath === 'string' && params.triggerPath.trim().length > 0
        ? params.triggerPath
        : blockId

    params.webhookUrlDisplay = `${getBaseUrl()}/api/webhooks/trigger/${triggerPath}`
  }

  return params
}

export function resolveInitialSubBlockValue(
  subBlock: Pick<SubBlockConfig, 'type' | 'value' | 'defaultValue'> & { id?: string },
  params: Record<string, any>,
  override?: unknown
): unknown {
  const explicitValue = readStoredSubBlockValue(override)
  if (subBlock.id === 'selectedTriggerId' && explicitValue === undefined) {
    return ''
  }

  const resolvedValue =
    explicitValue !== undefined ? explicitValue : resolveConfiguredSubBlockValue(subBlock, params)

  if (resolvedValue !== undefined) {
    return cloneSubBlockValue(resolvedValue)
  }

  if (subBlock.defaultValue !== undefined) {
    return cloneSubBlockValue(subBlock.defaultValue)
  }

  if (subBlock.type === 'table') {
    return []
  }

  return ''
}

export function resolveDisplayedSubBlockValue(
  subBlock: Pick<SubBlockConfig, 'defaultValue' | 'readOnly'>,
  value: unknown
): unknown {
  const explicitValue = readStoredSubBlockValue(value)
  const resolvedDefaultValue =
    typeof subBlock.defaultValue === 'function' ? undefined : subBlock.defaultValue

  const shouldUseDefaultValue =
    resolvedDefaultValue !== undefined &&
    subBlock.readOnly &&
    (explicitValue === null || explicitValue === undefined || explicitValue === '')

  if (shouldUseDefaultValue) {
    return cloneSubBlockValue(resolvedDefaultValue)
  }

  if (explicitValue !== undefined && explicitValue !== null) {
    return explicitValue
  }

  if (resolvedDefaultValue !== undefined) {
    return cloneSubBlockValue(resolvedDefaultValue)
  }

  return explicitValue ?? ''
}
