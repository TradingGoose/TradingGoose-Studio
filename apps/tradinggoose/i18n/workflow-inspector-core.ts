import { getBlock } from '@/blocks'
import type { BlockConfig, SubBlockConfig, SubBlockOption } from '@/blocks/types'
import {
  formatParameterLabel,
  getToolParametersConfig,
  type ToolParameterConfig,
  type ToolWithParameters,
} from '@/tools/params'
import type { TriggerConfig } from '@/triggers/types'
import { getPublicCopy, type PublicCopy } from './public-copy'
import { formatTemplate } from './template'
import { defaultLocale } from './utils'

export type WorkflowInspectorCopy = Pick<
  PublicCopy['workspace']['widgets'],
  'blockEditor' | 'workflowEditor' | 'workflowLabels'
>
export type WorkflowToolbarCopy = PublicCopy['workspace']['widgets']['workflowToolbar']
export type WorkflowLabelCopy = WorkflowInspectorCopy['workflowLabels']
export type BlockEditorCopy = WorkflowInspectorCopy['blockEditor']
export type WorkflowEditorCopy = WorkflowInspectorCopy['workflowEditor']

export type WorkflowOption = SubBlockOption

type LocalizedBlockMetadata = {
  name: string
  description: string
  longDescription?: string
}

type LocalizedTriggerMetadata = {
  name: string
  description: string
}

type BlockEditorOptionOverride = {
  id: string
  label: string
}

type BlockEditorSubBlockOverride = Partial<
  Pick<
    SubBlockConfig,
    | 'title'
    | 'placeholder'
    | 'searchPlaceholder'
    | 'description'
    | 'tooltip'
    | 'columns'
    | 'defaultValue'
  >
> & {
  options?: BlockEditorOptionOverride[]
}

type BlockEditorTriggerSubBlockOverride = BlockEditorSubBlockOverride & {
  steps?: string[]
}

type BlockEditorToolParameterOverrides = Record<
  string,
  Record<string, Record<string, BlockEditorSubBlockOverride>>
>

type BlockEditorTriggerOverrides = Record<
  string,
  {
    name?: string
    description?: string
    subBlocks?: Record<string, BlockEditorTriggerSubBlockOverride>
  }
>

type TriggerOverride = BlockEditorTriggerOverrides[string]

const TRAILING_COLON_PATTERN = /:\s*$/
const NON_ALPHANUMERIC_PATTERN = /[^A-Za-z0-9]+/g
const LEADING_NON_ALPHA_PATTERN = /^[^A-Za-z]+/
const GENERATED_NAME_SUFFIX_PATTERN = /(\s+\d+)$/

function normalizeWorkflowLabel(label: string) {
  return label.replace(TRAILING_COLON_PATTERN, '').trim()
}

function toStableMessageKey(label: string) {
  const normalized = normalizeWorkflowLabel(label)

  if (!normalized) {
    return normalized
  }

  if (/^[a-z][A-Za-z0-9]*$/.test(normalized)) {
    return normalized
  }

  const tokens = normalized
    .replaceAll('&', ' and ')
    .replaceAll('/', ' ')
    .replaceAll('.', ' ')
    .replaceAll('{{', ' ')
    .replaceAll('}}', ' ')
    .replace(LEADING_NON_ALPHA_PATTERN, '')
    .split(NON_ALPHANUMERIC_PATTERN)
    .filter(Boolean)

  if (tokens.length === 0) {
    return normalized
  }

  return tokens
    .map((token, index) => {
      const lower = token.toLowerCase()
      return index === 0 ? lower : `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`
    })
    .join('')
}

function resolveInspectorPath(copy: WorkflowInspectorCopy, label: string) {
  if (!label.startsWith('workflowInspector.')) {
    return null
  }

  const path = label.split('.').slice(1)
  const resolvedValue = path.reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined
    }

    return (current as Record<string, unknown>)[segment]
  }, copy)

  return typeof resolvedValue === 'string' ? resolvedValue : null
}

function resolveWorkflowLabelKey(copy: WorkflowLabelCopy, label: string) {
  const copyRecord = copy as Record<string, string>
  const normalizedLabel = normalizeWorkflowLabel(label)

  if (typeof copyRecord[normalizedLabel] === 'string') {
    return normalizedLabel
  }

  const stableKey = toStableMessageKey(normalizedLabel)
  if (stableKey && typeof copyRecord[stableKey] === 'string') {
    return stableKey
  }

  return null
}

