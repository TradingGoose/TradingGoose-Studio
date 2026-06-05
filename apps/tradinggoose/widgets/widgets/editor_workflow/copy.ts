'use client'

import { useMemo } from 'react'
import {
  formatWorkflowTemplate,
  getActionBarCopyFromInspector,
  getBlockEditorCopyFromInspector,
  getLocalizedBlockDescriptionWithCopy,
  getLocalizedBlockLongDescriptionWithCopy,
  getLocalizedBlockMetadataWithCopy,
  getLocalizedBlockNameWithCopy,
  getLocalizedDefaultBlockNameWithCopy,
  getLocalizedToolParameterLabelWithCopy,
  getLocalizedToolParametersConfigWithCopy,
  getMcpToolSelectorCopyFromInspector,
  getReadOnlyPreviewCopyFromInspector,
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
} from '@/i18n/workflow-inspector-core'
import {
  useBlockEditorMessages,
  useDeploymentMessages,
  useMcpDropdownMessages,
  useWorkflowApiKeyMessages,
  useWorkflowInspectorMessages,
  useWorkflowOutputSelectMessages,
  useWorkflowToolbarMessages,
  useWorkspaceBlockEditorMessages,
} from '@/i18n/workspace-widget-hooks'

export function useWorkflowEditorCopy() {
  return getWorkflowEditorCopyFromInspector(useWorkflowInspectorMessages())
}

export function useWorkflowInspectorCopy() {
  return useWorkflowInspectorMessages()
}

export function useDeploymentCopy() {
  return useDeploymentMessages()
}

export function useWorkflowApiKeyCopy() {
  return useWorkflowApiKeyMessages()
}

export function useWorkflowBlockEditorCopy() {
  return useBlockEditorMessages()
}

export function useWorkflowOutputSelectCopy() {
  return useWorkflowOutputSelectMessages()
}

export function useWorkspaceBlockEditorCopy() {
  return useWorkspaceBlockEditorMessages()
}

export function useMcpDropdownCopy() {
  return useMcpDropdownMessages()
}

export function useWorkflowI18n() {
  const inspectorCopy = useWorkflowInspectorMessages()
  const toolbarCopy = useWorkflowToolbarMessages()

  return useMemo(
    () => ({
      workflowInspectorCopy: inspectorCopy,
      workflowEditorCopy: getWorkflowEditorCopyFromInspector(inspectorCopy),
      workflowLabelsCopy: getWorkflowLabelCopyFromInspector(inspectorCopy),
      workflowToolbarCopy: toolbarCopy,
      blockEditorCopy: getBlockEditorCopyFromInspector(inspectorCopy),
      actionBarCopy: getActionBarCopyFromInspector(inspectorCopy),
      toolInputCopy: getToolInputCopyFromInspector(inspectorCopy),
      mcpToolSelectorCopy: getMcpToolSelectorCopyFromInspector(inspectorCopy),
      readOnlyPreviewCopy: getReadOnlyPreviewCopyFromInspector(inspectorCopy),
      translateWorkflowLabel: (key: string) => translateWorkflowLabelWithCopy(inspectorCopy, key),
      translateWorkflowToolbarLabel: (key: string) =>
        translateWorkflowToolbarLabelWithCopy(toolbarCopy, key),
      getToolbarDisabledReason: (isOfflineMode: boolean) =>
        getToolbarDisabledReasonFromInspector(inspectorCopy, isOfflineMode),
      getTriggerWarningCopy: (triggerName: string) =>
        getTriggerWarningCopyFromInspector(inspectorCopy, triggerName),
      getLocalizedBlockName: (
        blockOrType: Parameters<typeof getLocalizedBlockNameWithCopy>[1],
        providedName?: string
      ) => getLocalizedBlockNameWithCopy(inspectorCopy, blockOrType, providedName),
      getLocalizedBlockDescription: (
        blockOrType: Parameters<typeof getLocalizedBlockDescriptionWithCopy>[1],
        providedDescription?: string
      ) => getLocalizedBlockDescriptionWithCopy(inspectorCopy, blockOrType, providedDescription),
      getLocalizedBlockLongDescription: (
        blockOrType: Parameters<typeof getLocalizedBlockLongDescriptionWithCopy>[1],
        providedDescription?: string
      ) =>
        getLocalizedBlockLongDescriptionWithCopy(inspectorCopy, blockOrType, providedDescription),
      getLocalizedBlockMetadata: (block: Parameters<typeof getLocalizedBlockMetadataWithCopy>[1]) =>
        getLocalizedBlockMetadataWithCopy(inspectorCopy, block),
      getLocalizedDefaultBlockName: (blockType: string, blockName?: string) =>
        getLocalizedDefaultBlockNameWithCopy(inspectorCopy, blockType, blockName),
      getLocalizedToolParameterLabel: (paramId: string, label?: string) =>
        getLocalizedToolParameterLabelWithCopy(inspectorCopy, paramId, label),
      localizeToolParameter: (
        param: Parameters<typeof localizeToolParameterWithCopy>[1],
        blockType?: string,
        toolId?: string
      ) => localizeToolParameterWithCopy(inspectorCopy, param, blockType, toolId),
      getLocalizedToolParametersConfig: (
        toolId: string,
        blockConfig?: Parameters<typeof getLocalizedToolParametersConfigWithCopy>[2],
        contextValues?: Parameters<typeof getLocalizedToolParametersConfigWithCopy>[3]
      ) =>
        getLocalizedToolParametersConfigWithCopy(inspectorCopy, toolId, blockConfig, contextValues),
      localizeWorkflowOptions: (
        options: Parameters<typeof localizeWorkflowOptionsWithCopy>[1],
        blockType?: string,
        subBlockId?: string,
        triggerId?: string
      ) =>
        localizeWorkflowOptionsWithCopy(inspectorCopy, options, blockType, subBlockId, triggerId),
      localizeWorkflowSubBlockConfig: (
        config: Parameters<typeof localizeWorkflowSubBlockConfigWithCopy>[1],
        blockType?: string,
        triggerId?: string
      ) => localizeWorkflowSubBlockConfigWithCopy(inspectorCopy, config, blockType, triggerId),
      resolveWorkflowDisplayValue: (
        config: Parameters<typeof resolveWorkflowDisplayValueWithCopy>[1],
        value: Parameters<typeof resolveWorkflowDisplayValueWithCopy>[2],
        blockType?: string
      ) => resolveWorkflowDisplayValueWithCopy(inspectorCopy, config, value, blockType),
      formatWorkflowTemplate,
    }),
    [inspectorCopy, toolbarCopy]
  )
}
