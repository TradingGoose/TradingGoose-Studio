import {
  CopilotTool,
  getToolContract,
  isToolId,
  ServerToolArgSchemas,
  type ToolId,
} from '@/lib/copilot/registry'
import {
  type BaseServerTool,
  type ServerToolExecutionContext,
  throwIfServerToolAborted,
  withWorkspaceArgContext,
} from '@/lib/copilot/tools/server/base-tool'
import { searchDocumentationServerTool } from '@/lib/copilot/tools/server/docs/search-documentation'
import {
  createCustomToolServerTool,
  createIndicatorServerTool,
  createMcpServerServerTool,
  createSkillServerTool,
  createWorkflowServerTool,
  editCustomToolServerTool,
  editIndicatorServerTool,
  editMcpServerServerTool,
  editSkillServerTool,
  editWorkflowBlockServerTool,
  editWorkflowServerTool,
  editWorkflowVariableServerTool,
  listCustomToolsServerTool,
  listIndicatorsServerTool,
  listMcpServersServerTool,
  listSkillsServerTool,
  listWorkflowsServerTool,
  readCustomToolServerTool,
  readIndicatorServerTool,
  readMcpServerServerTool,
  readSkillServerTool,
  readWorkflowServerTool,
  renameCustomToolServerTool,
  renameIndicatorServerTool,
  renameMcpServerServerTool,
  renameSkillServerTool,
  renameWorkflowServerTool,
} from '@/lib/copilot/tools/server/entities'
import { listGDriveFilesServerTool } from '@/lib/copilot/tools/server/gdrive/list-files'
import { readGDriveFileServerTool } from '@/lib/copilot/tools/server/gdrive/read-file'
import {
  createKnowledgeBaseServerTool,
  editKnowledgeBaseServerTool,
  listKnowledgeBasesServerTool,
  queryKnowledgeBaseServerTool,
  readKnowledgeBaseServerTool,
  renameKnowledgeBaseServerTool,
} from '@/lib/copilot/tools/server/knowledge/knowledge-base'
import { editMonitorServerTool } from '@/lib/copilot/tools/server/monitor/edit-monitor'
import { listMonitorsServerTool } from '@/lib/copilot/tools/server/monitor/list-monitors'
import { readMonitorServerTool } from '@/lib/copilot/tools/server/monitor/read-monitor'
import { makeApiRequestServerTool } from '@/lib/copilot/tools/server/other/make-api-request'
import { searchOnlineServerTool } from '@/lib/copilot/tools/server/other/search-online'
import { readCredentialsServerTool } from '@/lib/copilot/tools/server/user/read-credentials'
import { readEnvironmentVariablesServerTool } from '@/lib/copilot/tools/server/user/read-environment-variables'
import { readOAuthCredentialsServerTool } from '@/lib/copilot/tools/server/user/read-oauth-credentials'
import { setEnvironmentVariablesServerTool } from '@/lib/copilot/tools/server/user/set-environment-variables'
import { checkDeploymentStatusServerTool } from '@/lib/copilot/tools/server/workflow/check-deployment-status'
import { readBlockOutputsServerTool } from '@/lib/copilot/tools/server/workflow/read-block-outputs'
import { readBlockUpstreamReferencesServerTool } from '@/lib/copilot/tools/server/workflow/read-block-upstream-references'
import { readWorkflowLogsServerTool } from '@/lib/copilot/tools/server/workflow/read-workflow-logs'
import { createLogger } from '@/lib/logs/console/logger'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'

const logger = createLogger('ServerToolRouter')

