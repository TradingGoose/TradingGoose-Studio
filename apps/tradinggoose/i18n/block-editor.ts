import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import type { ToolParameterConfig } from '@/tools/params'
import type { TriggerConfig } from '@/triggers/types'
import { getPublicCopy } from './public-copy'
import type { LocaleCode } from './utils'
import { getWorkflowInspectorCopy } from './workflow-inspector'
import {
  formatWorkflowTemplate as formatWorkflowTemplateWithCopy,
  getActionBarCopyFromInspector,
  getBlockEditorCopyFromInspector,
  getLocalizedBlockDescriptionWithCopy,
  getLocalizedBlockLongDescriptionWithCopy,
  getLocalizedBlockMetadataWithCopy,
  getLocalizedBlockNameWithCopy,
  getLocalizedDefaultBlockNameWithCopy,
  getLocalizedUniqueBlockNameWithCopy,
  getLocalizedTriggerMetadataWithCopy,
  getLocalizedToolParameterLabelWithCopy,
  getLocalizedToolParametersConfigWithCopy,
  getMcpToolSelectorCopyFromInspector,
  getReadOnlyPreviewCopyFromInspector,
  getTriggerSubBlockCopyFromInspector,
  getToolbarDisabledReasonFromInspector,
  getToolInputCopyFromInspector,
  getTriggerWarningCopyFromInspector,
  getWorkflowEditorCopyFromInspector,
  getWorkflowLabelCopyFromInspector,
  localizeToolParameterWithCopy,
  localizeWorkflowOptionsWithCopy,
  localizeWorkflowSubBlockConfigWithCopy,
  resolveWorkflowDisplayValueWithCopy,
  translateWorkflowLabelWithCopy,
  translateWorkflowToolbarLabelWithCopy,
  type WorkflowOption,
} from './workflow-inspector-core'

export type { LocaleCode } from './utils'
export type { WorkflowOption } from './workflow-inspector-core'

function getInspectorCopy(locale: LocaleCode) {
  return getWorkflowInspectorCopy(locale)
}

export function getBlockEditorCopy(locale: LocaleCode) {
  return getBlockEditorCopyFromInspector(getInspectorCopy(locale))
}

export function getTriggerSubBlockCopy(
  locale: LocaleCode,
  triggerId: string,
  subBlockId: string
) {
  return getTriggerSubBlockCopyFromInspector(getInspectorCopy(locale), triggerId, subBlockId)
}

export function localizeWorkflowOptions(
  locale: LocaleCode,
  options: SubBlockConfig['options'],
  blockType?: string,
  subBlockId?: string,
  triggerId?: string
) {
  return localizeWorkflowOptionsWithCopy(
    getInspectorCopy(locale),
    options,
    blockType,
    subBlockId,
    triggerId
  )
}

export function getWorkflowToolbarCopy(locale: LocaleCode) {
  return getPublicCopy(locale).workspace.widgets.workflowToolbar
}

export function getWorkflowLabelCopy(locale: LocaleCode) {
  return getWorkflowLabelCopyFromInspector(getInspectorCopy(locale))
}

export function getToolInputCopy(locale: LocaleCode) {
  return getToolInputCopyFromInspector(getInspectorCopy(locale))
}

export function getActionBarCopy(locale: LocaleCode) {
  return getActionBarCopyFromInspector(getInspectorCopy(locale))
}

export function getWorkflowEditorCopy(locale: LocaleCode) {
  return getWorkflowEditorCopyFromInspector(getInspectorCopy(locale))
}

export function getMcpToolSelectorCopy(locale: LocaleCode) {
  return getMcpToolSelectorCopyFromInspector(getInspectorCopy(locale))
}

export function getToolbarDisabledReason(locale: LocaleCode, isOfflineMode: boolean): string {
  return getToolbarDisabledReasonFromInspector(getInspectorCopy(locale), isOfflineMode)
}

export function getReadOnlyPreviewCopy(locale: LocaleCode) {
  return getReadOnlyPreviewCopyFromInspector(getInspectorCopy(locale))
}

export function getTriggerWarningCopy(locale: LocaleCode, triggerName: string) {
  return getTriggerWarningCopyFromInspector(getInspectorCopy(locale), triggerName)
}

