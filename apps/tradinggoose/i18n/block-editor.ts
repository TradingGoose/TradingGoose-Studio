import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import type { ToolParameterConfig } from '@/tools/params'
import type { TriggerConfig } from '@/triggers/types'
import { getPublicCopy } from './public-copy'
import type { LocaleCode } from './utils'
import {
  formatWorkflowTemplate as formatWorkflowTemplateWithCopy,
  getActionBarCopyFromInspector,
  getBlockEditorCopyFromInspector,
  getLocalizedBlockDescriptionWithCopy,
  getLocalizedBlockLongDescriptionWithCopy,
  getLocalizedBlockMetadataWithCopy,
  getLocalizedBlockNameWithCopy,
  getLocalizedDefaultBlockNameWithCopy,
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
  type WorkflowInspectorCopy,
  type WorkflowOption,
} from './workflow-inspector-core'

export type { LocaleCode } from './utils'
export type { WorkflowOption } from './workflow-inspector-core'

export function getWorkflowInspectorCopy(locale: LocaleCode): WorkflowInspectorCopy {
  return getPublicCopy(locale).workspace.widgets
}

export function getBlockEditorCopy(locale: LocaleCode) {
  return getBlockEditorCopyFromInspector(getWorkflowInspectorCopy(locale))
}

export function getTriggerSubBlockCopy(
  locale: LocaleCode,
  triggerId: string,
  subBlockId: string
) {
  return getTriggerSubBlockCopyFromInspector(getWorkflowInspectorCopy(locale), triggerId, subBlockId)
}

export function localizeWorkflowOptions(
  locale: LocaleCode,
  options: SubBlockConfig['options'],
  blockType?: string,
  subBlockId?: string,
  triggerId?: string
) {
  return localizeWorkflowOptionsWithCopy(
    getWorkflowInspectorCopy(locale),
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
  return getWorkflowLabelCopyFromInspector(getWorkflowInspectorCopy(locale))
}

export function getToolInputCopy(locale: LocaleCode) {
  return getToolInputCopyFromInspector(getWorkflowInspectorCopy(locale))
}

export function getActionBarCopy(locale: LocaleCode) {
  return getActionBarCopyFromInspector(getWorkflowInspectorCopy(locale))
}

export function getWorkflowEditorCopy(locale: LocaleCode) {
  return getWorkflowEditorCopyFromInspector(getWorkflowInspectorCopy(locale))
}

export function getMcpToolSelectorCopy(locale: LocaleCode) {
  return getMcpToolSelectorCopyFromInspector(getWorkflowInspectorCopy(locale))
}

export function getToolbarDisabledReason(locale: LocaleCode, isOfflineMode: boolean): string {
  return getToolbarDisabledReasonFromInspector(getWorkflowInspectorCopy(locale), isOfflineMode)
}

export function getReadOnlyPreviewCopy(locale: LocaleCode) {
  return getReadOnlyPreviewCopyFromInspector(getWorkflowInspectorCopy(locale))
}

export function getTriggerWarningCopy(locale: LocaleCode, triggerName: string) {
  return getTriggerWarningCopyFromInspector(getWorkflowInspectorCopy(locale), triggerName)
}

export function getLocalizedBlockName(
  locale: LocaleCode,
  blockOrType: Pick<BlockConfig, 'type' | 'name'> | string,
  fallbackName?: string
): string {
  return getLocalizedBlockNameWithCopy(getWorkflowInspectorCopy(locale), blockOrType, fallbackName)
}

export function getLocalizedBlockDescription(
  locale: LocaleCode,
  blockOrType: Pick<BlockConfig, 'type' | 'description'> | string,
  fallbackDescription?: string
): string {
  return getLocalizedBlockDescriptionWithCopy(
    getWorkflowInspectorCopy(locale),
    blockOrType,
    fallbackDescription
  )
}

export function getLocalizedBlockMetadata(
  locale: LocaleCode,
  block: Pick<BlockConfig, 'type' | 'name' | 'description' | 'longDescription'>
) {
  return getLocalizedBlockMetadataWithCopy(getWorkflowInspectorCopy(locale), block)
}

export function getLocalizedTriggerMetadata(
  locale: LocaleCode,
  trigger: Pick<TriggerConfig, 'id' | 'name' | 'description'> | string
) {
  return getLocalizedTriggerMetadataWithCopy(getWorkflowInspectorCopy(locale), trigger)
}

export function getLocalizedBlockLongDescription(
  locale: LocaleCode,
  block: Pick<BlockConfig, 'type' | 'longDescription'> | string,
  fallbackLongDescription?: string
) {
  return getLocalizedBlockLongDescriptionWithCopy(
    getWorkflowInspectorCopy(locale),
    block,
    fallbackLongDescription
  )
}

export function getLocalizedDefaultBlockName(
  locale: LocaleCode,
  blockType: string,
  blockName?: string
): string {
  return getLocalizedDefaultBlockNameWithCopy(getWorkflowInspectorCopy(locale), blockType, blockName)
}

export function getLocalizedToolParameterLabel(
  locale: LocaleCode,
  paramId: string,
  label?: string
): string {
  return getLocalizedToolParameterLabelWithCopy(getWorkflowInspectorCopy(locale), paramId, label)
}

export function localizeToolParameter(
  locale: LocaleCode,
  param: ToolParameterConfig,
  blockType?: string,
  toolId?: string
): ToolParameterConfig {
  return localizeToolParameterWithCopy(getWorkflowInspectorCopy(locale), param, blockType, toolId)
}

export function getLocalizedToolParametersConfig(
  locale: LocaleCode,
  toolId: string,
  blockConfig?: BlockConfig,
  contextValues?: Record<string, any>
) {
  return getLocalizedToolParametersConfigWithCopy(
    getWorkflowInspectorCopy(locale),
    toolId,
    blockConfig,
    contextValues
  )
}

export function translateWorkflowToolbarLabel(locale: LocaleCode, label: string): string {
  return translateWorkflowToolbarLabelWithCopy(getWorkflowToolbarCopy(locale), label)
}

export function translateWorkflowLabel(locale: LocaleCode, label: string): string {
  return translateWorkflowLabelWithCopy(getWorkflowInspectorCopy(locale), label)
}

export function localizeWorkflowSubBlockConfig(
  locale: LocaleCode,
  config: SubBlockConfig,
  blockType?: string,
  triggerId?: string
): SubBlockConfig {
  return localizeWorkflowSubBlockConfigWithCopy(
    getWorkflowInspectorCopy(locale),
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
  return resolveWorkflowDisplayValueWithCopy(
    getWorkflowInspectorCopy(locale),
    config,
    value,
    blockType
  )
}

export function formatWorkflowTemplate(template: string, values: Record<string, string | number>) {
  return formatWorkflowTemplateWithCopy(template, values)
}
