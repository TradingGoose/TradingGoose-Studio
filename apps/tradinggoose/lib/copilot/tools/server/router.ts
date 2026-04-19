import { getToolContract, isToolId, type ToolId } from '@/lib/copilot/registry'
import type {
  BaseServerTool,
  ServerToolExecutionContext,
} from '@/lib/copilot/tools/server/base-tool'
import { getTriggerBlocksServerTool } from '@/lib/copilot/tools/server/blocks/get-trigger-blocks'
import { searchDocumentationServerTool } from '@/lib/copilot/tools/server/docs/search-documentation'
import { listGDriveFilesServerTool } from '@/lib/copilot/tools/server/gdrive/list-files'
import { readGDriveFileServerTool } from '@/lib/copilot/tools/server/gdrive/read-file'
import { knowledgeBaseServerTool } from '@/lib/copilot/tools/server/knowledge/knowledge-base'
import { makeApiRequestServerTool } from '@/lib/copilot/tools/server/other/make-api-request'
import { searchOnlineServerTool } from '@/lib/copilot/tools/server/other/search-online'
import { getCredentialsServerTool } from '@/lib/copilot/tools/server/user/get-credentials'
import { getEnvironmentVariablesServerTool } from '@/lib/copilot/tools/server/user/get-environment-variables'
import { getOAuthCredentialsServerTool } from '@/lib/copilot/tools/server/user/get-oauth-credentials'
import { setEnvironmentVariablesServerTool } from '@/lib/copilot/tools/server/user/set-environment-variables'
import { editWorkflowServerTool } from '@/lib/copilot/tools/server/workflow/edit-workflow'
import { getWorkflowConsoleServerTool } from '@/lib/copilot/tools/server/workflow/get-workflow-console'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ServerToolRouter')

const serverToolRegistry: Partial<Record<ToolId, BaseServerTool<any, any>>> = {
  [getTriggerBlocksServerTool.name]: getTriggerBlocksServerTool,
  [editWorkflowServerTool.name]: editWorkflowServerTool,
  [getWorkflowConsoleServerTool.name]: getWorkflowConsoleServerTool,
  [searchDocumentationServerTool.name]: searchDocumentationServerTool,
  [searchOnlineServerTool.name]: searchOnlineServerTool,
  [getEnvironmentVariablesServerTool.name]: getEnvironmentVariablesServerTool,
  [setEnvironmentVariablesServerTool.name]: setEnvironmentVariablesServerTool,
  [listGDriveFilesServerTool.name]: listGDriveFilesServerTool,
  [readGDriveFileServerTool.name]: readGDriveFileServerTool,
  [getOAuthCredentialsServerTool.name]: getOAuthCredentialsServerTool,
  [getCredentialsServerTool.name]: getCredentialsServerTool,
  [makeApiRequestServerTool.name]: makeApiRequestServerTool,
  [knowledgeBaseServerTool.name]: knowledgeBaseServerTool,
}

async function resolveServerTool(toolName: ToolId): Promise<BaseServerTool<any, any> | null> {
  if (toolName === 'get_blocks_and_tools') {
    const { getBlocksAndToolsServerTool } = await import(
      '@/lib/copilot/tools/server/blocks/get-blocks-and-tools'
    )
    return getBlocksAndToolsServerTool
  }

  if (toolName === 'get_blocks_metadata') {
    const { getBlocksMetadataServerTool } = await import(
      '@/lib/copilot/tools/server/blocks/get-blocks-metadata-tool'
    )
    return getBlocksMetadataServerTool
  }

  if (toolName === 'get_indicator_catalog') {
    const { getIndicatorCatalogServerTool } = await import(
      '@/lib/copilot/tools/server/indicators/get-indicator-catalog'
    )
    return getIndicatorCatalogServerTool
  }

  if (toolName === 'get_indicator_metadata') {
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
