import { CopilotTool, isToolId, ToolArgSchemas, type ToolId } from '@/lib/copilot/registry'
import type {
  BaseClientTool,
  BaseClientToolMetadata,
  ClientToolCallState,
  ClientToolDisplay,
  ClientToolExecutionContext,
} from '@/lib/copilot/tools/client/base-tool'
import { GDriveRequestAccessClientTool } from '@/lib/copilot/tools/client/google/gdrive-request-access'
import { getClientTool, registerClientTool } from '@/lib/copilot/tools/client/manager'
import { CheckoffTodoClientTool } from '@/lib/copilot/tools/client/other/checkoff-todo'
import { MarkTodoInProgressClientTool } from '@/lib/copilot/tools/client/other/mark-todo-in-progress'
import { OAuthRequestAccessClientTool } from '@/lib/copilot/tools/client/other/oauth-request-access'
import { PlanClientTool } from '@/lib/copilot/tools/client/other/plan'
import { SleepClientTool } from '@/lib/copilot/tools/client/other/sleep'
import { SERVER_TOOL_METADATA } from '@/lib/copilot/tools/client/server-tool-metadata'
import { DeployWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/deploy-workflow'
import { RunWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/run-workflow'
import { createLogger } from '@/lib/logs/console/logger'
import { getQueryClient } from '@/app/query-provider'
import { MONITOR_DATA_CHANGED_EVENT } from '@/app/workspace/[workspaceId]/monitor/components/data/api'
import { customToolsKeys } from '@/hooks/queries/custom-tools'
import { environmentKeys } from '@/hooks/queries/environment'
import { indicatorKeys } from '@/hooks/queries/indicators'
import { knowledgeKeys } from '@/hooks/queries/knowledge'
import { skillsKeys } from '@/hooks/queries/skills'
import { workflowKeys } from '@/hooks/queries/workflows'
import type { CopilotToolExecutionProvenance } from '@/stores/copilot/types'
import { useMcpServersStore } from '@/stores/mcp-servers/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

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
  list_knowledge_bases: serverTool('list_knowledge_bases'),
  read_knowledge_base: serverTool('read_knowledge_base'),
  create_knowledge_base: serverTool('create_knowledge_base', true),
  edit_knowledge_base: serverTool('edit_knowledge_base', true),
  rename_knowledge_base: serverTool('rename_knowledge_base', true),
  query_knowledge_base: serverTool('query_knowledge_base'),
  list_custom_tools: serverTool('list_custom_tools'),
  [CopilotTool.read_custom_tool]: serverTool(CopilotTool.read_custom_tool),
  create_custom_tool: serverTool('create_custom_tool', true),
  edit_custom_tool: serverTool('edit_custom_tool', true),
  rename_custom_tool: serverTool('rename_custom_tool', true),
  list_monitors: serverTool('list_monitors'),
  [CopilotTool.read_monitor]: serverTool(CopilotTool.read_monitor),
  edit_monitor: serverTool('edit_monitor', true),
  [CopilotTool.list_indicators]: serverTool(CopilotTool.list_indicators),
  [CopilotTool.read_indicator]: serverTool(CopilotTool.read_indicator),
  create_indicator: serverTool('create_indicator', true),
  edit_indicator: serverTool('edit_indicator', true),
  rename_indicator: serverTool('rename_indicator', true),
  list_skills: serverTool('list_skills'),
  [CopilotTool.read_skill]: serverTool(CopilotTool.read_skill),
  create_skill: serverTool('create_skill', true),
  edit_skill: serverTool('edit_skill', true),
  rename_skill: serverTool('rename_skill', true),
  list_mcp_servers: serverTool('list_mcp_servers'),
  [CopilotTool.read_mcp_server]: serverTool(CopilotTool.read_mcp_server),
  create_mcp_server: serverTool('create_mcp_server', true),
  edit_mcp_server: serverTool('edit_mcp_server', true),
  rename_mcp_server: serverTool('rename_mcp_server', true),
  list_gdrive_files: serverTool('list_gdrive_files'),
  read_gdrive_file: serverTool('read_gdrive_file'),
  [CopilotTool.read_oauth_credentials]: serverTool(CopilotTool.read_oauth_credentials),
  make_api_request: serverTool('make_api_request', true),
  plan: clientTool(PlanClientTool),
  checkoff_todo: clientTool(CheckoffTodoClientTool),
  mark_todo_in_progress: clientTool(MarkTodoInProgressClientTool),
  gdrive_request_access: clientTool(GDriveRequestAccessClientTool, true),
  oauth_request_access: clientTool(OAuthRequestAccessClientTool, true),
  create_workflow: serverTool('create_workflow', true),
  edit_workflow: serverTool('edit_workflow'),
  edit_workflow_block: serverTool('edit_workflow_block'),
  rename_workflow: serverTool('rename_workflow', true),
  [CopilotTool.read_workflow]: serverTool(CopilotTool.read_workflow),
  [CopilotTool.list_workflows]: serverTool(CopilotTool.list_workflows),
  [CopilotTool.edit_workflow_variable]: serverTool(CopilotTool.edit_workflow_variable),
  deploy_workflow: clientTool(DeployWorkflowClientTool, true),
  check_deployment_status: serverTool('check_deployment_status'),
  sleep: clientTool(SleepClientTool),
  [CopilotTool.read_block_outputs]: serverTool(CopilotTool.read_block_outputs),
  [CopilotTool.read_block_upstream_references]: serverTool(
    CopilotTool.read_block_upstream_references
  ),
}

const WORKSPACE_TARGETED_TOOL_NAMES = new Set<ToolId>([
  CopilotTool.create_workflow,
  CopilotTool.list_workflows,
  CopilotTool.get_agent_accessory_catalog,
  CopilotTool.list_gdrive_files,
  CopilotTool.read_gdrive_file,
  CopilotTool.list_knowledge_bases,
  CopilotTool.create_knowledge_base,
  CopilotTool.list_custom_tools,
  CopilotTool.create_custom_tool,
  CopilotTool.list_monitors,
  CopilotTool.list_indicators,
  CopilotTool.create_indicator,
  CopilotTool.list_skills,
  CopilotTool.create_skill,
  CopilotTool.list_mcp_servers,
  CopilotTool.create_mcp_server,
])

const WORKSPACE_SCOPED_TOOL_NAMES = new Set<ToolId>([
  CopilotTool.read_environment_variables,
  CopilotTool.read_credentials,
  CopilotTool.read_oauth_credentials,
  CopilotTool.set_environment_variables,
])

export function createExecutionContext(params: {
  toolCallId: string
  toolName: string
  provenance: Partial<CopilotToolExecutionProvenance>
}): ClientToolExecutionContext {
  const { toolCallId, toolName, provenance } = params
  const { contextEntityKind, contextEntityId, workspaceId } = provenance

  return {
    toolCallId,
    toolName,
    ...(contextEntityKind ? { contextEntityKind } : {}),
    ...(contextEntityId ? { contextEntityId } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    log: (level, message, extra) => {
      try {
        logger[level](message, {
          toolCallId,
          toolName,
          contextEntityKind,
          contextEntityId,
          workspaceId,
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
  toolName: string | undefined,
  args: Record<string, any> | undefined,
  context: ClientToolExecutionContext
): Record<string, any> {
  const clonedArgs = cloneArgs(args)
  if (!toolName || !isToolId(toolName)) {
    return clonedArgs
  }

  if (
    WORKSPACE_TARGETED_TOOL_NAMES.has(toolName) &&
    !clonedArgs.workspaceId &&
    context.workspaceId
  ) {
    clonedArgs.workspaceId = context.workspaceId
  } else if (
    WORKSPACE_SCOPED_TOOL_NAMES.has(toolName) &&
    clonedArgs.scope === 'workspace' &&
    !clonedArgs.workspaceId &&
    context.workspaceId
  ) {
    clonedArgs.workspaceId = context.workspaceId
  }

  return ToolArgSchemas[toolName].parse(clonedArgs) as Record<string, any>
}

type ServerToolSuccessContext = {
  workspaceId?: string
}

function readResultWorkspaceId(result: unknown, context?: ServerToolSuccessContext) {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const workspaceId = (result as { workspaceId?: unknown }).workspaceId
    if (typeof workspaceId === 'string' && workspaceId.trim()) {
      return workspaceId
    }
  }
  return context?.workspaceId
}

export async function handleCopilotServerToolSuccess(
  toolName: string | undefined,
  result?: unknown,
  context?: ServerToolSuccessContext
): Promise<void> {
  const workspaceId = readResultWorkspaceId(result, context)

  try {
    const queryClient = getQueryClient()
    if (toolName === CopilotTool.set_environment_variables) {
      const scope =
        result && typeof result === 'object' && !Array.isArray(result)
          ? (result as { scope?: unknown }).scope
          : undefined
      if (scope === 'workspace' && workspaceId) {
        await queryClient.invalidateQueries({ queryKey: environmentKeys.workspace(workspaceId) })
      } else if (scope === 'personal') {
        await queryClient.invalidateQueries({ queryKey: environmentKeys.personal() })
      }
      return
    }

    if (!workspaceId || !toolName || !/^(create|edit|rename)_/.test(toolName)) {
      return
    }

    if (toolName === CopilotTool.create_workflow || toolName === CopilotTool.rename_workflow) {
      await Promise.all([
        useWorkflowRegistry.getState().loadWorkflows({ workspaceId }),
        queryClient.invalidateQueries({ queryKey: workflowKeys.list(workspaceId) }),
      ])
    } else if (toolName.endsWith('_skill')) {
      await queryClient.invalidateQueries({ queryKey: skillsKeys.list(workspaceId) })
    } else if (toolName.endsWith('_custom_tool')) {
      await queryClient.invalidateQueries({ queryKey: customToolsKeys.list(workspaceId) })
    } else if (toolName.endsWith('_indicator')) {
      await queryClient.invalidateQueries({ queryKey: indicatorKeys.list(workspaceId) })
    } else if (toolName.endsWith('_knowledge_base')) {
      const entityId =
        result && typeof result === 'object' && !Array.isArray(result)
          ? (result as { entityId?: unknown }).entityId
          : undefined
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: knowledgeKeys.list(workspaceId) }),
        ...(toolName !== CopilotTool.create_knowledge_base &&
        typeof entityId === 'string' &&
        entityId.trim()
          ? [queryClient.invalidateQueries({ queryKey: knowledgeKeys.detail(entityId) })]
          : []),
      ])
    } else if (toolName.endsWith('_mcp_server')) {
      await useMcpServersStore.getState().fetchServers(workspaceId)
    } else if (toolName === CopilotTool.edit_monitor) {
      window.dispatchEvent(
        new CustomEvent(MONITOR_DATA_CHANGED_EVENT, {
          detail: { workspaceId },
        })
      )
    }
  } catch (error) {
    logger.warn('Failed to refresh client state after server-managed tool success', {
      toolName,
      error,
    })
  }
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