const serverToolRegistry: Partial<Record<ToolId, BaseServerTool<any, any>>> = {
  [editWorkflowServerTool.name]: editWorkflowServerTool,
  [editWorkflowBlockServerTool.name]: editWorkflowBlockServerTool,
  [editWorkflowVariableServerTool.name]: editWorkflowVariableServerTool,
  [createWorkflowServerTool.name]: createWorkflowServerTool,
  [renameWorkflowServerTool.name]: renameWorkflowServerTool,
  [readWorkflowServerTool.name]: readWorkflowServerTool,
  [listWorkflowsServerTool.name]: listWorkflowsServerTool,
  [readWorkflowLogsServerTool.name]: readWorkflowLogsServerTool,
  [searchDocumentationServerTool.name]: searchDocumentationServerTool,
  [searchOnlineServerTool.name]: searchOnlineServerTool,
  [readEnvironmentVariablesServerTool.name]: readEnvironmentVariablesServerTool,
  [setEnvironmentVariablesServerTool.name]: setEnvironmentVariablesServerTool,
  [listGDriveFilesServerTool.name]: listGDriveFilesServerTool,
  [readGDriveFileServerTool.name]: readGDriveFileServerTool,
  [readOAuthCredentialsServerTool.name]: readOAuthCredentialsServerTool,
  [readCredentialsServerTool.name]: readCredentialsServerTool,
  [makeApiRequestServerTool.name]: makeApiRequestServerTool,
  [listKnowledgeBasesServerTool.name]: listKnowledgeBasesServerTool,
  [readKnowledgeBaseServerTool.name]: readKnowledgeBaseServerTool,
  [createKnowledgeBaseServerTool.name]: createKnowledgeBaseServerTool,
  [editKnowledgeBaseServerTool.name]: editKnowledgeBaseServerTool,
  [renameKnowledgeBaseServerTool.name]: renameKnowledgeBaseServerTool,
  [queryKnowledgeBaseServerTool.name]: queryKnowledgeBaseServerTool,
  [listMonitorsServerTool.name]: listMonitorsServerTool,
  [readMonitorServerTool.name]: readMonitorServerTool,
  [editMonitorServerTool.name]: editMonitorServerTool,
  [checkDeploymentStatusServerTool.name]: checkDeploymentStatusServerTool,
  [readBlockOutputsServerTool.name]: readBlockOutputsServerTool,
  [readBlockUpstreamReferencesServerTool.name]: readBlockUpstreamReferencesServerTool,
  [listSkillsServerTool.name]: listSkillsServerTool,
  [readSkillServerTool.name]: readSkillServerTool,
  [createSkillServerTool.name]: createSkillServerTool,
  [editSkillServerTool.name]: editSkillServerTool,
  [renameSkillServerTool.name]: renameSkillServerTool,
  [listCustomToolsServerTool.name]: listCustomToolsServerTool,
  [readCustomToolServerTool.name]: readCustomToolServerTool,
  [createCustomToolServerTool.name]: createCustomToolServerTool,
  [editCustomToolServerTool.name]: editCustomToolServerTool,
  [renameCustomToolServerTool.name]: renameCustomToolServerTool,
  [listIndicatorsServerTool.name]: listIndicatorsServerTool,
  [readIndicatorServerTool.name]: readIndicatorServerTool,
  [createIndicatorServerTool.name]: createIndicatorServerTool,
  [editIndicatorServerTool.name]: editIndicatorServerTool,
  [renameIndicatorServerTool.name]: renameIndicatorServerTool,
  [listMcpServersServerTool.name]: listMcpServersServerTool,
  [readMcpServerServerTool.name]: readMcpServerServerTool,
  [createMcpServerServerTool.name]: createMcpServerServerTool,
  [editMcpServerServerTool.name]: editMcpServerServerTool,
  [renameMcpServerServerTool.name]: renameMcpServerServerTool,
}

const lazyServerToolLoaders: Partial<Record<ToolId, () => Promise<BaseServerTool<any, any>>>> = {
  [CopilotTool.get_available_blocks]: async () => {
    const { getAvailableBlocksServerTool } = await import(
      '@/lib/copilot/tools/server/blocks/get-available-blocks'
    )
    return getAvailableBlocksServerTool
  },
  [CopilotTool.get_blocks_metadata]: async () => {
    const { getBlocksMetadataServerTool } = await import(
      '@/lib/copilot/tools/server/blocks/get-blocks-metadata'
    )
    return getBlocksMetadataServerTool
  },
  [CopilotTool.get_agent_accessory_catalog]: async () => {
    const { getAgentAccessoryCatalogServerTool } = await import(
      '@/lib/copilot/tools/server/agent/get-agent-accessory-catalog'
    )
    return getAgentAccessoryCatalogServerTool
  },
  [CopilotTool.get_indicator_catalog]: async () => {
    const { getIndicatorCatalogServerTool } = await import(
      '@/lib/copilot/tools/server/indicators/get-indicator-catalog'
    )
    return getIndicatorCatalogServerTool
  },
  [CopilotTool.get_indicator_metadata]: async () => {
    const { getIndicatorMetadataServerTool } = await import(
      '@/lib/copilot/tools/server/indicators/get-indicator-metadata'
    )
    return getIndicatorMetadataServerTool
  },
}

