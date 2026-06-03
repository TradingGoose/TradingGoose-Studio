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
import { defaultLocale, formatTemplate } from './utils'

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
  group?: string
  searchLabel?: string
  rightLabel?: string
}
type BlockEditorOptionOverrides = BlockEditorOptionOverride[]
type BlockEditorOptionOverrideMap = Record<string, Omit<BlockEditorOptionOverride, 'id'>>

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
  options?: BlockEditorOptionOverrides
}
type MergedBlockEditorSubBlockOverride = Omit<BlockEditorSubBlockOverride, 'options'> & {
  options?: BlockEditorOptionOverrideMap
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

const GENERATED_NAME_SUFFIX_PATTERN = /(\s+\d+)$/
const WORKFLOW_INSPECTOR_KEY_PREFIX = 'workflowInspector.'

function resolveInspectorPath(copy: WorkflowInspectorCopy, label: string) {
  if (!label.startsWith(WORKFLOW_INSPECTOR_KEY_PREFIX)) {
    return undefined
  }

  const path = label.split('.').slice(1)
  const resolvedValue = path.reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined
    }

    return (current as Record<string, unknown>)[segment]
  }, copy)

  if (typeof resolvedValue !== 'string') {
    throw new Error(`Missing workflow inspector translation for key "${label}".`)
  }

  return resolvedValue
}

function requireWorkflowLabel(copy: WorkflowLabelCopy, key: string) {
  const value = (copy as Record<string, unknown>)[key]
  if (typeof value !== 'string') {
    throw new Error(`Missing workflow label translation for key "${key}".`)
  }

  return value
}

