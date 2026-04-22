import type { ToolId } from '@/lib/copilot/registry'

export interface ToolPromptMetadata {
  description: string
  kind?: string
  entityKind?: string
  surfaceKind?: string
}

export const TOOL_PROMPT_METADATA: Record<ToolId, ToolPromptMetadata> = {
  plan: {
    description: 'Draft a plan or todo list for multi-step work.',
    kind: 'plan',
    entityKind: 'planning',
  },
  checkoff_todo: {
    description: 'Mark a plan todo as completed.',
    kind: 'task',
    entityKind: 'planning',
  },
  mark_todo_in_progress: {
    description: 'Mark a plan todo as in progress.',
    kind: 'task',
    entityKind: 'planning',
  },
  get_user_workflow: {
    description:
      'Read a workflow by exact `workflowId` and return Mermaid in `workflowDocument` and `entityDocument`, plus `workflowSummary.blocks` with block ids, types, names, enabled state, and current sub-block ids.',
    kind: 'read',
    entityKind: 'workflow',
  },
  create_workflow: {
    description:
      'Create a new workflow in the current workspace or provided `workspaceId`, then return its `workflowId` and metadata. Use `edit_workflow` next to author the workflow document.',
    kind: 'create',
    entityKind: 'workflow',
  },
  edit_workflow: {
    description:
      'Replace the full workflow document using exact argument keys `workflowId`, full `workflowDocument`, and `documentFormat: tg-mermaid-v1`, then return the resulting workflow state. Use this only for graph or topology edits such as adding, removing, reconnecting, or replacing blocks, or changing loop, parallel, or condition structure. Do not use this for a single existing block `name`, `enabled`, or `subBlocks` change; use `edit_workflow_block` instead. If a full-document edit fails and the request only changes one existing block config, stop retrying `edit_workflow` and switch tools.',
    kind: 'edit',
    entityKind: 'workflow',
  },
  edit_workflow_block: {
    description:
      'Default tool for one existing block config change. Patch one existing workflow block without changing workflow connections, graph structure, loops, parallels, condition branches, or adding or removing blocks. Use exact argument keys `workflowId`, `blockId`, optional `blockType`, optional `name`, optional `enabled`, and optional `subBlocks` mapping canonical sub-block ids to new values. Use `get_user_workflow` first for the exact `blockId`, and use `get_blocks_metadata` before editing `subBlocks`. If a previous `edit_workflow` attempt only needed one block config change, switch to this tool instead of retrying `edit_workflow`.',
    kind: 'edit',
    entityKind: 'workflow',
  },
  rename_workflow: {
    description:
      'Rename workflow metadata by exact `workflowId` and new `name`, then return the updated workflow identity payload.',
    kind: 'rename',
    entityKind: 'workflow',
  },
  run_workflow: {
    description: 'Run the target workflow with optional input.',
    kind: 'run',
    entityKind: 'workflow',
  },
  get_workflow_console: {
    description: 'Retrieve workflow console or log output.',
    kind: 'read',
    entityKind: 'workflow',
  },
  get_blocks_and_tools: {
    description:
      'Search the canonical workflow block catalog before designing or replacing workflow capabilities. Returns canonical block types, names, descriptions, trigger support, Mermaid structure contracts, and operation ids. Use `query` to find built-in options such as historical OHLCV data, indicator/function processing, notifications, storage, APIs, and integrations.',
    kind: 'inspect',
    entityKind: 'workflow',
  },
  get_blocks_metadata: {
    description:
      'Fetch detailed canonical profiles for workflow block types returned by `get_blocks_and_tools`, including sub-block ids, option values, exact input reference grammar, the source tools to resolve valid `<...>` tags, auth requirements, best practices, operations, and Mermaid structure examples.',
    kind: 'inspect',
    entityKind: 'workflow',
  },
  get_indicator_catalog: {
    description:
      'Explore the TradingGoose indicator authoring catalog before writing or editing indicator PineTS code. Returns exact section ids and item ids for supported indicator document fields, runtime behavior, PineTS context coverage, `input.*` helpers, `indicator(...)` options, trigger API rules, and unsupported features. Use `get_indicator_metadata` next for exact-id detail.',
    kind: 'inspect',
    entityKind: 'indicator',
  },
  get_indicator_metadata: {
    description:
      'Fetch detailed TradingGoose indicator metadata for exact section ids or item ids returned by `get_indicator_catalog`, such as `section:inputs`, `input.int`, or `indicator.overlay`. Accepts arrays and returns exact usage details, examples, and source references.',
    kind: 'inspect',
    entityKind: 'indicator',
  },
  search_documentation: {
    description: 'Search internal documentation.',
    kind: 'search',
    entityKind: 'documentation',
  },
  search_online: {
    description: 'Search web, news, places, or images.',
    kind: 'search',
    entityKind: 'external',
  },
  make_api_request: {
    description: 'Make an HTTP request.',
    kind: 'execute',
    entityKind: 'external',
  },
  get_environment_variables: {
    description:
      'Get environment variables for the current workspace or workflow context. Use returned names with the exact `{{ENV_VAR_NAME}}` syntax in block inputs.',
    kind: 'read',
    entityKind: 'environment',
  },
  set_environment_variables: {
    description: 'Set environment variables.',
    kind: 'edit',
    entityKind: 'environment',
  },
  get_oauth_credentials: {
    description: 'List OAuth credentials.',
    kind: 'read',
    entityKind: 'credential',
  },
  get_credentials: {
    description: 'Get OAuth credentials and related environment variable names.',
    kind: 'read',
    entityKind: 'credential',
  },
  list_user_workflows: {
    description: 'List workflows in the current workspace.',
    kind: 'list',
    entityKind: 'workflow',
  },
  get_workflow_from_name: {
    description:
      'Read a workflow by exact `workflow_name` and return the same Mermaid document payload and `workflowSummary.blocks` shape as `get_user_workflow`.',
    kind: 'read',
    entityKind: 'workflow',
  },
  get_global_workflow_variables: {
    description:
      'Get global workflow variables. Use returned names with the exact `<variable.name>` syntax in block inputs.',
    kind: 'read',
    entityKind: 'workflow',
  },
  set_global_workflow_variables: {
    description: 'Add, edit, or delete global workflow variables.',
    kind: 'edit',
    entityKind: 'workflow',
  },
  oauth_request_access: {
    description: 'Request OAuth access.',
    kind: 'request_access',
    entityKind: 'credential',
  },
  get_trigger_blocks: {
    description: 'List canonical workflow block types that can start workflows or act as triggers.',
    kind: 'inspect',
    entityKind: 'workflow',
  },
  deploy_workflow: {
    description: 'Deploy or undeploy the target workflow.',
    kind: 'deploy',
    entityKind: 'workflow',
  },
  check_deployment_status: {
    description: 'Check workflow deployment status.',
    kind: 'read',
    entityKind: 'workflow',
  },
  knowledge_base: {
    description: 'Create, list, get, or query knowledge bases.',
    kind: 'knowledge',
    entityKind: 'knowledge_base',
  },
  list_custom_tools: {
    description: 'List custom tools in the current workspace.',
    kind: 'list',
    entityKind: 'custom_tool',
  },
  get_custom_tool: {
    description:
      'Return the target custom tool as an editable document payload with `entityDocument` and `documentFormat`.',
    kind: 'read',
    entityKind: 'custom_tool',
  },
  create_custom_tool: {
    description:
      'Create a new custom tool by sending a full custom tool document into the active unsaved draft review session, then return the resulting document.',
    kind: 'create',
    entityKind: 'custom_tool',
  },
  edit_custom_tool: {
    description:
      'Update the target custom tool from a full custom tool document and return the resulting document.',
    kind: 'edit',
    entityKind: 'custom_tool',
  },
  rename_custom_tool: {
    description:
      'Rename the target custom tool by sending a full custom tool document with the updated title or function name, then return the resulting document.',
    kind: 'rename',
    entityKind: 'custom_tool',
  },
  list_monitors: {
    description:
      'List indicator monitors in the current workspace, optionally filtered by workflow or block.',
    kind: 'list',
    surfaceKind: 'monitor',
  },
  get_monitor: {
    description:
      'Return the target monitor as an editable document payload with `monitorDocument` and `documentFormat`.',
    kind: 'read',
    surfaceKind: 'monitor',
  },
  edit_monitor: {
    description:
      'Update the target monitor from a full monitor document and return the resulting monitor document.',
    kind: 'edit',
    surfaceKind: 'monitor',
  },
  list_indicators: {
    description:
      'List both built-in default indicators and workspace custom indicators. Each result includes `source`, `editable`, `callableInFunctionBlock`, optional `entityId` for editable custom indicators, optional `runtimeId` for built-in Function-block calls, and optional `inputTitles` showing saved override keys. Use `get_indicator` next to inspect the full indicator document, Pine code, and input metadata for a candidate built-in or custom indicator.',
    kind: 'list',
    entityKind: 'indicator',
  },
  get_indicator: {
    description:
      'Return one indicator as a document payload with `entityDocument` and `documentFormat`. For built-in default indicators, pass `runtimeId` from `list_indicators` to inspect the read-only default indicator document, Pine code, and input metadata. For custom indicators, use `entityId` from `list_indicators` entries where `editable` is true, or rely on the active review session. Built-in default indicators are read-only.',
    kind: 'read',
    entityKind: 'indicator',
  },
  create_indicator: {
    description:
      'Create a new custom indicator by sending a full indicator document into the active unsaved draft review session, then return the resulting document. Use this when no built-in default indicator fits the needed behavior.',
    kind: 'create',
    entityKind: 'indicator',
  },
  edit_indicator: {
    description:
      'Update one custom indicator from a full indicator document and return the resulting document. Use only with `entityId` from `list_indicators` entries where `editable` is true. Built-in default indicators are not editable.',
    kind: 'edit',
    entityKind: 'indicator',
  },
  rename_indicator: {
    description:
      'Rename one custom indicator by sending a full indicator document with the updated `name`, then return the resulting document. Use only with `entityId` from `list_indicators` entries where `editable` is true.',
    kind: 'rename',
    entityKind: 'indicator',
  },
  list_skills: {
    description: 'List skills in the current workspace.',
    kind: 'list',
    entityKind: 'skill',
  },
  get_skill: {
    description:
      'Return the target skill as an editable document payload with `entityDocument` and `documentFormat`.',
    kind: 'read',
    entityKind: 'skill',
  },
  create_skill: {
    description:
      'Create a new skill by sending a full skill document into the active unsaved draft review session, then return the resulting document.',
    kind: 'create',
    entityKind: 'skill',
  },
  edit_skill: {
    description:
      'Update the target skill from a full skill document and return the resulting document.',
    kind: 'edit',
    entityKind: 'skill',
  },
  rename_skill: {
    description:
      'Rename the target skill by sending a full skill document with the updated `name`, then return the resulting document.',
    kind: 'rename',
    entityKind: 'skill',
  },
  list_mcp_servers: {
    description: 'List MCP servers in the current workspace.',
    kind: 'list',
    entityKind: 'mcp_server',
  },
  get_mcp_server: {
    description:
      'Return the target MCP server as an editable document payload with `entityDocument` and `documentFormat`.',
    kind: 'read',
    entityKind: 'mcp_server',
  },
  create_mcp_server: {
    description:
      'Create a new MCP server by sending a full server document into the active unsaved draft review session, then return the resulting document.',
    kind: 'create',
    entityKind: 'mcp_server',
  },
  edit_mcp_server: {
    description:
      'Update the target MCP server from a full server document and return the resulting document.',
    kind: 'edit',
    entityKind: 'mcp_server',
  },
  rename_mcp_server: {
    description:
      'Rename the target MCP server by sending a full server document with the updated `name`, then return the resulting document.',
    kind: 'rename',
    entityKind: 'mcp_server',
  },
  sleep: {
    description: 'Pause for a short duration.',
    kind: 'utility',
  },
  get_block_outputs: {
    description:
      'Return structured output entries for the given block ids, each with an exact `path` such as `agent.content` plus its output `type`. Copy `outputs[].path` exactly and wrap it once as `<agent.content>`. Do not invent `block.`, `output`, or workflow block id prefixes.',
    kind: 'inspect',
    entityKind: 'workflow',
  },
  get_block_upstream_references: {
    description:
      'Return exact upstream outputs and workflow variable tags accessible to the given block ids. Each accessible output includes exact `path` and `type`. Copy each returned `accessibleBlocks.outputs[].path` exactly into `<...>`, and copy each variable `tag` exactly as `<variable.name>`. Do not invent new paths.',
    kind: 'inspect',
    entityKind: 'workflow',
  },
  gdrive_request_access: {
    description: 'Request Google Drive access.',
    kind: 'request_access',
    entityKind: 'google_drive',
  },
  list_gdrive_files: {
    description: 'List Google Drive files.',
    kind: 'list',
    entityKind: 'google_drive',
  },
  read_gdrive_file: {
    description: 'Read a Google doc or sheet.',
    kind: 'read',
    entityKind: 'google_drive',
  },
}
