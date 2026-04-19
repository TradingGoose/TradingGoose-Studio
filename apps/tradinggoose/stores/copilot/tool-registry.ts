import { isToolId, type ToolId } from '@/lib/copilot/registry'
import {
  type BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
  type ClientToolDisplay,
  type ClientToolExecutionContext,
} from '@/lib/copilot/tools/client/base-tool'
import { GetBlocksAndToolsClientTool } from '@/lib/copilot/tools/client/blocks/get-blocks-and-tools'
import { GetBlocksMetadataClientTool } from '@/lib/copilot/tools/client/blocks/get-blocks-metadata'
import { GetTriggerBlocksClientTool } from '@/lib/copilot/tools/client/blocks/get-trigger-blocks'
import {
  CreateCustomToolClientTool,
  CreateIndicatorClientTool,
  CreateMcpServerClientTool,
  CreateSkillClientTool,
  EditCustomToolClientTool,
  EditIndicatorClientTool,
  EditMcpServerClientTool,
  EditSkillClientTool,
  GetCustomToolClientTool,
  GetIndicatorClientTool,
  GetMcpServerClientTool,
  GetSkillClientTool,
  ListCustomToolsClientTool,
  ListIndicatorsClientTool,
  ListMcpServersClientTool,
  ListSkillsClientTool,
  RenameCustomToolClientTool,
  RenameIndicatorClientTool,
  RenameMcpServerClientTool,
  RenameSkillClientTool,
} from '@/lib/copilot/tools/client/entities/entity-document-tools'
import { ListGDriveFilesClientTool } from '@/lib/copilot/tools/client/gdrive/list-files'
import { ReadGDriveFileClientTool } from '@/lib/copilot/tools/client/gdrive/read-file'
import { GDriveRequestAccessClientTool } from '@/lib/copilot/tools/client/google/gdrive-request-access'
import { GetIndicatorCatalogClientTool } from '@/lib/copilot/tools/client/indicators/get-indicator-catalog'
import { GetIndicatorMetadataClientTool } from '@/lib/copilot/tools/client/indicators/get-indicator-metadata'
import { KnowledgeBaseClientTool } from '@/lib/copilot/tools/client/knowledge/knowledge-base'
import { getClientTool, registerClientTool } from '@/lib/copilot/tools/client/manager'
import { EditMonitorClientTool } from '@/lib/copilot/tools/client/monitor/edit-monitor'
import { GetMonitorClientTool } from '@/lib/copilot/tools/client/monitor/get-monitor'
import { ListMonitorsClientTool } from '@/lib/copilot/tools/client/monitor/list-monitors'
import { CheckoffTodoClientTool } from '@/lib/copilot/tools/client/other/checkoff-todo'
import { MakeApiRequestClientTool } from '@/lib/copilot/tools/client/other/make-api-request'
import { MarkTodoInProgressClientTool } from '@/lib/copilot/tools/client/other/mark-todo-in-progress'
import { OAuthRequestAccessClientTool } from '@/lib/copilot/tools/client/other/oauth-request-access'
import { PlanClientTool } from '@/lib/copilot/tools/client/other/plan'
import { SearchDocumentationClientTool } from '@/lib/copilot/tools/client/other/search-documentation'
import { SearchOnlineClientTool } from '@/lib/copilot/tools/client/other/search-online'
import { SleepClientTool } from '@/lib/copilot/tools/client/other/sleep'
import { GetCredentialsClientTool } from '@/lib/copilot/tools/client/user/get-credentials'
import { GetEnvironmentVariablesClientTool } from '@/lib/copilot/tools/client/user/get-environment-variables'
import { GetOAuthCredentialsClientTool } from '@/lib/copilot/tools/client/user/get-oauth-credentials'
import { SetEnvironmentVariablesClientTool } from '@/lib/copilot/tools/client/user/set-environment-variables'
import { CheckDeploymentStatusClientTool } from '@/lib/copilot/tools/client/workflow/check-deployment-status'
import { CreateWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/create-workflow'
import { DeployWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/deploy-workflow'
import { EditWorkflowBlockClientTool } from '@/lib/copilot/tools/client/workflow/edit-workflow-block'
import { EditWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/edit-workflow'
import { GetBlockOutputsClientTool } from '@/lib/copilot/tools/client/workflow/get-block-outputs'
import { GetBlockUpstreamReferencesClientTool } from '@/lib/copilot/tools/client/workflow/get-block-upstream-references'
import { GetGlobalWorkflowVariablesClientTool } from '@/lib/copilot/tools/client/workflow/get-global-workflow-variables'
import { GetUserWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/get-user-workflow'
import { GetWorkflowConsoleClientTool } from '@/lib/copilot/tools/client/workflow/get-workflow-console'
import { GetWorkflowFromNameClientTool } from '@/lib/copilot/tools/client/workflow/get-workflow-from-name'
import { ListUserWorkflowsClientTool } from '@/lib/copilot/tools/client/workflow/list-user-workflows'
import { RenameWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/rename-workflow'
import { RunWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/run-workflow'
import { SetGlobalWorkflowVariablesClientTool } from '@/lib/copilot/tools/client/workflow/set-global-workflow-variables'
import { createLogger } from '@/lib/logs/console/logger'
import type { CopilotToolExecutionProvenance } from '@/stores/copilot/types'

const logger = createLogger('CopilotToolRegistry')

type ToolExecutionKind = 'client' | 'server'

type ClientToolCtor = {
  new (toolCallId: string): BaseClientTool
  metadata: BaseClientToolMetadata
}

interface CopilotToolDefinition {
  execution: ToolExecutionKind
  metadata: BaseClientToolMetadata
  createInstance?: (toolCallId: string) => BaseClientTool
}

function clientTool(Ctor: ClientToolCtor): CopilotToolDefinition {
  return {
    execution: 'client',
    metadata: Ctor.metadata,
    createInstance: (toolCallId) => new Ctor(toolCallId),
  }
}

function serverTool(Ctor: Pick<ClientToolCtor, 'metadata'>): CopilotToolDefinition {
  return {
    execution: 'server',
    metadata: Ctor.metadata,
  }
}

function cloneArgs(args: Record<string, any> | undefined): Record<string, any> {
  if (!args || typeof args !== 'object') {
    return {}
  }

  return { ...args }
}

const COPILOT_TOOL_REGISTRY: Record<ToolId, CopilotToolDefinition> = {
  run_workflow: clientTool(RunWorkflowClientTool),
  get_workflow_console: serverTool(GetWorkflowConsoleClientTool),
  get_blocks_and_tools: serverTool(GetBlocksAndToolsClientTool),
  get_blocks_metadata: serverTool(GetBlocksMetadataClientTool),
  get_indicator_catalog: serverTool(GetIndicatorCatalogClientTool),
  get_indicator_metadata: serverTool(GetIndicatorMetadataClientTool),
  get_trigger_blocks: serverTool(GetTriggerBlocksClientTool),
  search_online: serverTool(SearchOnlineClientTool),
  search_documentation: serverTool(SearchDocumentationClientTool),
  get_environment_variables: serverTool(GetEnvironmentVariablesClientTool),
  set_environment_variables: serverTool(SetEnvironmentVariablesClientTool),
  get_credentials: serverTool(GetCredentialsClientTool),
  knowledge_base: clientTool(KnowledgeBaseClientTool),
  list_custom_tools: clientTool(ListCustomToolsClientTool),
  get_custom_tool: clientTool(GetCustomToolClientTool),
  create_custom_tool: clientTool(CreateCustomToolClientTool),
  edit_custom_tool: clientTool(EditCustomToolClientTool),
  rename_custom_tool: clientTool(RenameCustomToolClientTool),
  list_monitors: clientTool(ListMonitorsClientTool),
  get_monitor: clientTool(GetMonitorClientTool),
  edit_monitor: clientTool(EditMonitorClientTool),
  list_indicators: clientTool(ListIndicatorsClientTool),
  get_indicator: clientTool(GetIndicatorClientTool),
  create_indicator: clientTool(CreateIndicatorClientTool),
  edit_indicator: clientTool(EditIndicatorClientTool),
  rename_indicator: clientTool(RenameIndicatorClientTool),
  list_skills: clientTool(ListSkillsClientTool),
  get_skill: clientTool(GetSkillClientTool),
  create_skill: clientTool(CreateSkillClientTool),
  edit_skill: clientTool(EditSkillClientTool),
  rename_skill: clientTool(RenameSkillClientTool),
  list_mcp_servers: clientTool(ListMcpServersClientTool),
  get_mcp_server: clientTool(GetMcpServerClientTool),
  create_mcp_server: clientTool(CreateMcpServerClientTool),
  edit_mcp_server: clientTool(EditMcpServerClientTool),
  rename_mcp_server: clientTool(RenameMcpServerClientTool),
  list_gdrive_files: serverTool(ListGDriveFilesClientTool),
  read_gdrive_file: serverTool(ReadGDriveFileClientTool),
  get_oauth_credentials: serverTool(GetOAuthCredentialsClientTool),
  make_api_request: serverTool(MakeApiRequestClientTool),
  plan: clientTool(PlanClientTool),
  checkoff_todo: clientTool(CheckoffTodoClientTool),
  mark_todo_in_progress: clientTool(MarkTodoInProgressClientTool),
  gdrive_request_access: clientTool(GDriveRequestAccessClientTool),
  oauth_request_access: clientTool(OAuthRequestAccessClientTool),
  create_workflow: clientTool(CreateWorkflowClientTool),
  edit_workflow: clientTool(EditWorkflowClientTool),
  edit_workflow_block: clientTool(EditWorkflowBlockClientTool),
  rename_workflow: clientTool(RenameWorkflowClientTool),
  get_user_workflow: clientTool(GetUserWorkflowClientTool),
  list_user_workflows: clientTool(ListUserWorkflowsClientTool),
  get_workflow_from_name: clientTool(GetWorkflowFromNameClientTool),
  get_global_workflow_variables: clientTool(GetGlobalWorkflowVariablesClientTool),
  set_global_workflow_variables: clientTool(SetGlobalWorkflowVariablesClientTool),
  deploy_workflow: clientTool(DeployWorkflowClientTool),
  check_deployment_status: clientTool(CheckDeploymentStatusClientTool),
  sleep: clientTool(SleepClientTool),
  get_block_outputs: clientTool(GetBlockOutputsClientTool),
  get_block_upstream_references: clientTool(GetBlockUpstreamReferencesClientTool),
}

export function createExecutionContext(params: {
  toolCallId: string
  toolName: string
  provenance: Partial<CopilotToolExecutionProvenance>
}): ClientToolExecutionContext {
  const { toolCallId, toolName, provenance } = params
  const {
    workflowId,
    contextWorkflowId,
    workspaceId,
    reviewSessionId,
    entityKind,
    entityId,
    draftSessionId,
  } = provenance

  return {
    toolCallId,
    toolName,
    ...(workflowId ? { workflowId } : {}),
    ...(contextWorkflowId ? { contextWorkflowId } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(reviewSessionId ? { reviewSessionId } : {}),
    ...(entityKind ? { entityKind } : {}),
    ...(entityId ? { entityId } : {}),
    ...(draftSessionId ? { draftSessionId } : {}),
    log: (level, message, extra) => {
      try {
        logger[level](message, {
          toolCallId,
          toolName,
          workflowId,
          contextWorkflowId,
          workspaceId,
          reviewSessionId,
          entityKind,
          entityId,
          draftSessionId,
          ...(extra || {}),
        })
      } catch {}
    },
  }
}

export function getCopilotToolDefinition(
  toolName: string | undefined
): CopilotToolDefinition | undefined {
  if (!toolName || !isToolId(toolName)) {
    return undefined
  }

  return COPILOT_TOOL_REGISTRY[toolName]
}

export function isCopilotTool(toolName: string | undefined): boolean {
  return !!getCopilotToolDefinition(toolName)
}

export function isClientManagedCopilotTool(toolName: string | undefined): boolean {
  return getCopilotToolDefinition(toolName)?.execution === 'client'
}

export function isServerManagedCopilotTool(toolName: string | undefined): boolean {
  return getCopilotToolDefinition(toolName)?.execution === 'server'
}

export function getCopilotToolMetadata(
  toolName: string | undefined
): BaseClientToolMetadata | undefined {
  return getCopilotToolDefinition(toolName)?.metadata
}

export function ensureClientToolInstance(
  toolName: string | undefined,
  toolCallId: string | undefined
): BaseClientTool | undefined {
  try {
    if (!toolName || !toolCallId) {
      return undefined
    }

    const existing = getClientTool(toolCallId) as BaseClientTool | undefined
    if (existing) {
      return existing
    }

    const definition = getCopilotToolDefinition(toolName)
    if (definition?.execution !== 'client' || !definition.createInstance) {
      return undefined
    }

    const instance = definition.createInstance(toolCallId)
    registerClientTool(toolCallId, instance)
    return instance
  } catch {
    return undefined
  }
}

export function bindClientToolExecutionContext(
  toolCallId: string,
  context: ClientToolExecutionContext
): void {
  try {
    const instance = getClientTool(toolCallId) as BaseClientTool | undefined
    instance?.setExecutionContext(context)
  } catch {}
}

export function prepareCopilotToolArgs(
  _toolName: string | undefined,
  args: Record<string, any> | undefined,
  _context: ClientToolExecutionContext
): Record<string, any> {
  return cloneArgs(args)
}

export function getToolInterruptDisplays(
  toolName: string | undefined,
  toolCallId?: string
): BaseClientToolMetadata['interrupt'] | undefined {
  try {
    const instance = toolCallId ? (getClientTool(toolCallId) as any) : undefined
    if (instance?.getInterruptDisplays) {
      return instance.getInterruptDisplays()
    }
  } catch {}

  return getCopilotToolMetadata(toolName)?.interrupt
}

export function copilotToolHasInterrupt(
  toolName: string | undefined,
  toolCallId?: string
): boolean {
  return !!getToolInterruptDisplays(toolName, toolCallId)
}

export function copilotToolSupportsState(
  toolName: string | undefined,
  state: ClientToolCallState
): boolean {
  return !!getCopilotToolMetadata(toolName)?.displayNames?.[state]
}

export function resolveToolDisplay(
  toolName: string | undefined,
  state: ClientToolCallState,
  _toolCallId?: string,
  params?: Record<string, any>
): ClientToolDisplay | undefined {
  try {
    if (!toolName) {
      return undefined
    }

    const toolMetadata = getCopilotToolMetadata(toolName)
    const displayNames = toolMetadata?.displayNames
    const stateDisplay = displayNames?.[state]

    if (stateDisplay?.text || stateDisplay?.icon) {
      const dynamicText = toolMetadata?.getDynamicText?.(params || {}, state)
      if (dynamicText && stateDisplay.icon) {
        return { text: dynamicText, icon: stateDisplay.icon }
      }
      return { text: stateDisplay.text, icon: stateDisplay.icon }
    }

    const fallbackOrder: ClientToolCallState[] = [
      ClientToolCallState.generating,
      ClientToolCallState.executing,
      ClientToolCallState.review,
      ClientToolCallState.success,
      ClientToolCallState.error,
      ClientToolCallState.rejected,
    ]

    for (const fallbackState of fallbackOrder) {
      const fallbackDisplay = displayNames?.[fallbackState]
      if (fallbackDisplay?.text || fallbackDisplay?.icon) {
        return { text: fallbackDisplay.text, icon: fallbackDisplay.icon }
      }
    }
  } catch {}

  try {
    if (toolName) {
      return {
        text: toolName.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
        icon: undefined as any,
      }
    }
  } catch {}

  return undefined
}

export function isRejectedState(state: any): boolean {
  try {
    return state === 'rejected' || state === ClientToolCallState.rejected
  } catch {
    return state === 'rejected'
  }
}

export function isReviewState(state: any): boolean {
  try {
    return state === 'review' || state === ClientToolCallState.review
  } catch {
    return state === 'review'
  }
}

export function isBackgroundState(state: any): boolean {
  try {
    return state === 'background' || state === ClientToolCallState.background
  } catch {
    return state === 'background'
  }
}