function getOptionalWorkflowLabel(copy: WorkflowLabelCopy, key: string): string | undefined {
  const value = (copy as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

function requireWorkflowToolbarLabel(copy: WorkflowToolbarCopy, key: string) {
  const value = (copy as Record<string, unknown>)[key]
  if (typeof value !== 'string') {
    throw new Error(`Missing workflow toolbar translation for key "${key}".`)
  }

  return value
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

function requireLocalizedBlockText(
  overrides: Record<string, string>,
  blockType: string,
  field: 'name' | 'description'
) {
  const value = overrides[blockType]
  if (typeof value === 'string') {
    return value
  }

  if (getBlock(blockType)) {
    throw new Error(`Missing localized block ${field} for block type "${blockType}".`)
  }

  return undefined
}

function getCanonicalDefaultBlockName(blockType: string) {
  return (
    (
      getPublicCopy(defaultLocale).workspace.widgets.blockEditor.blockNames as Record<
        string,
        string | undefined
      >
    )[blockType] ??
    getBlock(blockType)?.name ??
    blockType
  )
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getCanonicalGeneratedNameSuffix(
  defaultBlockName: string,
  blockName: string
): string | null {
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
  baseOptions: BlockEditorOptionOverrides | undefined,
  overrideOptions: BlockEditorOptionOverrides | undefined
): BlockEditorOptionOverrideMap | undefined {
  if (!baseOptions && !overrideOptions) {
    return undefined
  }

  const merged: BlockEditorOptionOverrideMap = {}

  for (const option of [...(baseOptions ?? []), ...(overrideOptions ?? [])]) {
    if (typeof option?.id !== 'string' || typeof option.label !== 'string') {
      continue
    }

    const { id, ...override } = option
    merged[id] = override
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

function mergeSubBlockOverrides(
  baseOverride: BlockEditorSubBlockOverride | undefined,
  override: BlockEditorSubBlockOverride | undefined
): MergedBlockEditorSubBlockOverride | undefined {
  if (!baseOverride && !override) {
    return undefined
  }

  return {
    ...baseOverride,
    ...override,
    options: mergeOptionOverrides(baseOverride?.options, override?.options),
  }
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
  key: string
): string {
  return requireWorkflowToolbarLabel(copy, key)
}

export function translateWorkflowLabelWithCopy(
  inspectorCopy: WorkflowInspectorCopy,
  key: string
): string {
  const resolvedPathValue = resolveInspectorPath(inspectorCopy, key)
  if (resolvedPathValue) {
    return resolvedPathValue
  }

  return requireWorkflowLabel(getWorkflowLabelCopyFromInspector(inspectorCopy), key)
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

function localizeWorkflowOption<T extends WorkflowOption>(
  inspectorCopy: WorkflowInspectorCopy,
  option: T,
  optionOverrides?: BlockEditorOptionOverrideMap,
  subBlockId?: string
): T {
  const optionOverride = optionOverrides?.[option.id]
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
    label: triggerOptionLabel ?? optionOverride?.label ?? option.label,
    group: optionOverride?.group ?? option.group,
    searchLabel: optionOverride?.searchLabel ?? option.searchLabel,
    rightLabel: optionOverride?.rightLabel ?? option.rightLabel,
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

  const blockOverride =
    blockType && subBlockId ? getSubBlockOverride(inspectorCopy, blockType, subBlockId) : undefined
  const triggerOverride = getTriggerSubBlockCopyFromInspector(
    inspectorCopy,
    triggerId,
    subBlockId ?? ''
  )
  const optionOverrides = mergeOptionOverrides(blockOverride?.options, triggerOverride?.options)

  if (typeof options === 'function') {
    return () =>
      options().map((option) =>
        localizeWorkflowOption(inspectorCopy, option, optionOverrides, subBlockId)
      )
  }

  return options.map((option) =>
    localizeWorkflowOption(inspectorCopy, option, optionOverrides, subBlockId)
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
  const blockOverride =
    blockType && subBlockId ? getSubBlockOverride(inspectorCopy, blockType, subBlockId) : undefined
  const triggerOverride = getTriggerSubBlockCopyFromInspector(
    inspectorCopy,
    triggerId,
    subBlockId ?? ''
  )
  const optionOverrides = mergeOptionOverrides(blockOverride?.options, triggerOverride?.options)

  return resolvedOptions.map((option) =>
    localizeWorkflowOption(inspectorCopy, option, optionOverrides, subBlockId)
  )
}

export function getLocalizedBlockNameWithCopy(
  inspectorCopy: WorkflowInspectorCopy,
  blockOrType: Pick<BlockConfig, 'type' | 'name'> | string,
  providedName?: string
): string {
  const blockType = typeof blockOrType === 'string' ? blockOrType : blockOrType.type
  const localizedName = requireLocalizedBlockText(
    getBlockNameOverrides(inspectorCopy),
    blockType,
    'name'
  )
  const blockName =
    typeof blockOrType === 'string'
      ? (providedName ?? getBlock(blockOrType)?.name ?? blockOrType)
      : (blockOrType.name ?? providedName ?? getBlock(blockType)?.name ?? blockType)

  return localizedName ?? blockName
}

export function getLocalizedBlockDescriptionWithCopy(
  inspectorCopy: WorkflowInspectorCopy,
  blockOrType: Pick<BlockConfig, 'type' | 'description'> | string,
  providedDescription?: string
): string {
  const blockType = typeof blockOrType === 'string' ? blockOrType : blockOrType.type
  const localizedDescription = requireLocalizedBlockText(
    getBlockDescriptionOverrides(inspectorCopy),
    blockType,
    'description'
  )
  const blockDescription =
    typeof blockOrType === 'string'
      ? (providedDescription ?? getBlock(blockType)?.description ?? '')
      : (blockOrType.description ?? providedDescription ?? getBlock(blockType)?.description ?? '')

  return localizedDescription ?? blockDescription
}

export function getLocalizedBlockLongDescriptionWithCopy(
  inspectorCopy: WorkflowInspectorCopy,
  block: Pick<BlockConfig, 'type' | 'longDescription'> | string,
  providedLongDescription?: string
): string | undefined {
  const blockType = typeof block === 'string' ? block : block.type
  const localizedLongDescription = getBlockLongDescriptionOverrides(inspectorCopy)[blockType]
  if (typeof localizedLongDescription === 'string') {
    return localizedLongDescription
  }

  const longDescription =
    typeof block === 'string'
      ? (providedLongDescription ?? getBlock(blockType)?.longDescription)
      : (block.longDescription ?? providedLongDescription ?? getBlock(blockType)?.longDescription)

  return getBlock(blockType) ? undefined : longDescription
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
  const override = getTriggerOverride(inspectorCopy, triggerId)

  if (typeof override?.name !== 'string' || typeof override?.description !== 'string') {
    throw new Error(`Missing localized trigger metadata for trigger "${triggerId}".`)
  }

  return {
    name: override.name,
    description: override.description,
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
  return (
    getOptionalWorkflowLabel(getWorkflowLabelCopyFromInspector(inspectorCopy), paramId) ??
    label ??
    formatParameterLabel(paramId)
  )
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

  return {
    ...param.uiComponent,
    title: override?.title ?? param.uiComponent.title,
    placeholder: override?.placeholder ?? param.uiComponent.placeholder,
    searchPlaceholder: override?.searchPlaceholder ?? param.uiComponent.searchPlaceholder,
    description: override?.description ?? param.uiComponent.description,
    tooltip: override?.tooltip ?? param.uiComponent.tooltip,
    options: param.uiComponent.options?.map((option) =>
      localizeWorkflowOption(inspectorCopy, option as WorkflowOption, override?.options)
    ),
    columns: override?.columns ?? param.uiComponent.columns,
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

  return {
    ...param,
    description: override?.description ?? param.description,
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
  const workflowLabelTitle = getOptionalWorkflowLabel(
    getWorkflowLabelCopyFromInspector(inspectorCopy),
    config.id
  )
  const defaultValue =
    config.type === 'text'
      ? triggerOverride?.steps?.length
        ? formatTriggerInstructionSteps(triggerOverride.steps)
        : (override?.defaultValue ?? config.defaultValue)
      : config.defaultValue

  return {
    ...config,
    title: override?.title ?? workflowLabelTitle ?? config.title,
    placeholder: override?.placeholder ?? config.placeholder,
    searchPlaceholder: override?.searchPlaceholder ?? config.searchPlaceholder,
    description: override?.description ?? config.description,
    tooltip: override?.tooltip ?? config.tooltip,
    columns: override?.columns ?? config.columns,
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
