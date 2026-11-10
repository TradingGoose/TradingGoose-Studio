import type { ToolId } from './registry'

type ToolPolicy = {
  execution: 'client' | 'server'
  gated: boolean
  mcpExposed: boolean
  resultAuthority:
    | 'studio_result'
    | 'workflow_execution'
    | 'browser_local'
    | 'authorized_credential'
    | 'browser_ui'
    | 'workflow_deployment'
}

const serverTool: ToolPolicy = {
  execution: 'server',
  gated: false,
  mcpExposed: true,
  resultAuthority: 'studio_result',
}
const serverGated: ToolPolicy = { ...serverTool, gated: true }
const browserLocal: ToolPolicy = {
  execution: 'client',
  gated: false,
  mcpExposed: false,
  resultAuthority: 'browser_local',
}

/** Studio owns execution and approval policy alongside its canonical tool schemas. */
const policies = {
  run_workflow: {
    ...browserLocal,
    gated: true,
    resultAuthority: 'workflow_execution',
  },
  read_workflow_logs: serverTool,
  get_available_blocks: serverTool,
  get_blocks_metadata: serverTool,
  get_agent_accessory_catalog: serverTool,
  get_indicator_catalog: serverTool,
  get_indicator_metadata: serverTool,
  search_online: serverTool,
  search_documentation: serverTool,
  search_listing: serverTool,
  read_environment_variables: serverTool,
  set_environment_variables: serverGated,
  read_credentials: serverTool,
  list_knowledge_bases: serverTool,
  read_knowledge_base: serverTool,
  create_knowledge_base: serverGated,
  edit_knowledge_base: serverGated,
  rename_knowledge_base: serverGated,
  query_knowledge_base: serverTool,
  list_custom_tools: serverTool,
  read_custom_tool: serverTool,
  create_custom_tool: serverGated,
  edit_custom_tool: serverGated,
  rename_custom_tool: serverGated,
  list_monitors: serverTool,
  read_monitor: serverTool,
  edit_monitor: serverGated,
  list_indicators: serverTool,
  read_indicator: serverTool,
  create_indicator: serverGated,
  edit_indicator: serverGated,
  rename_indicator: serverGated,
  list_skills: serverTool,
  read_skill: serverTool,
  create_skill: serverGated,
  edit_skill: serverGated,
  rename_skill: serverGated,
  list_mcp_servers: serverTool,
  read_mcp_server: serverTool,
  create_mcp_server: serverGated,
  edit_mcp_server: serverGated,
  rename_mcp_server: serverGated,
  list_watchlist: serverTool,
  read_watchlist: serverTool,
  create_watchlist: serverTool,
  edit_watchlist: serverTool,
  rename_watchlist: serverTool,
  list_layout: serverTool,
  create_layout: serverTool,
  read_layout: serverTool,
  edit_layout: serverTool,
  rename_layout: serverTool,
  edit_widget: serverTool,
  get_available_widgets: serverTool,
  get_widgets_metadata: serverTool,
  list_gdrive_files: serverTool,
  read_gdrive_file: serverTool,
  read_oauth_credentials: serverTool,
  make_api_request: { ...serverGated, mcpExposed: false },
  plan: browserLocal,
  checkoff_todo: browserLocal,
  mark_todo_in_progress: browserLocal,
  gdrive_request_access: {
    ...browserLocal,
    gated: true,
    resultAuthority: 'authorized_credential',
  },
  oauth_request_access: {
    ...browserLocal,
    gated: true,
    resultAuthority: 'browser_ui',
  },
  create_workflow: serverGated,
  edit_workflow: serverTool,
  edit_workflow_block: serverTool,
  rename_workflow: serverGated,
  read_workflow: serverTool,
  list_workflows: serverTool,
  edit_workflow_variable: serverTool,
  deploy_workflow: {
    ...browserLocal,
    gated: true,
    resultAuthority: 'workflow_deployment',
  },
  check_deployment_status: serverTool,
  sleep: browserLocal,
  read_block_outputs: serverTool,
  read_block_upstream_references: serverTool,
} satisfies Record<ToolId, ToolPolicy>

export function getCopilotToolPolicy(name: ToolId): ToolPolicy {
  return policies[name]
}
