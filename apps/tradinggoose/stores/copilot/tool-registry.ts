import { CopilotTool, isToolId, type ToolId } from '@/lib/copilot/registry'
import { getCopilotToolPolicy } from '@/lib/copilot/tool-policy'
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
import { MCP_TOOLS_CHANGED_EVENT } from '@/lib/mcp/utils'
import { getQueryClient } from '@/app/query-provider'
import { MONITOR_DATA_CHANGED_EVENT } from '@/app/workspace/[workspaceId]/monitor/components/data/api'
import { customToolsKeys } from '@/hooks/queries/custom-tools'
import { environmentKeys } from '@/hooks/queries/environment'
import { knowledgeKeys } from '@/hooks/queries/knowledge'
import { workflowKeys } from '@/hooks/queries/workflows'
import type { CopilotToolExecutionProvenance } from '@/stores/copilot/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('CopilotToolRegistry')

type ToolExecutionKind = 'client' | 'server'

type ClientToolCtor = {
  new (toolCallId: string): BaseClientTool
  metadata: BaseClientToolMetadata
  id: ToolId
}

interface CopilotToolDefinition {
  execution: ToolExecutionKind
  gated: boolean
  metadata: BaseClientToolMetadata
  createInstance?: (toolCallId: string) => BaseClientTool
}

function clientTool(Ctor: ClientToolCtor): CopilotToolDefinition {
  return {
    execution: 'client',
    gated: getCopilotToolPolicy(Ctor.id).gated,
    metadata: Ctor.metadata,
    createInstance: (toolCallId) => new Ctor(toolCallId),
  }
}

function serverTool(toolName: keyof typeof SERVER_TOOL_METADATA): CopilotToolDefinition {
  return {
    execution: 'server',
    gated: getCopilotToolPolicy(toolName).gated,
    metadata: SERVER_TOOL_METADATA[toolName],
  }
}

const COPILOT_TOOL_REGISTRY: Record<ToolId, CopilotToolDefinition> = {
  ...(Object.fromEntries(
    (Object.keys(SERVER_TOOL_METADATA) as (keyof typeof SERVER_TOOL_METADATA)[]).map((toolName) => [
      toolName,
      serverTool(toolName),
    ])
  ) as Record<keyof typeof SERVER_TOOL_METADATA, CopilotToolDefinition>),
  run_workflow: clientTool(RunWorkflowClientTool),
  plan: clientTool(PlanClientTool),
  checkoff_todo: clientTool(CheckoffTodoClientTool),
  mark_todo_in_progress: clientTool(MarkTodoInProgressClientTool),
  gdrive_request_access: clientTool(GDriveRequestAccessClientTool),
  oauth_request_access: clientTool(OAuthRequestAccessClientTool),
  deploy_workflow: clientTool(DeployWorkflowClientTool),
  sleep: clientTool(SleepClientTool),
}

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
}

export function bindClientToolExecutionContext(
  toolCallId: string,
  context: ClientToolExecutionContext
): void {
  const instance = getClientTool(toolCallId) as BaseClientTool | undefined
  instance?.setExecutionContext(context)
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
      window.dispatchEvent(new CustomEvent(MCP_TOOLS_CHANGED_EVENT, { detail: { workspaceId } }))
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
      return
    } else if (toolName.endsWith('_custom_tool')) {
      await queryClient.invalidateQueries({ queryKey: customToolsKeys.list(workspaceId) })
    } else if (toolName.endsWith('_indicator')) {
      return
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
      window.dispatchEvent(
        new CustomEvent(MCP_TOOLS_CHANGED_EVENT, {
          detail: { workspaceId },
        })
      )
    } else if (toolName.endsWith('_watchlist')) {
      return
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
  const instance = toolCallId
    ? (getClientTool(toolCallId) as BaseClientTool | undefined)
    : undefined
  return instance ? instance.getInterruptDisplays() : getCopilotToolMetadata(toolName)?.interrupt
}

export function resolveToolDisplay(
  toolName: string | undefined,
  state: ClientToolCallState,
  _toolCallId?: string,
  params?: Record<string, any>
): ClientToolDisplay | undefined {
  if (!toolName) {
    return undefined
  }

  const toolMetadata = getCopilotToolMetadata(toolName)
  const stateDisplay = toolMetadata?.displayNames[state]

  if (stateDisplay?.text || stateDisplay?.icon) {
    const dynamicText = toolMetadata?.getDynamicText?.(params || {}, state)
    if (dynamicText && stateDisplay.icon) {
      return { text: dynamicText, icon: stateDisplay.icon }
    }
    return { text: stateDisplay.text, icon: stateDisplay.icon }
  }

  return {
    text: toolName.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
    icon: undefined as any,
  }
}
