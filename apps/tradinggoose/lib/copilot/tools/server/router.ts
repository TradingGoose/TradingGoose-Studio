import { isToolId, ToolArgSchemas, type ToolId, ToolResultSchemas } from '@/lib/copilot/registry'
import { isWorkspaceAgnosticServerTool } from '@/lib/copilot/tool-policy'
import {
  type BaseServerTool,
  type ServerToolExecutionContext,
  throwIfServerToolAborted,
  withWorkspaceArgContext,
} from '@/lib/copilot/tools/server/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { getFailureAccounting } from '@/lib/mastra/errors'
import { getInferenceFacts, withInferenceFacts } from '@/lib/mastra/result'

const logger = createLogger('ServerToolRouter')

const serverToolLoaders: Partial<Record<ToolId, () => Promise<BaseServerTool<any, any>>>> = {
  plan: async () => ({ name: 'plan', execute: async (args) => args }),
  checkoff_todo: async () => ({ name: 'checkoff_todo', execute: async (args) => args }),
  mark_todo_in_progress: async () => ({
    name: 'mark_todo_in_progress',
    execute: async (args) => args,
  }),
  edit_workflow: () =>
    import('./workflow/edit-workflow').then((module) => module.editWorkflowServerTool),
  edit_workflow_block: () =>
    import('./workflow/edit-workflow-block').then((module) => module.editWorkflowBlockServerTool),
  edit_workflow_variable: () =>
    import('./entities/workflow').then((module) => module.editWorkflowVariableServerTool),
  create_workflow: () =>
    import('./entities/workflow').then((module) => module.createWorkflowServerTool),
  rename_workflow: () =>
    import('./entities/workflow').then((module) => module.renameWorkflowServerTool),
  read_workflow: () =>
    import('./entities/workflow').then((module) => module.readWorkflowServerTool),
  list_workflows: () =>
    import('./entities/workflow').then((module) => module.listWorkflowsServerTool),
  read_workflow_logs: () =>
    import('./workflow/read-workflow-logs').then((module) => module.readWorkflowLogsServerTool),
  search_documentation: () =>
    import('./docs/search-documentation').then((module) => module.searchDocumentationServerTool),
  search_online: () =>
    import('./other/search-online').then((module) => module.searchOnlineServerTool),
  read_environment_variables: () =>
    import('./user/read-environment-variables').then(
      (module) => module.readEnvironmentVariablesServerTool
    ),
  set_environment_variables: () =>
    import('./user/set-environment-variables').then(
      (module) => module.setEnvironmentVariablesServerTool
    ),
  list_gdrive_files: () =>
    import('./gdrive/list-files').then((module) => module.listGDriveFilesServerTool),
  read_gdrive_file: () =>
    import('./gdrive/read-file').then((module) => module.readGDriveFileServerTool),
  read_oauth_credentials: () =>
    import('./user/read-oauth-credentials').then((module) => module.readOAuthCredentialsServerTool),
  read_credentials: () =>
    import('./user/read-credentials').then((module) => module.readCredentialsServerTool),
  make_api_request: () =>
    import('./other/make-api-request').then((module) => module.makeApiRequestServerTool),
  list_knowledge_bases: () =>
    import('./knowledge/knowledge-base').then((module) => module.listKnowledgeBasesServerTool),
  read_knowledge_base: () =>
    import('./knowledge/knowledge-base').then((module) => module.readKnowledgeBaseServerTool),
  create_knowledge_base: () =>
    import('./knowledge/knowledge-base').then((module) => module.createKnowledgeBaseServerTool),
  edit_knowledge_base: () =>
    import('./knowledge/knowledge-base').then((module) => module.editKnowledgeBaseServerTool),
  rename_knowledge_base: () =>
    import('./knowledge/knowledge-base').then((module) => module.renameKnowledgeBaseServerTool),
  query_knowledge_base: () =>
    import('./knowledge/knowledge-base').then((module) => module.queryKnowledgeBaseServerTool),
  list_monitors: () =>
    import('./monitor/list-monitors').then((module) => module.listMonitorsServerTool),
  read_monitor: () =>
    import('./monitor/read-monitor').then((module) => module.readMonitorServerTool),
  edit_monitor: () =>
    import('./monitor/edit-monitor').then((module) => module.editMonitorServerTool),
  check_deployment_status: () =>
    import('./workflow/check-deployment-status').then(
      (module) => module.checkDeploymentStatusServerTool
    ),
  read_block_outputs: () =>
    import('./workflow/read-block-outputs').then((module) => module.readBlockOutputsServerTool),
  read_block_upstream_references: () =>
    import('./workflow/read-block-upstream-references').then(
      (module) => module.readBlockUpstreamReferencesServerTool
    ),
  list_skills: () => import('./entities/skill').then((module) => module.listSkillsServerTool),
  read_skill: () => import('./entities/skill').then((module) => module.readSkillServerTool),
  create_skill: () => import('./entities/skill').then((module) => module.createSkillServerTool),
  edit_skill: () => import('./entities/skill').then((module) => module.editSkillServerTool),
  rename_skill: () => import('./entities/skill').then((module) => module.renameSkillServerTool),
  list_custom_tools: () =>
    import('./entities/custom-tool').then((module) => module.listCustomToolsServerTool),
  read_custom_tool: () =>
    import('./entities/custom-tool').then((module) => module.readCustomToolServerTool),
  create_custom_tool: () =>
    import('./entities/custom-tool').then((module) => module.createCustomToolServerTool),
  edit_custom_tool: () =>
    import('./entities/custom-tool').then((module) => module.editCustomToolServerTool),
  rename_custom_tool: () =>
    import('./entities/custom-tool').then((module) => module.renameCustomToolServerTool),
  list_indicators: () =>
    import('./entities/indicator').then((module) => module.listIndicatorsServerTool),
  read_indicator: () =>
    import('./entities/indicator').then((module) => module.readIndicatorServerTool),
  create_indicator: () =>
    import('./entities/indicator').then((module) => module.createIndicatorServerTool),
  edit_indicator: () =>
    import('./entities/indicator').then((module) => module.editIndicatorServerTool),
  rename_indicator: () =>
    import('./entities/indicator').then((module) => module.renameIndicatorServerTool),
  list_mcp_servers: () =>
    import('./entities/mcp-server').then((module) => module.listMcpServersServerTool),
  read_mcp_server: () =>
    import('./entities/mcp-server').then((module) => module.readMcpServerServerTool),
  create_mcp_server: () =>
    import('./entities/mcp-server').then((module) => module.createMcpServerServerTool),
  edit_mcp_server: () =>
    import('./entities/mcp-server').then((module) => module.editMcpServerServerTool),
  rename_mcp_server: () =>
    import('./entities/mcp-server').then((module) => module.renameMcpServerServerTool),
  list_watchlist: () =>
    import('./entities/watchlist').then((module) => module.listWatchlistsServerTool),
  read_watchlist: () =>
    import('./entities/watchlist').then((module) => module.readWatchlistServerTool),
  create_watchlist: () =>
    import('./entities/watchlist').then((module) => module.createWatchlistServerTool),
  edit_watchlist: () =>
    import('./entities/watchlist').then((module) => module.editWatchlistServerTool),
  rename_watchlist: () =>
    import('./entities/watchlist').then((module) => module.renameWatchlistServerTool),
  list_layout: () =>
    import('./entities/dashboard-layout').then((module) => module.listLayoutsServerTool),
  create_layout: () =>
    import('./entities/dashboard-layout').then((module) => module.createLayoutServerTool),
  read_layout: () =>
    import('./entities/dashboard-layout').then((module) => module.readLayoutServerTool),
  edit_layout: () =>
    import('./dashboard-layout/edit-layout').then((module) => module.editLayoutServerTool),
  rename_layout: () =>
    import('./entities/dashboard-layout').then((module) => module.renameLayoutServerTool),
  edit_widget: () =>
    import('./dashboard-layout/edit-widget').then((module) => module.editWidgetServerTool),
  get_available_widgets: () =>
    import('./widgets/get-available-widgets').then(
      (module) => module.getAvailableWidgetsServerTool
    ),
  get_widgets_metadata: () =>
    import('./widgets/get-widgets-metadata').then((module) => module.getWidgetsMetadataServerTool),
  search_listing: () =>
    import('./listing/search-listing').then((module) => module.searchListingServerTool),
  get_available_blocks: () =>
    import('./blocks/get-available-blocks').then((module) => module.getAvailableBlocksServerTool),
  get_blocks_metadata: () =>
    import('./blocks/get-blocks-metadata').then((module) => module.getBlocksMetadataServerTool),
  get_agent_accessory_catalog: () =>
    import('./agent/get-agent-accessory-catalog').then(
      (module) => module.getAgentAccessoryCatalogServerTool
    ),
  get_indicator_catalog: () =>
    import('./indicators/get-indicator-catalog').then(
      (module) => module.getIndicatorCatalogServerTool
    ),
  get_indicator_metadata: () =>
    import('./indicators/get-indicator-metadata').then(
      (module) => module.getIndicatorMetadataServerTool
    ),
}