function resolveWorkflowToolbarKey(copy: WorkflowToolbarCopy, label: string) {
  const copyRecord = copy as Record<string, string>
  const normalizedLabel = normalizeWorkflowLabel(label)

  if (typeof copyRecord[normalizedLabel] === 'string') {
    return normalizedLabel
  }

  const stableKey = toStableMessageKey(normalizedLabel)
  if (stableKey && typeof copyRecord[stableKey] === 'string') {
    return stableKey
  }

  return null
}

function getBlockNameOverrides(copy: WorkflowInspectorCopy): Record<string, string> {
  return copy.blockEditor.blockNames as Record<string, string>
}

function getBlockDescriptionOverrides(copy: WorkflowInspectorCopy): Record<string, string> {
  return copy.blockEditor.blockDescriptions as Record<string, string>
}

function getBlockLongDescriptionOverrides(copy: WorkflowInspectorCopy): Record<string, string> {
  return (copy.blockEditor.blockLongDescriptions ?? {}) as Record<string, string>
}

function getCanonicalDefaultBlockName(blockType: string) {
  return (
    (getPublicCopy(defaultLocale).workspace.widgets.blockEditor.blockNames as Record<
      string,
      string | undefined
    >)[blockType] ??
    getBlock(blockType)?.name ??
    blockType
  )
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getCanonicalGeneratedNameSuffix(defaultBlockName: string, blockName: string): string | null {
  const normalizedDefaultName = defaultBlockName.trim()
  const normalizedName = blockName.trim()
  if (!normalizedDefaultName || !normalizedName) {
    return null
  }

  if (normalizedName === normalizedDefaultName) {
    return ''
  }

  const match = normalizedName.match(
    new RegExp(`^${escapeRegExp(normalizedDefaultName)}${GENERATED_NAME_SUFFIX_PATTERN.source}$`)
  )
  if (match) {
    return match[1] ?? ''
  }

  return null
}

function getBlockSubBlockOverrides(
  copy: WorkflowInspectorCopy
): Record<string, Record<string, BlockEditorSubBlockOverride>> {
  return copy.blockEditor.subBlocks as Record<string, Record<string, BlockEditorSubBlockOverride>>
}

function getToolParameterOverrides(copy: WorkflowInspectorCopy): BlockEditorToolParameterOverrides {
  return (copy.blockEditor.toolParameters ?? {}) as BlockEditorToolParameterOverrides
}

function getTriggerOverrides(copy: WorkflowInspectorCopy): BlockEditorTriggerOverrides {
  return (copy.blockEditor.triggers ?? {}) as BlockEditorTriggerOverrides
}

function mergeOptionOverrides(
  fallbackOptions: BlockEditorOptionOverride[] | undefined,
  localeOptions: BlockEditorOptionOverride[] | undefined
): BlockEditorOptionOverride[] | undefined {
  if (!fallbackOptions && !localeOptions) {
    return undefined
  }

  const merged = new Map<string, BlockEditorOptionOverride>()

  for (const option of fallbackOptions ?? []) {
    if (typeof option?.id !== 'string' || typeof option?.label !== 'string') {
      continue
    }

    merged.set(option.id, option)
  }

  for (const option of localeOptions ?? []) {
    if (typeof option?.id !== 'string' || typeof option?.label !== 'string') {
      continue
    }

    merged.set(option.id, option)
  }

  return [...merged.values()]
}

function getOptionOverrideMap(
  options: BlockEditorOptionOverride[] | undefined
): Map<string, string> | undefined {
  if (!options || options.length === 0) {
    return undefined
  }

  return new Map(
    options
      .filter((option) => typeof option?.id === 'string' && typeof option?.label === 'string')
      .map((option) => [option.id, option.label])
  )
}

function mergeSubBlockOverrides<T extends { options?: BlockEditorOptionOverride[] }>(
  fallbackOverride: T | undefined,
  localeOverride: T | undefined
): T | undefined {
  if (!fallbackOverride && !localeOverride) {
    return undefined
  }

  return {
    ...fallbackOverride,
    ...localeOverride,
    options: mergeOptionOverrides(fallbackOverride?.options, localeOverride?.options),
  } as T
}

function getSubBlockOverride(
  copy: WorkflowInspectorCopy,
  blockType: string | undefined,
  subBlockId: string
): BlockEditorSubBlockOverride | undefined {
  if (!blockType) {
    return undefined
  }

  return getBlockSubBlockOverrides(copy)[blockType]?.[subBlockId]
}

function getTriggerOverride(
  copy: WorkflowInspectorCopy,
  triggerId: string | undefined
): TriggerOverride | undefined {
  if (!triggerId) {
    return undefined
  }

  return getTriggerOverrides(copy)[triggerId]
}

export function getTriggerSubBlockCopyFromInspector(
  copy: WorkflowInspectorCopy,
  triggerId: string | undefined,
  subBlockId: string
): BlockEditorTriggerSubBlockOverride | undefined {
  if (!triggerId) {
    return undefined
  }

  return getTriggerOverrides(copy)[triggerId]?.subBlocks?.[subBlockId]
}

function getToolParameterOverride(
  copy: WorkflowInspectorCopy,
  blockType: string | undefined,
  toolId: string,
  paramId: string
): BlockEditorSubBlockOverride | undefined {
  if (!blockType) {
    return undefined
  }

  return getToolParameterOverrides(copy)[blockType]?.[toolId]?.[paramId]
}

export function getBlockEditorCopyFromInspector(copy: WorkflowInspectorCopy): BlockEditorCopy {
  return copy.blockEditor
}

export function getWorkflowEditorCopyFromInspector(
  copy: WorkflowInspectorCopy
): WorkflowEditorCopy {
  return copy.workflowEditor
}

export function getWorkflowLabelCopyFromInspector(copy: WorkflowInspectorCopy): WorkflowLabelCopy {
  return copy.workflowLabels
}

export function translateWorkflowToolbarLabelWithCopy(
  copy: WorkflowToolbarCopy,
  label: string
): string {
  const key = resolveWorkflowToolbarKey(copy, label)
  return key ? (copy as Record<string, string>)[key] : label
}

export function translateWorkflowLabelWithCopy(
  inspectorCopy: WorkflowInspectorCopy,
  label: string
): string {
  const resolvedPathValue = resolveInspectorPath(inspectorCopy, label)
  if (resolvedPathValue) {
    return resolvedPathValue
  }

  const workflowLabels = getWorkflowLabelCopyFromInspector(inspectorCopy)
  const key = resolveWorkflowLabelKey(workflowLabels, label)

  if (key) {
    return (workflowLabels as Record<string, string>)[key]
  }

  return label
}

export function getToolInputCopyFromInspector(copy: WorkflowInspectorCopy) {
  const blockEditorCopy = getBlockEditorCopyFromInspector(copy)
  const labels = getWorkflowLabelCopyFromInspector(copy)

  return {
    ...blockEditorCopy.toolInput,
    customTools: labels.customTools,
    operation: labels.operation,
    selectOperation: labels.selectOperation,
  }
}

export function getActionBarCopyFromInspector(copy: WorkflowInspectorCopy) {
  return getBlockEditorCopyFromInspector(copy).actionBar
}

export function getMcpToolSelectorCopyFromInspector(copy: WorkflowInspectorCopy) {
  const blockEditorCopy = getBlockEditorCopyFromInspector(copy)
  return {
    ...blockEditorCopy.mcpToolSelector,
    searchTools: blockEditorCopy.toolInput.searchTools,
  }
}

export function getToolbarDisabledReasonFromInspector(
  copy: WorkflowInspectorCopy,
  isOfflineMode: boolean
): string {
  const toolbarCopy = getBlockEditorCopyFromInspector(copy).toolbar
  return isOfflineMode ? toolbarCopy.connectionLostRefresh : toolbarCopy.editPermissionsRequired
}

export function getReadOnlyPreviewCopyFromInspector(copy: WorkflowInspectorCopy) {
  const blockEditorCopy = getBlockEditorCopyFromInspector(copy)

  return {
    ...blockEditorCopy.preview,
    block: translateWorkflowLabelWithCopy(copy, 'block'),
    type: translateWorkflowLabelWithCopy(copy, 'type'),
    none: translateWorkflowLabelWithCopy(copy, 'none'),
    noValuesToDisplay: translateWorkflowLabelWithCopy(copy, 'noValuesToDisplay'),
  }
}

export function getTriggerWarningCopyFromInspector(
  copy: WorkflowInspectorCopy,
  triggerName: string
) {
  const warningCopy = getBlockEditorCopyFromInspector(copy).triggerWarning

  return {
    title: formatTemplate(warningCopy.duplicateTitle, { triggerName }),
    description: formatTemplate(warningCopy.duplicateDescription, { triggerName }),
    dismiss: warningCopy.dismiss,
  }
}

function formatTriggerInstructionSteps(steps: string[]): string {
  return steps
    .map((step, index) => `<div class="mb-3"><strong>${index + 1}.</strong> ${step}</div>`)
    .join('')
}

function resolveWorkflowText(
  inspectorCopy: WorkflowInspectorCopy,
  value: string | undefined,
  explicitKey?: string
) {
  if (explicitKey) {
    return translateWorkflowLabelWithCopy(inspectorCopy, explicitKey)
  }

  return value ? translateWorkflowLabelWithCopy(inspectorCopy, value) : value
}

function localizeWorkflowOption<T extends WorkflowOption>(
  inspectorCopy: WorkflowInspectorCopy,
  option: T,
  optionOverrides?: Map<string, string>,
  subBlockId?: string
): T {
  const optionOverrideLabel = optionOverrides?.get(option.id)
  const triggerOptionLabel =
    subBlockId === 'selectedTriggerId'
      ? getLocalizedTriggerMetadataWithCopy(inspectorCopy, {
          id: option.id,
          name: option.label,
          description: '',
        }).name
      : undefined

  return {
    ...option,
    label:
      triggerOptionLabel ??
      resolveWorkflowText(
        inspectorCopy,
        optionOverrideLabel ?? option.label,
        option.i18n?.labelKey
      ) ??
      option.label,
    group: resolveWorkflowText(inspectorCopy, option.group, option.i18n?.groupKey) ?? option.group,
    searchLabel:
      resolveWorkflowText(inspectorCopy, option.searchLabel, option.i18n?.searchLabelKey) ??
      option.searchLabel,
    rightLabel:
      resolveWorkflowText(inspectorCopy, option.rightLabel, option.i18n?.rightLabelKey) ??
      option.rightLabel,
  }
}

export function localizeWorkflowOptionsWithCopy(
  inspectorCopy: WorkflowInspectorCopy,
  options: SubBlockConfig['options'],
  blockType?: string,
  subBlockId?: string,
  triggerId?: string
): SubBlockConfig['options'] {
  if (!options) {
    return options
  }

  const optionOverrides = mergeSubBlockOverrides(
    blockType && subBlockId ? getSubBlockOverride(inspectorCopy, blockType, subBlockId) : undefined,
    getTriggerSubBlockCopyFromInspector(inspectorCopy, triggerId, subBlockId ?? '')
  )?.options
  const optionOverrideMap = getOptionOverrideMap(optionOverrides)

  if (typeof options === 'function') {
    return () =>
      options().map((option) =>
        localizeWorkflowOption(inspectorCopy, option, optionOverrideMap, subBlockId)
      )
  }

  return options.map((option) =>
    localizeWorkflowOption(inspectorCopy, option, optionOverrideMap, subBlockId)
  )
}

function getLocalizedWorkflowOptionsWithCopy(
  inspectorCopy: WorkflowInspectorCopy,
  options: SubBlockConfig['options'],
  blockType?: string,
  subBlockId?: string,
  triggerId?: string
): WorkflowOption[] {
  if (!options) {
    return []
  }

  const resolvedOptions = typeof options === 'function' ? options() : options
  const optionOverrides = mergeSubBlockOverrides(
    blockType && subBlockId ? getSubBlockOverride(inspectorCopy, blockType, subBlockId) : undefined,
    getTriggerSubBlockCopyFromInspector(inspectorCopy, triggerId, subBlockId ?? '')
  )?.options
  const optionOverrideMap = getOptionOverrideMap(optionOverrides)

  return resolvedOptions.map((option) =>
    localizeWorkflowOption(inspectorCopy, option, optionOverrideMap, subBlockId)
  )
}

export function getLocalizedBlockNameWithCopy(
  inspectorCopy: WorkflowInspectorCopy,
  blockOrType: Pick<BlockConfig, 'type' | 'name'> | string,
  fallbackName?: string
): string {
  const blockType = typeof blockOrType === 'string' ? blockOrType : blockOrType.type
  const blockName =
    typeof blockOrType === 'string'
      ? (fallbackName ?? getBlock(blockOrType)?.name ?? blockOrType)
      : (blockOrType.name ?? fallbackName ?? getBlock(blockType)?.name ?? blockType)

  return getBlockNameOverrides(inspectorCopy)[blockType] ?? blockName
}

export function getLocalizedBlockDescriptionWithCopy(
  inspectorCopy: WorkflowInspectorCopy,
  blockOrType: Pick<BlockConfig, 'type' | 'description'> | string,
  fallbackDescription?: string
): string {
  const blockType = typeof blockOrType === 'string' ? blockOrType : blockOrType.type
  const blockDescription =
    typeof blockOrType === 'string'
      ? (fallbackDescription ?? getBlock(blockType)?.description ?? '')
      : (blockOrType.description ?? fallbackDescription ?? getBlock(blockType)?.description ?? '')

  return getBlockDescriptionOverrides(inspectorCopy)[blockType] ?? blockDescription
}

export function getLocalizedBlockLongDescriptionWithCopy(
  inspectorCopy: WorkflowInspectorCopy,
  block: Pick<BlockConfig, 'type' | 'longDescription'> | string,
  fallbackLongDescription?: string
): string | undefined {
  const blockType = typeof block === 'string' ? block : block.type
  const longDescription =
    typeof block === 'string'
      ? (fallbackLongDescription ?? getBlock(blockType)?.longDescription)
      : (block.longDescription ?? fallbackLongDescription ?? getBlock(blockType)?.longDescription)

  if (!longDescription) {
    return undefined
  }

  return getBlockLongDescriptionOverrides(inspectorCopy)[blockType] ?? longDescription
}

export function getLocalizedBlockMetadataWithCopy(
  inspectorCopy: WorkflowInspectorCopy,
  block: Pick<BlockConfig, 'type' | 'name' | 'description' | 'longDescription'>
): LocalizedBlockMetadata {
  return {
    name: getLocalizedBlockNameWithCopy(inspectorCopy, block),
    description: getLocalizedBlockDescriptionWithCopy(inspectorCopy, block),
    longDescription: getLocalizedBlockLongDescriptionWithCopy(inspectorCopy, block),
  }
}

export function getLocalizedTriggerMetadataWithCopy(
  inspectorCopy: WorkflowInspectorCopy,
  trigger: Pick<TriggerConfig, 'id' | 'name' | 'description'> | string
): LocalizedTriggerMetadata {
  const triggerId = typeof trigger === 'string' ? trigger : trigger.id
  const fallbackName = typeof trigger === 'string' ? triggerId : trigger.name
  const fallbackDescription = typeof trigger === 'string' ? '' : trigger.description
  const override = getTriggerOverride(inspectorCopy, triggerId)

  return {
    name: override?.name ?? fallbackName,
    description: override?.description ?? fallbackDescription,
  }
}

export function getLocalizedDefaultBlockNameWithCopy(
  inspectorCopy: WorkflowInspectorCopy,
  blockType: string,
  blockName?: string
): string {
  const block = getBlock(blockType)
  const defaultBlockName = getCanonicalDefaultBlockName(blockType)
  const localizedDefaultBlockName = getLocalizedBlockNameWithCopy(
    inspectorCopy,
    blockType,
    block?.name ?? defaultBlockName
  )

  if (!blockName) {
    return localizedDefaultBlockName
  }

  const generatedNameSuffix = getCanonicalGeneratedNameSuffix(defaultBlockName, blockName)
  if (generatedNameSuffix !== null) {
    return `${localizedDefaultBlockName}${generatedNameSuffix}`
  }

  return blockName
}

export function getLocalizedToolParameterLabelWithCopy(
  inspectorCopy: WorkflowInspectorCopy,
  paramId: string,
  label?: string
): string {
  return translateWorkflowLabelWithCopy(inspectorCopy, label ?? formatParameterLabel(paramId))
}

function localizeToolUiComponentOptionsWithCopy(
  inspectorCopy: WorkflowInspectorCopy,
  param: ToolParameterConfig,
  blockType?: string,
  toolId?: string
): ToolParameterConfig['uiComponent'] {
  if (!param.uiComponent) {
    return param.uiComponent
  }

  const subBlockId = param.uiComponent.subBlockId ?? param.id
  const subBlockOverride = getSubBlockOverride(inspectorCopy, blockType, subBlockId)
  const toolParameterOverride = toolId
    ? getToolParameterOverride(inspectorCopy, blockType, toolId, param.id)
    : undefined
  const override = mergeSubBlockOverrides(subBlockOverride, toolParameterOverride)
  const optionOverrideMap = getOptionOverrideMap(override?.options)
  const configI18n = param.uiComponent.i18n

  return {
    ...param.uiComponent,
    title: override?.title
      ? translateWorkflowLabelWithCopy(inspectorCopy, override.title)
      : param.uiComponent.title
        ? resolveWorkflowText(inspectorCopy, param.uiComponent.title, configI18n?.titleKey)
        : param.uiComponent.title,
    placeholder: override?.placeholder
      ? translateWorkflowLabelWithCopy(inspectorCopy, override.placeholder)
      : param.uiComponent.placeholder
        ? resolveWorkflowText(
            inspectorCopy,
            param.uiComponent.placeholder,
            configI18n?.placeholderKey
          )
        : param.uiComponent.placeholder,
    searchPlaceholder: override?.searchPlaceholder
      ? translateWorkflowLabelWithCopy(inspectorCopy, override.searchPlaceholder)
      : param.uiComponent.searchPlaceholder
        ? resolveWorkflowText(
            inspectorCopy,
            param.uiComponent.searchPlaceholder,
            configI18n?.searchPlaceholderKey
          )
        : param.uiComponent.searchPlaceholder,
    description: override?.description
      ? translateWorkflowLabelWithCopy(inspectorCopy, override.description)
      : param.uiComponent.description
        ? resolveWorkflowText(
            inspectorCopy,
            param.uiComponent.description,
            configI18n?.descriptionKey
          )
        : param.uiComponent.description,
    tooltip: override?.tooltip
      ? translateWorkflowLabelWithCopy(inspectorCopy, override.tooltip)
      : param.uiComponent.tooltip
        ? resolveWorkflowText(inspectorCopy, param.uiComponent.tooltip, configI18n?.tooltipKey)
        : param.uiComponent.tooltip,
    options: param.uiComponent.options?.map((option) =>
      localizeWorkflowOption(inspectorCopy, option as WorkflowOption, optionOverrideMap)
    ),
    columns: override?.columns
      ? override.columns.map((column) => translateWorkflowLabelWithCopy(inspectorCopy, column))
      : configI18n?.columnKeys
        ? configI18n.columnKeys.map((columnKey) =>
            translateWorkflowLabelWithCopy(inspectorCopy, columnKey)
          )
        : param.uiComponent.columns?.map((column) =>
            translateWorkflowLabelWithCopy(inspectorCopy, column)
          ),
  }
}

export function localizeToolParameterWithCopy(
  inspectorCopy: WorkflowInspectorCopy,
  param: ToolParameterConfig,
  blockType?: string,
  toolId?: string
): ToolParameterConfig {
  const subBlockId = param.uiComponent?.subBlockId ?? param.id
  const subBlockOverride = getSubBlockOverride(inspectorCopy, blockType, subBlockId)
  const toolParameterOverride = toolId
    ? getToolParameterOverride(inspectorCopy, blockType, toolId, param.id)
    : undefined
  const override = mergeSubBlockOverrides(subBlockOverride, toolParameterOverride)
  const configI18n = param.i18n

  return {
    ...param,
    description: override?.description
      ? translateWorkflowLabelWithCopy(inspectorCopy, override.description)
      : param.description
        ? resolveWorkflowText(inspectorCopy, param.description, configI18n?.descriptionKey)
        : undefined,
    uiComponent: localizeToolUiComponentOptionsWithCopy(inspectorCopy, param, blockType, toolId),
  }
}

export function getLocalizedToolParametersConfigWithCopy(
  inspectorCopy: WorkflowInspectorCopy,
  toolId: string,
  blockConfig?: BlockConfig,
  contextValues?: Record<string, any>
): ToolWithParameters | null {
  const config = getToolParametersConfig(toolId, blockConfig, contextValues)
  if (!config) {
    return null
  }

  const blockType = blockConfig?.type

  return {
    ...config,
    allParameters: config.allParameters.map((param) =>
      localizeToolParameterWithCopy(inspectorCopy, param, blockType, toolId)
    ),
    userInputParameters: config.userInputParameters.map((param) =>
      localizeToolParameterWithCopy(inspectorCopy, param, blockType, toolId)
    ),
    requiredParameters: config.requiredParameters.map((param) =>
      localizeToolParameterWithCopy(inspectorCopy, param, blockType, toolId)
    ),
    optionalParameters: config.optionalParameters.map((param) =>
      localizeToolParameterWithCopy(inspectorCopy, param, blockType, toolId)
    ),
  }
}

export function localizeWorkflowSubBlockConfigWithCopy(
  inspectorCopy: WorkflowInspectorCopy,
  config: SubBlockConfig,
  blockType?: string,
  triggerId?: string
): SubBlockConfig {
  const blockOverride = getSubBlockOverride(inspectorCopy, blockType, config.id)
  const triggerOverride = getTriggerSubBlockCopyFromInspector(inspectorCopy, triggerId, config.id)
  const override = mergeSubBlockOverrides(blockOverride, triggerOverride)
  const defaultValue =
    config.type === 'text'
      ? triggerOverride?.steps?.length
        ? formatTriggerInstructionSteps(triggerOverride.steps)
        : (override?.defaultValue ?? config.defaultValue)
      : config.defaultValue

  return {
    ...config,
    title: override?.title
      ? translateWorkflowLabelWithCopy(inspectorCopy, override.title)
      : config.title
        ? resolveWorkflowText(inspectorCopy, config.title, config.i18n?.titleKey)
        : undefined,
    placeholder: override?.placeholder
      ? translateWorkflowLabelWithCopy(inspectorCopy, override.placeholder)
      : config.placeholder
        ? resolveWorkflowText(inspectorCopy, config.placeholder, config.i18n?.placeholderKey)
        : undefined,
    searchPlaceholder: override?.searchPlaceholder
      ? translateWorkflowLabelWithCopy(inspectorCopy, override.searchPlaceholder)
      : config.searchPlaceholder
        ? resolveWorkflowText(
            inspectorCopy,
            config.searchPlaceholder,
            config.i18n?.searchPlaceholderKey
          )
        : undefined,
    description: override?.description
      ? translateWorkflowLabelWithCopy(inspectorCopy, override.description)
      : config.description
        ? resolveWorkflowText(inspectorCopy, config.description, config.i18n?.descriptionKey)
        : config.description,
    tooltip: override?.tooltip
      ? translateWorkflowLabelWithCopy(inspectorCopy, override.tooltip)
      : config.tooltip
        ? resolveWorkflowText(inspectorCopy, config.tooltip, config.i18n?.tooltipKey)
        : config.tooltip,
    columns: override?.columns
      ? override.columns.map((column) => translateWorkflowLabelWithCopy(inspectorCopy, column))
      : config.i18n?.columnKeys
        ? config.i18n.columnKeys.map((columnKey) =>
            translateWorkflowLabelWithCopy(inspectorCopy, columnKey)
          )
        : config.columns?.map((column) => translateWorkflowLabelWithCopy(inspectorCopy, column)),
    defaultValue,
    options: localizeWorkflowOptionsWithCopy(
      inspectorCopy,
      config.options,
      blockType,
      config.id,
      triggerId
    ),
  }
}

export function resolveWorkflowDisplayValueWithCopy(
  inspectorCopy: WorkflowInspectorCopy,
  config: Pick<SubBlockConfig, 'id' | 'options'>,
  value: unknown,
  blockType?: string
): unknown {
  const localizedOptions = getLocalizedWorkflowOptionsWithCopy(
    inspectorCopy,
    config.options,
    blockType,
    config.id
  )

  if (localizedOptions.length === 0) {
    return value
  }

  const localizedOptionMap = new Map(localizedOptions.map((option) => [option.id, option.label]))
  const resolveOptionValue = (optionValue: unknown) =>
    typeof optionValue === 'string'
      ? (localizedOptionMap.get(optionValue) ?? optionValue)
      : optionValue

  if (Array.isArray(value)) {
    return value.map(resolveOptionValue)
  }

  return resolveOptionValue(value)
}

export function formatWorkflowTemplate(template: string, values: Record<string, string | number>) {
  return formatTemplate(template, values)
}