export function getLocalizedBlockName(
  locale: LocaleCode,
  blockOrType: Pick<BlockConfig, 'type' | 'name'> | string,
  fallbackName?: string
): string {
  return getLocalizedBlockNameWithCopy(getInspectorCopy(locale), blockOrType, fallbackName)
}

export function getLocalizedBlockDescription(
  locale: LocaleCode,
  blockOrType: Pick<BlockConfig, 'type' | 'description'> | string,
  fallbackDescription?: string
): string {
  return getLocalizedBlockDescriptionWithCopy(
    getInspectorCopy(locale),
    blockOrType,
    fallbackDescription
  )
}

export function getLocalizedBlockMetadata(
  locale: LocaleCode,
  block: Pick<BlockConfig, 'type' | 'name' | 'description' | 'longDescription'>
) {
  return getLocalizedBlockMetadataWithCopy(getInspectorCopy(locale), block)
}

export function getLocalizedTriggerMetadata(
  locale: LocaleCode,
  trigger: Pick<TriggerConfig, 'id' | 'name' | 'description'> | string
) {
  return getLocalizedTriggerMetadataWithCopy(getInspectorCopy(locale), trigger)
}

export function getLocalizedBlockLongDescription(
  locale: LocaleCode,
  block: Pick<BlockConfig, 'type' | 'longDescription'> | string,
  fallbackLongDescription?: string
) {
  return getLocalizedBlockLongDescriptionWithCopy(
    getInspectorCopy(locale),
    block,
    fallbackLongDescription
  )
}

export function getLocalizedDefaultBlockName(
  locale: LocaleCode,
  blockType: string,
  blockName?: string
): string {
  return getLocalizedDefaultBlockNameWithCopy(getInspectorCopy(locale), blockType, blockName)
}

export function getLocalizedUniqueBlockName(
  locale: LocaleCode,
  blockType: string,
  existingBlocks: Record<string, { type?: string; name?: string }>,
  blockName?: string
): string {
  return getLocalizedUniqueBlockNameWithCopy(
    getInspectorCopy(locale),
    blockType,
    existingBlocks,
    blockName
  )
}

export function getLocalizedToolParameterLabel(
  locale: LocaleCode,
  paramId: string,
  label?: string
): string {
  return getLocalizedToolParameterLabelWithCopy(getInspectorCopy(locale), paramId, label)
}

export function localizeToolParameter(
  locale: LocaleCode,
  param: ToolParameterConfig,
  blockType?: string,
  toolId?: string
): ToolParameterConfig {
  return localizeToolParameterWithCopy(getInspectorCopy(locale), param, blockType, toolId)
}

export function getLocalizedToolParametersConfig(
  locale: LocaleCode,
  toolId: string,
  blockConfig?: BlockConfig,
  contextValues?: Record<string, any>
) {
  return getLocalizedToolParametersConfigWithCopy(
    getInspectorCopy(locale),
    toolId,
    blockConfig,
    contextValues
  )
}

export function translateWorkflowToolbarLabel(locale: LocaleCode, label: string): string {
  return translateWorkflowToolbarLabelWithCopy(getWorkflowToolbarCopy(locale), label)
}

export function translateWorkflowLabel(locale: LocaleCode, label: string): string {
  return translateWorkflowLabelWithCopy(getInspectorCopy(locale), label)
}

export function localizeWorkflowSubBlockConfig(
  locale: LocaleCode,
  config: SubBlockConfig,
  blockType?: string,
  triggerId?: string
): SubBlockConfig {
  return localizeWorkflowSubBlockConfigWithCopy(
    getInspectorCopy(locale),
    config,
    blockType,
    triggerId
  )
}

export function resolveWorkflowDisplayValue(
  locale: LocaleCode,
  config: Pick<SubBlockConfig, 'id' | 'options'>,
  value: unknown,
  blockType?: string
): unknown {
  return resolveWorkflowDisplayValueWithCopy(getInspectorCopy(locale), config, value, blockType)
}

export function formatWorkflowTemplate(template: string, values: Record<string, string | number>) {
  return formatWorkflowTemplateWithCopy(template, values)
}
