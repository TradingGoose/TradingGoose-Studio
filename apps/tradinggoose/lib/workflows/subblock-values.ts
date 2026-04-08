import type { SubBlockConfig } from '@/blocks/types'
import { getBaseUrl } from '@/lib/urls/utils'

type SubBlockStateLike = Record<string, { value?: unknown } | undefined>

export function readStoredSubBlockValue(value: unknown): unknown {
  return typeof value === 'function' ? undefined : value
}

export function resolveConfiguredSubBlockValue(
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
}): Record<string, any> {
  const { blockId, subBlockConfigs, subBlocks } = args
  const params: Record<string, any> = {}

  for (const [subBlockId, subBlockState] of Object.entries(subBlocks ?? {})) {
    const resolvedValue = readStoredSubBlockValue(subBlockState?.value)
    if (resolvedValue !== undefined) {
      params[subBlockId] = resolvedValue
    }
  }

  if (
    params.selectedTriggerId === undefined ||
    params.selectedTriggerId === null ||
    params.selectedTriggerId === ''
  ) {
    const selectedTriggerConfig = subBlockConfigs.find((subBlock) => subBlock.id === 'selectedTriggerId')
    const configuredTriggerId = selectedTriggerConfig
      ? resolveConfiguredSubBlockValue(selectedTriggerConfig, params)
      : undefined

    if (typeof configuredTriggerId === 'string' && configuredTriggerId.trim().length > 0) {
      params.selectedTriggerId = configuredTriggerId
    }
  }

  if (
    (params.triggerId === undefined || params.triggerId === null || params.triggerId === '') &&
    typeof params.selectedTriggerId === 'string' &&
    params.selectedTriggerId.trim().length > 0
  ) {
    params.triggerId = params.selectedTriggerId
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
  subBlock: Pick<SubBlockConfig, 'type' | 'value' | 'defaultValue'>,
  params: Record<string, any>,
  override?: unknown
): unknown {
  const explicitValue = readStoredSubBlockValue(override)
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