const mcpServerToolIds = [
  editWorkflowServerTool.name,
  editWorkflowBlockServerTool.name,
  editWorkflowVariableServerTool.name,
  createWorkflowServerTool.name,
  renameWorkflowServerTool.name,
  readWorkflowServerTool.name,
  listWorkflowsServerTool.name,
  readWorkflowLogsServerTool.name,
  searchDocumentationServerTool.name,
  searchOnlineServerTool.name,
  readEnvironmentVariablesServerTool.name,
  setEnvironmentVariablesServerTool.name,
  listGDriveFilesServerTool.name,
  readGDriveFileServerTool.name,
  readOAuthCredentialsServerTool.name,
  readCredentialsServerTool.name,
  listKnowledgeBasesServerTool.name,
  readKnowledgeBaseServerTool.name,
  createKnowledgeBaseServerTool.name,
  editKnowledgeBaseServerTool.name,
  renameKnowledgeBaseServerTool.name,
  queryKnowledgeBaseServerTool.name,
  listMonitorsServerTool.name,
  readMonitorServerTool.name,
  editMonitorServerTool.name,
  checkDeploymentStatusServerTool.name,
  readBlockOutputsServerTool.name,
  readBlockUpstreamReferencesServerTool.name,
  listSkillsServerTool.name,
  readSkillServerTool.name,
  createSkillServerTool.name,
  editSkillServerTool.name,
  renameSkillServerTool.name,
  listCustomToolsServerTool.name,
  readCustomToolServerTool.name,
  createCustomToolServerTool.name,
  editCustomToolServerTool.name,
  renameCustomToolServerTool.name,
  listIndicatorsServerTool.name,
  readIndicatorServerTool.name,
  createIndicatorServerTool.name,
  editIndicatorServerTool.name,
  renameIndicatorServerTool.name,
  listMcpServersServerTool.name,
  readMcpServerServerTool.name,
  createMcpServerServerTool.name,
  editMcpServerServerTool.name,
  renameMcpServerServerTool.name,
  CopilotTool.get_available_blocks,
  CopilotTool.get_blocks_metadata,
  CopilotTool.get_agent_accessory_catalog,
  CopilotTool.get_indicator_catalog,
  CopilotTool.get_indicator_metadata,
] satisfies ToolId[]

export function getServerToolIds(): ToolId[] {
  return [
    ...(Object.keys(serverToolRegistry) as ToolId[]),
    ...(Object.keys(lazyServerToolLoaders) as ToolId[]),
  ]
}

export function getMcpServerToolIds(): ToolId[] {
  return [...mcpServerToolIds]
}

async function resolveServerTool(toolName: ToolId): Promise<BaseServerTool<any, any> | null> {
  const lazyTool = lazyServerToolLoaders[toolName]
  if (lazyTool) return lazyTool()
  return serverToolRegistry[toolName] ?? null
}

async function assertWorkspaceAccess(context?: ServerToolExecutionContext): Promise<void> {
  if (!context?.workspaceId) {
    return
  }

  const access = await checkWorkspaceAccess(context.workspaceId, context.userId)
  if (!access.exists || !access.hasAccess) {
    throw new Error('Access denied: You do not have permission to use this workspace')
  }
}

export async function routeExecution(
  toolName: string,
  payload: unknown,
  context?: ServerToolExecutionContext
): Promise<any> {
  throwIfServerToolAborted(context)

  if (!isToolId(toolName)) {
    throw new Error(`Unknown server tool: ${toolName}`)
  }

  const tool = await resolveServerTool(toolName)
  throwIfServerToolAborted(context)

  const contract = getToolContract(toolName)
  if (!tool || !contract) {
    throw new Error(`Unknown server tool: ${toolName}`)
  }

  logger.debug('Routing to tool', { toolName })

  let args: any
  try {
    args = ServerToolArgSchemas[toolName].parse(payload ?? {})
  } catch (error) {
    if (
      context?.workspaceId &&
      (!payload || (typeof payload === 'object' && !Array.isArray(payload)))
    ) {
      const payloadWithContextWorkspace = {
        ...((payload as Record<string, unknown> | null | undefined) ?? {}),
        workspaceId: context.workspaceId,
      }
      try {
        args = ServerToolArgSchemas[toolName].parse(payloadWithContextWorkspace)
      } catch {
        throw error
      }
    } else {
      throw error
    }
  }
  const executionContext = withWorkspaceArgContext(context, args)
  throwIfServerToolAborted(executionContext)
  await assertWorkspaceAccess(executionContext)

  const result = await tool.execute(args, executionContext)
  throwIfServerToolAborted(executionContext)

  return contract.result.parse(result)
}
