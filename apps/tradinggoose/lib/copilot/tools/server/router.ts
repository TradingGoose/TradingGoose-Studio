import { CopilotTool, getToolContract, isToolId, type ToolId } from '@/lib/copilot/registry'
import type {
  BaseServerTool,
  ServerToolExecutionContext,
} from '@/lib/copilot/tools/server/base-tool'
import { searchDocumentationServerTool } from '@/lib/copilot/tools/server/docs/search-documentation'
import { listGDriveFilesServerTool } from '@/lib/copilot/tools/server/gdrive/list-files'
import { readGDriveFileServerTool } from '@/lib/copilot/tools/server/gdrive/read-file'
import { knowledgeBaseServerTool } from '@/lib/copilot/tools/server/knowledge/knowledge-base'
import { makeApiRequestServerTool } from '@/lib/copilot/tools/server/other/make-api-request'
import { searchOnlineServerTool } from '@/lib/copilot/tools/server/other/search-online'
import { readCredentialsServerTool } from '@/lib/copilot/tools/server/user/read-credentials'
import { readEnvironmentVariablesServerTool } from '@/lib/copilot/tools/server/user/read-environment-variables'
import { readOAuthCredentialsServerTool } from '@/lib/copilot/tools/server/user/read-oauth-credentials'
import { setEnvironmentVariablesServerTool } from '@/lib/copilot/tools/server/user/set-environment-variables'
import { editWorkflowServerTool } from '@/lib/copilot/tools/server/workflow/edit-workflow'
import { editWorkflowBlockServerTool } from '@/lib/copilot/tools/server/workflow/edit-workflow-block'
import { readWorkflowLogsServerTool } from '@/lib/copilot/tools/server/workflow/read-workflow-logs'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ServerToolRouter')

const serverToolRegistry: Partial<Record<ToolId, BaseServerTool<any, any>>> = {
  [editWorkflowServerTool.name]: editWorkflowServerTool,
  [editWorkflowBlockServerTool.name]: editWorkflowBlockServerTool,
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
  [knowledgeBaseServerTool.name]: knowledgeBaseServerTool,
}

async function resolveServerTool(toolName: ToolId): Promise<BaseServerTool<any, any> | null> {
  if (toolName === CopilotTool.get_available_blocks) {
    const { getAvailableBlocksServerTool } = await import(
      '@/lib/copilot/tools/server/blocks/get-available-blocks'
    )
    return getAvailableBlocksServerTool
  }

  if (toolName === CopilotTool.get_blocks_metadata) {
    const { getBlocksMetadataServerTool } = await import(
      '@/lib/copilot/tools/server/blocks/get-blocks-metadata'
    )
    return getBlocksMetadataServerTool
  }

  if (toolName === CopilotTool.get_agent_accessory_catalog) {
    const { getAgentAccessoryCatalogServerTool } = await import(
      '@/lib/copilot/tools/server/agent/get-agent-accessory-catalog'
    )
    return getAgentAccessoryCatalogServerTool
  }

  if (toolName === CopilotTool.get_indicator_catalog) {
    const { getIndicatorCatalogServerTool } = await import(
      '@/lib/copilot/tools/server/indicators/get-indicator-catalog'
    )
    return getIndicatorCatalogServerTool
  }

  if (toolName === CopilotTool.get_indicator_metadata) {
    const { getIndicatorMetadataServerTool } = await import(
      '@/lib/copilot/tools/server/indicators/get-indicator-metadata'
    )
    return getIndicatorMetadataServerTool
  }

  return serverToolRegistry[toolName] ?? null
}

export async function routeExecution(
  toolName: string,
  payload: unknown,
  context?: ServerToolExecutionContext
): Promise<any> {
  if (!isToolId(toolName)) {
    throw new Error(`Unknown server tool: ${toolName}`)
  }

  const tool = await resolveServerTool(toolName)
  const contract = getToolContract(toolName)
  if (!tool || !contract) {
    throw new Error(`Unknown server tool: ${toolName}`)
  }

  logger.debug('Routing to tool', {
    toolName,
    payloadPreview: (() => {
      try {
        return JSON.stringify(payload).slice(0, 200)
      } catch {
        return undefined
      }
    })(),
  })

  const args = contract.args.parse(payload ?? {})
  const result = await tool.execute(args, context)
  return contract.result.parse(result)
}
