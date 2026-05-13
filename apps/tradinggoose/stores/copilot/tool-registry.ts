import { CopilotTool, isToolId, type ToolId } from '@/lib/copilot/registry'
import {
  type BaseClientTool,
  type BaseClientToolMetadata,
  ClientToolCallState,
  type ClientToolDisplay,
  type ClientToolExecutionContext,
} from '@/lib/copilot/tools/client/base-tool'
import {
  CreateCustomToolClientTool,
  CreateIndicatorClientTool,
  CreateMcpServerClientTool,
  CreateSkillClientTool,
  EditCustomToolClientTool,
  EditIndicatorClientTool,
  EditMcpServerClientTool,
  EditSkillClientTool,
  ListCustomToolsClientTool,
  ListIndicatorsClientTool,
  ListMcpServersClientTool,
  ListSkillsClientTool,
  ReadCustomToolClientTool,
  ReadIndicatorClientTool,
  ReadMcpServerClientTool,
  ReadSkillClientTool,
  RenameCustomToolClientTool,
  RenameIndicatorClientTool,
  RenameMcpServerClientTool,
  RenameSkillClientTool,
} from '@/lib/copilot/tools/client/entities/entity-document-tools'
import { GDriveRequestAccessClientTool } from '@/lib/copilot/tools/client/google/gdrive-request-access'
import { KnowledgeBaseClientTool } from '@/lib/copilot/tools/client/knowledge/knowledge-base'
import { getClientTool, registerClientTool } from '@/lib/copilot/tools/client/manager'
import { EditMonitorClientTool } from '@/lib/copilot/tools/client/monitor/edit-monitor'
import { ListMonitorsClientTool } from '@/lib/copilot/tools/client/monitor/list-monitors'
import { ReadMonitorClientTool } from '@/lib/copilot/tools/client/monitor/read-monitor'
import { CheckoffTodoClientTool } from '@/lib/copilot/tools/client/other/checkoff-todo'
import { MarkTodoInProgressClientTool } from '@/lib/copilot/tools/client/other/mark-todo-in-progress'
import { OAuthRequestAccessClientTool } from '@/lib/copilot/tools/client/other/oauth-request-access'
import { PlanClientTool } from '@/lib/copilot/tools/client/other/plan'
import { SleepClientTool } from '@/lib/copilot/tools/client/other/sleep'
import { SERVER_TOOL_METADATA } from '@/lib/copilot/tools/client/server-tool-metadata'
import { CheckDeploymentStatusClientTool } from '@/lib/copilot/tools/client/workflow/check-deployment-status'
import { CreateWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/create-workflow'
import { DeployWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/deploy-workflow'
import { EditWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/edit-workflow'
import { EditWorkflowBlockClientTool } from '@/lib/copilot/tools/client/workflow/edit-workflow-block'
import { ListWorkflowsClientTool } from '@/lib/copilot/tools/client/workflow/list-workflows'
import { ReadBlockOutputsClientTool } from '@/lib/copilot/tools/client/workflow/read-block-outputs'
import { ReadBlockUpstreamReferencesClientTool } from '@/lib/copilot/tools/client/workflow/read-block-upstream-references'
import { ReadWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/read-workflow'
import { ReadWorkflowVariablesClientTool } from '@/lib/copilot/tools/client/workflow/read-workflow-variables'
import { RenameWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/rename-workflow'
import { RunWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/run-workflow'
import { SetWorkflowVariablesClientTool } from '@/lib/copilot/tools/client/workflow/set-workflow-variables'
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
  gated: boolean
  metadata: BaseClientToolMetadata
  createInstance?: (toolCallId: string) => BaseClientTool
}

function clientTool(Ctor: ClientToolCtor, gated = false): CopilotToolDefinition {
  return {
    execution: 'client',
    gated,
    metadata: Ctor.metadata,
    createInstance: (toolCallId) => new Ctor(toolCallId),
  }
}

function serverTool(
  toolName: keyof typeof SERVER_TOOL_METADATA,
  gated = false
): CopilotToolDefinition {
  return {
    execution: 'server',
    gated,
    metadata: SERVER_TOOL_METADATA[toolName],
  }
}

function cloneArgs(args: Record<string, any> | undefined): Record<string, any> {
  if (!args || typeof args !== 'object') {
    return {}
  }

  return { ...args }
}

const COPILOT_TOOL_REGISTRY: Record<ToolId, CopilotToolDefinition> = {
  run_workflow: clientTool(RunWorkflowClientTool, true),
  [CopilotTool.read_workflow_logs]: serverTool(CopilotTool.read_workflow_logs),
  [CopilotTool.get_available_blocks]: serverTool(CopilotTool.get_available_blocks),
  [CopilotTool.get_blocks_metadata]: serverTool(CopilotTool.get_blocks_metadata),
  [CopilotTool.get_agent_accessory_catalog]: serverTool(CopilotTool.get_agent_accessory_catalog),
  [CopilotTool.get_indicator_catalog]: serverTool(CopilotTool.get_indicator_catalog),
  [CopilotTool.get_indicator_metadata]: serverTool(CopilotTool.get_indicator_metadata),
  search_online: serverTool('search_online'),
  search_documentation: serverTool('search_documentation'),
  [CopilotTool.read_environment_variables]: serverTool(CopilotTool.read_environment_variables),
  set_environment_variables: serverTool('set_environment_variables', true),
  [CopilotTool.read_credentials]: serverTool(CopilotTool.read_credentials),
  knowledge_base: clientTool(KnowledgeBaseClientTool, true),
  list_custom_tools: clientTool(ListCustomToolsClientTool),
  [CopilotTool.read_custom_tool]: clientTool(ReadCustomToolClientTool),
  create_custom_tool: clientTool(CreateCustomToolClientTool, true),
  edit_custom_tool: clientTool(EditCustomToolClientTool, true),
  rename_custom_tool: clientTool(RenameCustomToolClientTool, true),
  list_monitors: clientTool(ListMonitorsClientTool),
  [CopilotTool.read_monitor]: clientTool(ReadMonitorClientTool),
  edit_monitor: clientTool(EditMonitorClientTool, true),
  [CopilotTool.list_indicators]: clientTool(ListIndicatorsClientTool),
  [CopilotTool.read_indicator]: clientTool(ReadIndicatorClientTool),
  create_indicator: clientTool(CreateIndicatorClientTool, true),
  edit_indicator: clientTool(EditIndicatorClientTool, true),
  rename_indicator: clientTool(RenameIndicatorClientTool, true),
  list_skills: clientTool(ListSkillsClientTool),
  [CopilotTool.read_skill]: clientTool(ReadSkillClientTool),
  create_skill: clientTool(CreateSkillClientTool, true),
  edit_skill: clientTool(EditSkillClientTool, true),
  rename_skill: clientTool(RenameSkillClientTool, true),
  list_mcp_servers: clientTool(ListMcpServersClientTool),
  [CopilotTool.read_mcp_server]: clientTool(ReadMcpServerClientTool),
  create_mcp_server: clientTool(CreateMcpServerClientTool, true),
  edit_mcp_server: clientTool(EditMcpServerClientTool, true),
  rename_mcp_server: clientTool(RenameMcpServerClientTool, true),
  list_gdrive_files: serverTool('list_gdrive_files'),
  read_gdrive_file: serverTool('read_gdrive_file'),
  [CopilotTool.read_oauth_credentials]: serverTool(CopilotTool.read_oauth_credentials),
  make_api_request: serverTool('make_api_request', true),
  plan: clientTool(PlanClientTool),
  checkoff_todo: clientTool(CheckoffTodoClientTool),
  mark_todo_in_progress: clientTool(MarkTodoInProgressClientTool),
  gdrive_request_access: clientTool(GDriveRequestAccessClientTool, true),
  oauth_request_access: clientTool(OAuthRequestAccessClientTool, true),
  create_workflow: clientTool(CreateWorkflowClientTool, true),
  edit_workflow: clientTool(EditWorkflowClientTool),
  edit_workflow_block: clientTool(EditWorkflowBlockClientTool),
  rename_workflow: clientTool(RenameWorkflowClientTool, true),
  [CopilotTool.read_workflow]: clientTool(ReadWorkflowClientTool),
  [CopilotTool.list_workflows]: clientTool(ListWorkflowsClientTool),
  [CopilotTool.read_workflow_variables]: clientTool(ReadWorkflowVariablesClientTool),
  [CopilotTool.set_workflow_variables]: clientTool(SetWorkflowVariablesClientTool, true),
  deploy_workflow: clientTool(DeployWorkflowClientTool, true),
  check_deployment_status: clientTool(CheckDeploymentStatusClientTool),
  sleep: clientTool(SleepClientTool),
  [CopilotTool.read_block_outputs]: clientTool(ReadBlockOutputsClientTool),
  [CopilotTool.read_block_upstream_references]: clientTool(ReadBlockUpstreamReferencesClientTool),
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

export function isGatedTool(toolName: string | undefined): boolean {
  return getCopilotToolDefinition(toolName)?.gated ?? true
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
