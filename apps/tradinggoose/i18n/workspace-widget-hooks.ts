'use client'

import { useAppMessages } from './client-messages'
import type { WorkspaceWidgetsMessages } from './message-types'

export type WorkflowInspectorMessages = WorkspaceWidgetsMessages['workflowInspector']
export type WorkflowToolbarMessages = WorkspaceWidgetsMessages['workflowToolbar']
export type WorkflowEditorMessages = WorkspaceWidgetsMessages['workflowEditor']
export type WorkspaceBlockEditorMessages = WorkspaceWidgetsMessages['blockEditor']
export type WorkflowLabelMessages = WorkflowInspectorMessages['workflowLabels']
export type BlockEditorMessages = WorkflowInspectorMessages['blockEditor']
export type WorkflowDropdownMessages = WorkspaceWidgetsMessages['workflowDropdown']
export type SelectorMessages = WorkspaceWidgetsMessages['selector']
export type DeploymentMessages = WorkspaceWidgetsMessages['deployment']
export type WorkflowApiKeyMessages = WorkspaceWidgetsMessages['apiKey']
export type WorkflowOutputSelectMessages = WorkspaceWidgetsMessages['workflowOutputSelect']
export type WorkflowChatMessages = WorkspaceWidgetsMessages['workflowChat']
export type WorkflowConsoleMessages = WorkspaceWidgetsMessages['console']
export type WorkflowVariablesMessages = WorkspaceWidgetsMessages['workflowVariables']
export type McpDropdownMessages = WorkspaceWidgetsMessages['mcpDropdown']

export function useWorkspaceWidgetsMessages(): WorkspaceWidgetsMessages {
  // Any route rendering workspace widgets must provide the 'workspace' namespace in IntlProvider.
  const widgetsMessages = useAppMessages().workspace?.widgets

  if (!widgetsMessages) {
    throw new Error(
      "Missing workspace widget messages in NextIntlClientProvider. Include the 'workspace' namespace when rendering workspace widgets."
    )
  }

  return widgetsMessages
}

export function useWorkflowInspectorMessages(): WorkflowInspectorMessages {
  return useWorkspaceWidgetsMessages().workflowInspector
}

export function useWorkflowToolbarMessages(): WorkflowToolbarMessages {
  return useWorkspaceWidgetsMessages().workflowToolbar
}

export function useWorkflowEditorMessages(): WorkflowEditorMessages {
  return useWorkspaceWidgetsMessages().workflowEditor
}

export function useWorkspaceBlockEditorMessages(): WorkspaceBlockEditorMessages {
  return useWorkspaceWidgetsMessages().blockEditor
}

export function useWorkflowLabelMessages(): WorkflowLabelMessages {
  return useWorkflowInspectorMessages().workflowLabels
}

export function useBlockEditorMessages(): BlockEditorMessages {
  return useWorkflowInspectorMessages().blockEditor
}

export function useWorkflowDropdownMessages(): WorkflowDropdownMessages {
  return useWorkspaceWidgetsMessages().workflowDropdown
}

export function useSelectorMessages(): SelectorMessages {
  return useWorkspaceWidgetsMessages().selector
}

export function useDeploymentMessages(): DeploymentMessages {
  return useWorkspaceWidgetsMessages().deployment
}

export function useWorkflowApiKeyMessages(): WorkflowApiKeyMessages {
  return useWorkspaceWidgetsMessages().apiKey
}

export function useWorkflowOutputSelectMessages(): WorkflowOutputSelectMessages {
  return useWorkspaceWidgetsMessages().workflowOutputSelect
}

export function useWorkflowChatMessages(): WorkflowChatMessages {
  return useWorkspaceWidgetsMessages().workflowChat
}

export function useWorkflowConsoleMessages(): WorkflowConsoleMessages {
  return useWorkspaceWidgetsMessages().console
}

export function useWorkflowVariablesMessages(): WorkflowVariablesMessages {
  return useWorkspaceWidgetsMessages().workflowVariables
}

export function useMcpDropdownMessages(): McpDropdownMessages {
  return useWorkspaceWidgetsMessages().mcpDropdown
}