export function getMcpServerToolIds(): ToolId[] {
  return (Object.keys(serverToolLoaders) as ToolId[]).filter(
    (name) => !['make_api_request', 'plan', 'checkoff_todo', 'mark_todo_in_progress'].includes(name)
  )
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

  const loadTool = serverToolLoaders[toolName]
  if (!loadTool) {
    throw new Error(`Unknown server tool: ${toolName}`)
  }

  const args = ToolArgSchemas[toolName].parse(payload ?? {})
  const executionContext = isWorkspaceAgnosticServerTool(toolName)
    ? context && {
        userId: context.userId,
        workspaceId: context.workspaceId,
        accessLevel: context.accessLevel,
        acceptedReviewBaseStateHash: context.acceptedReviewBaseStateHash,
        signal: context.signal,
      }
    : withWorkspaceArgContext(
        context,
        'workspaceId' in args ? { workspaceId: args.workspaceId } : undefined
      )
  throwIfServerToolAborted(executionContext)
  const tool = await loadTool()
  throwIfServerToolAborted(executionContext)
  logger.debug('Routing to tool', { toolName })
  const result = await tool.execute(args, executionContext)
  const facts = getInferenceFacts(result)
  try {
    throwIfServerToolAborted(executionContext)
    const parsed = ToolResultSchemas[toolName].parse(result)
    return facts ? withInferenceFacts(parsed, facts) : parsed
  } catch (error) {
    if (!facts || getInferenceFacts(error)) throw error
    const failure = error instanceof Error ? error : new Error(String(error))
    Object.assign(failure, getFailureAccounting(facts))
    throw withInferenceFacts(failure, facts)
  }
}
