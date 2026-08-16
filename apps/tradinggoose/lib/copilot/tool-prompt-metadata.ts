import { CopilotTool, type ToolId } from '@/lib/copilot/registry'

export interface ToolPromptMetadata {
  description: string
  kind?: string
  entityKind?: string
  surfaceKind?: string
}

const CUSTOM_TOOL_DOCUMENT_GUIDANCE =
  'Use `tg-custom-tool-document-v1` content JSON with exactly `schemaText` and `codeText`. Identity is outside the document: supply `name` to create and use `rename_custom_tool` to rename. `schemaText` is a JSON-encoded string, not an object, containing {"type":"function","function":{"description":"What the tool does","parameters":{"type":"object","properties":{},"required":[]}}}. Do not include a `name` property inside `function`. `codeText` is raw async JavaScript function body only; use <paramName> for inputs and {{ENV_VAR_NAME}} for environment variables.'
const KNOWLEDGE_BASE_DOCUMENT_GUIDANCE =
  'Use `tg-knowledge-base-document-v1` content JSON with exactly `description` and `chunkingConfig`. Identity is outside the document: supply `name` to create and use `rename_knowledge_base` to rename. `chunkingConfig` must include numeric `maxSize`, `minSize`, and `overlap`.'
const WATCHLIST_DOCUMENT_GUIDANCE =
  'Use `tg-watchlist-document-v1` content JSON with exactly `settings` and flat ordered `items`. Identity is outside the document: supply `name` to create and use `rename_watchlist` to rename. Items are explicit `type: "section"` or `type: "listing"` entries. Submitted item ids are document-local references; use a section id as its listings\' `parentId`, and the persisted result will return generated item ids. Sections cannot nest and always use `parentId: null`; root listings use `parentId: null`, and listings under a section use that section id. Each listing item must use `listing` with a canonical `search_listing` result\'s `listingIdentity` value.'
const DASHBOARD_COLOR_STORE_GUIDANCE =
  'The layout color store is `colorPairs`: each non-gray color is one layout-scoped shared channel, while `gray` means the widget is unlinked and uses only local `params`. Widgets synchronize a field only when they select the same non-gray `pairColor` and both list that field in `get_widgets_metadata.linkedParamFields`; other fields remain local. Set both widgets to the same `pairColor`, then update shared fields through `colorPair`, not `params`. Changing `pairColor` only changes the subscription and preserves both local params and stored color channels.'
const DASHBOARD_LAYOUT_DOCUMENT_GUIDANCE =
  "Returns a complete `tg-dashboard-layout-document-v3` inspection document with exactly `layout`, `widgets`, and `colorPairs`. These are independent owners: `layout` selects each panel's `identityId` and `widgetKey`, `widgets[identityId]` owns that widget's local `params` and selected `pairColor`, and each non-gray `colorPairs` entry owns shared parameters for that layout/color. This response is never one persisted or Yjs document. Layout identity is returned separately as `entityName`. `widgets[identityId].params` may canonically be `null`, meaning no local overrides rather than a missing widget. At runtime, the mounted widget combines its local params with its selected color-pair params. An entity ID in those params is only a reference; the mounted entity independently connects to its own entity Yjs document. Do not submit this complete read document to `edit_layout`. " +
  DASHBOARD_COLOR_STORE_GUIDANCE
const DASHBOARD_LAYOUT_STRUCTURE_GUIDANCE =
  'Use raw `tg-dashboard-layout-structure-v3` JSON with top-level `layout` only. Existing panels use `{ id, type: "panel" }` to preserve their widget or `{ id, type: "panel", widget: { key } }` to add or replace it. New panels use `{ type: "panel", widget: { key } }`. Omitted existing panels must be listed in `removedPanelIds`. Names belong to `rename_layout`; existing widget params and color-pair edits belong to `edit_widget`.'

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
  [CopilotTool.read_workflow]: {
    description:
      'Read a workflow by exact `entityId` and return full `tg-mermaid-v1` inspection Mermaid in `entityDocument`, workflow variables in `workflowVariableDocument`, plus `workflowSummary.blocks[].connections` counts and exact raw `workflowSummary.edges` with external/internal scope. Do not submit the full workflow Mermaid to `edit_workflow`; that tool accepts minimal graph-only Mermaid. Use `workflowVariableDocument` with `edit_workflow_variable` for variable changes. For topology, use only these edges/counts; do not infer graph connections from subBlock text references like `<...>`. `connectionIssues` only reports malformed existing edges.',
    kind: 'read',
    entityKind: 'workflow',
  },
  create_workflow: {
    description:
      'Create a new workflow in the current workspace or provided `workspaceId`, then return its workflow `entityId` and metadata. Use that `entityId` with `edit_workflow` next to author the workflow document.',
    kind: 'create',
    entityKind: 'workflow',
  },
  edit_workflow: {
    description:
      'Rewrite the full workflow graph topology using exact argument keys `entityId` and minimal Mermaid `entityDocument`, then return the resulting workflow state and graph-only Mermaid document. Use this only for graph or topology edits such as adding, deleting, reconnecting blocks, or changing loop/parallel nesting. Do not send `documentFormat`, `TG_BLOCK`, `TG_EDGE`, `subBlocks`, condition branch labels, `outputs`, `enabled`, positions, or full block metadata. Existing block ids are stable identities used directly as node/subgraph ids: their type and details are preserved by exact id, and supplied labels must match current block names. This tool cannot replace an existing block or change its type; new ids create new blocks with generated positions. New blocks need `id:` and canonical `type:` labels. Existing condition edges must use exact `condition-<blockId>-<branch>` source handles; use `edit_workflow_block` to define branches. If an existing block subtree is intentionally deleted, include the removed root id in `removedBlockIds`; otherwise every existing block id must remain in the Mermaid graph. Use `edit_workflow_block` for one existing block `name`, `enabled`, `subBlocks`, or condition branch definition change.',
    kind: 'edit',
    entityKind: 'workflow',
  },
  edit_workflow_block: {
    description:
      'Default tool for one existing block config change. Patch one existing workflow block without changing workflow connections, graph structure, loops, parallels, condition branches, or adding or removing blocks. Use exact argument keys `entityId`, `blockId`, optional `blockType`, optional `name`, optional `enabled`, and optional `subBlocks` mapping canonical sub-block ids to new values. Use `read_workflow` first for the exact `blockId`, and use `get_blocks_metadata` before editing `subBlocks`. If a previous `edit_workflow` attempt only needed one block config change, switch to this tool instead of retrying `edit_workflow`.',
    kind: 'edit',
    entityKind: 'workflow',
  },
  rename_workflow: {
    description:
      'Rename workflow metadata by exact `entityId` and new `name`, then return the updated workflow identity payload.',
    kind: 'rename',
    entityKind: 'workflow',
  },
  run_workflow: {
    description:
      'Run the target workflow with optional input and an exact `triggerBlockId` from `read_workflow.workflowSummary.blocks`.',
    kind: 'run',
    entityKind: 'workflow',
  },
  [CopilotTool.read_workflow_logs]: {
    description: 'Retrieve workflow logs or log output.',
    kind: 'read',
    entityKind: 'workflow',
  },
  [CopilotTool.get_available_blocks]: {
    description:
      'Search the canonical workflow block catalog before designing or replacing workflow capabilities. Returns canonical block types, categories, names, descriptions, trigger support, Mermaid structure contracts, and operation ids. Use `category` to filter core blocks, tool-backed blocks, or trigger blocks. Use `query` to find built-in options such as historical OHLCV data, indicator/function processing, notifications, storage, APIs, and integrations.',
    kind: 'inspect',
    entityKind: 'workflow',
  },
  [CopilotTool.get_blocks_metadata]: {
    description:
      'Fetch detailed canonical profiles for workflow block types returned by `get_available_blocks`, including sub-block ids, option values, exact input reference grammar, the source tools to resolve valid `<...>` tags, auth requirements, best practices, operations, and Mermaid structure examples.',
    kind: 'inspect',
    entityKind: 'workflow',
  },
  [CopilotTool.get_agent_accessory_catalog]: {
    description:
      'Get available Agent block accessories for the selected workspace. Returns `tools` options for Agent `subBlocks.tools` and `skills` options for Agent `subBlocks.skills`; write selected option `value` objects with `edit_workflow_block`.',
    kind: 'inspect',
    entityKind: 'workflow',
  },
  [CopilotTool.get_indicator_catalog]: {
    description:
      'Explore the TradingGoose indicator authoring catalog before writing or editing indicator PineTS code. Returns exact section ids and item ids for supported indicator document fields, runtime behavior, PineTS context coverage, `input.*` helpers, `indicator(...)` options, trigger API rules, and unsupported features. Use `get_indicator_metadata` next for exact-id detail.',
    kind: 'inspect',
    entityKind: 'indicator',
  },
  [CopilotTool.get_indicator_metadata]: {
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
  search_listing: {
    description:
      "Search companies, tickers, crypto pairs, and currencies. Each result is a resolved listing with display details and a strict canonical `listingIdentity` object for Copilot to use in listing inputs. Takes only `query`; in watchlist listing items, put the selected result's `listingIdentity` value under the `listing` key.",
    kind: 'search',
    entityKind: 'listing',
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
  [CopilotTool.read_environment_variables]: {
    description:
      'Read environment variable names through an explicit personal or workspace scope. Use returned names with the exact `{{ENV_VAR_NAME}}` syntax in block inputs.',
    kind: 'read',
    entityKind: 'environment',
  },
  set_environment_variables: {
    description: 'Set personal or workspace environment variables using an explicit scope.',
    kind: 'edit',
    entityKind: 'environment',
  },
  [CopilotTool.read_oauth_credentials]: {
    description: 'Read OAuth credentials through an explicit personal or workspace scope.',
    kind: 'read',
    entityKind: 'credential',
  },
  [CopilotTool.read_credentials]: {
    description:
      'Read OAuth credentials and related environment variable names through an explicit personal or workspace scope.',
    kind: 'read',
    entityKind: 'credential',
  },
  [CopilotTool.list_workflows]: {
    description:
      'List workflows in the current workspace. If the user identifies a workflow by name, use this list to select the exact `entityId`, then read it with `read_workflow`.',
    kind: 'list',
    entityKind: 'workflow',
  },
  [CopilotTool.edit_workflow_variable]: {
    description:
      'Edit global workflow variables by replacing the full workflow-variable document returned by `read_workflow`. Use returned names with the exact `<variable.name>` syntax in block inputs.',
    kind: 'edit',
    entityKind: 'workflow',
  },
  oauth_request_access: {
    description: 'Request OAuth access.',
    kind: 'request_access',
    entityKind: 'credential',
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
  list_knowledge_bases: {
    description:
      'List knowledge bases in the current workspace. If the user identifies one by name, use this list to select the exact `entityId`.',
    kind: 'list',
    entityKind: 'knowledge_base',
  },
  read_knowledge_base: {
    description: `Read one knowledge base by exact \`entityId\` as an editable document payload with \`entityDocument\` and \`documentFormat\`. ${KNOWLEDGE_BASE_DOCUMENT_GUIDANCE}`,
    kind: 'read',
    entityKind: 'knowledge_base',
  },
  create_knowledge_base: {
    description: `Create a knowledge base in the current workspace from a full knowledge-base document and return the created document. ${KNOWLEDGE_BASE_DOCUMENT_GUIDANCE}`,
    kind: 'create',
    entityKind: 'knowledge_base',
  },
  edit_knowledge_base: {
    description: `Update the target knowledge base from a full knowledge-base document and return the resulting document. ${KNOWLEDGE_BASE_DOCUMENT_GUIDANCE}`,
    kind: 'edit',
    entityKind: 'knowledge_base',
  },
  rename_knowledge_base: {
    description: 'Rename the target knowledge base by exact `entityId` and `name`.',
    kind: 'rename',
    entityKind: 'knowledge_base',
  },
  query_knowledge_base: {
    description:
      'Search one knowledge base by exact `entityId` and query text. Use `read_knowledge_base` or `list_knowledge_bases` first when resolving a named knowledge base.',
    kind: 'search',
    entityKind: 'knowledge_base',
  },
  list_custom_tools: {
    description: 'List custom tools in the current workspace.',
    kind: 'list',
    entityKind: 'custom_tool',
  },
  [CopilotTool.read_custom_tool]: {
    description: `Return one custom tool by \`entityId\` as an editable document payload with \`entityDocument\` and \`documentFormat\`. ${CUSTOM_TOOL_DOCUMENT_GUIDANCE}`,
    kind: 'read',
    entityKind: 'custom_tool',
  },
  create_custom_tool: {
    description: `Create a new custom tool in the current workspace from a full custom tool document and return the created document. ${CUSTOM_TOOL_DOCUMENT_GUIDANCE}`,
    kind: 'create',
    entityKind: 'custom_tool',
  },
  edit_custom_tool: {
    description: `Update the target custom tool from a full custom tool document and return the resulting document. ${CUSTOM_TOOL_DOCUMENT_GUIDANCE}`,
    kind: 'edit',
    entityKind: 'custom_tool',
  },
  rename_custom_tool: {
    description: 'Rename the target custom tool by exact `entityId` and `name`.',
    kind: 'rename',
    entityKind: 'custom_tool',
  },
  list_monitors: {
    description:
      'List monitors in the current workspace, optionally filtered by workflow or block.',
    kind: 'list',
    surfaceKind: 'monitor',
  },
  [CopilotTool.read_monitor]: {
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
  [CopilotTool.list_indicators]: {
    description:
      'List both built-in default indicators and workspace custom indicators. Each result includes `source`, `editable`, `callableInFunctionBlock`, optional `entityId` for editable custom indicators, `runtimeId` for Function-block calls, and optional `inputTitles` showing saved override keys. Use `read_indicator` next to inspect the full indicator document, Pine code, and input metadata for a candidate built-in or custom indicator.',
    kind: 'list',
    entityKind: 'indicator',
  },
  [CopilotTool.read_indicator]: {
    description:
      'Return one indicator as a document payload with `entityDocument` and `documentFormat`. Pass `runtimeId` from `list_indicators` for the callable indicator identity; built-in default indicators are read-only, while custom indicator runtime ids resolve the saved custom indicator document.',
    kind: 'read',
    entityKind: 'indicator',
  },
  create_indicator: {
    description:
      'Create a custom indicator from separate `name` identity plus `tg-indicator-document-v1` content containing exactly `color` and `pineCode`.',
    kind: 'create',
    entityKind: 'indicator',
  },
  edit_indicator: {
    description:
      'Update one custom indicator from `tg-indicator-document-v1` content containing exactly `color` and `pineCode`; use `rename_indicator` for identity. Use only with `entityId` from `list_indicators` entries where `editable` is true. Built-in default indicators are not editable.',
    kind: 'edit',
    entityKind: 'indicator',
  },
  rename_indicator: {
    description: 'Rename one custom indicator by exact `entityId` and `name`.',
    kind: 'rename',
    entityKind: 'indicator',
  },
  list_skills: {
    description: 'List skills in the current workspace.',
    kind: 'list',
    entityKind: 'skill',
  },
  [CopilotTool.read_skill]: {
    description:
      'Return one skill by `entityId` as an editable document payload with `entityDocument` and `documentFormat`.',
    kind: 'read',
    entityKind: 'skill',
  },
  create_skill: {
    description:
      'Create a skill from separate `name` identity plus `tg-skill-document-v1` content containing exactly `description` and `content`.',
    kind: 'create',
    entityKind: 'skill',
  },
  edit_skill: {
    description:
      'Update the target skill from `tg-skill-document-v1` content containing exactly `description` and `content`; use `rename_skill` for identity.',
    kind: 'edit',
    entityKind: 'skill',
  },
  rename_skill: {
    description: 'Rename the target skill by exact `entityId` and `name`.',
    kind: 'rename',
    entityKind: 'skill',
  },
  list_mcp_servers: {
    description: 'List MCP servers in the current workspace.',
    kind: 'list',
    entityKind: 'mcp_server',
  },
  [CopilotTool.read_mcp_server]: {
    description:
      'Return one MCP server by `entityId` as a complete editable document payload. Header/env values are redacted as `[redacted]`; preserve an existing same-key value with that placeholder, provide a concrete value to replace it, and omit a key to delete it.',
    kind: 'read',
    entityKind: 'mcp_server',
  },
  create_mcp_server: {
    description:
      'Create an MCP server from separate `name` identity plus its full `tg-mcp-server-document-v1` content document.',
    kind: 'create',
    entityKind: 'mcp_server',
  },
  edit_mcp_server: {
    description:
      'Update the target MCP server from its content-only `tg-mcp-server-document-v1`; use `rename_mcp_server` for identity. Header/env values returned as `[redacted]` preserve the existing same-key value; submit a concrete value to replace one and omit a key to delete it.',
    kind: 'edit',
    entityKind: 'mcp_server',
  },
  rename_mcp_server: {
    description: 'Rename the target MCP server by exact `entityId` and `name`.',
    kind: 'rename',
    entityKind: 'mcp_server',
  },
  list_watchlist: {
    description:
      'List the current workspace watchlist documents. Use the returned `entityId` to read or edit that watchlist.',
    kind: 'list',
    entityKind: 'watchlist',
  },
  read_watchlist: {
    description: `Return one watchlist by \`entityId\` as an editable document payload with \`entityDocument\` and \`documentFormat\`. ${WATCHLIST_DOCUMENT_GUIDANCE}`,
    kind: 'read',
    entityKind: 'watchlist',
  },
  create_watchlist: {
    description: `Create a new watchlist in the current workspace from a full watchlist document and return the created document. ${WATCHLIST_DOCUMENT_GUIDANCE}`,
    kind: 'create',
    entityKind: 'watchlist',
  },
  edit_watchlist: {
    description: `Update the target watchlist from a full watchlist document and return the resulting document. ${WATCHLIST_DOCUMENT_GUIDANCE}`,
    kind: 'edit',
    entityKind: 'watchlist',
  },
  rename_watchlist: {
    description: 'Rename the target watchlist by exact `entityId` and `name`.',
    kind: 'rename',
    entityKind: 'watchlist',
  },
  list_layout: {
    description:
      'List the current user-owned dashboard layouts in the current workspace. Use the returned `entityId` with `read_layout`, `edit_layout`, or `edit_widget`.',
    kind: 'list',
    entityKind: 'dashboard_layout',
  },
  create_layout: {
    description:
      'Create an empty user-owned dashboard layout shell in the current workspace. The first layout is active automatically; later layouts are inactive until activated. Use the returned `entityId` with `edit_layout` to assign widgets and edit topology, then use `edit_widget` for existing-widget parameter edits.',
    kind: 'create',
    entityKind: 'dashboard_layout',
  },
  read_layout: {
    description: `Return one user-owned dashboard layout by exact \`entityId\` with \`entityDocument\` and \`documentFormat\`. ${DASHBOARD_LAYOUT_DOCUMENT_GUIDANCE}`,
    kind: 'read',
    entityKind: 'dashboard_layout',
  },
  edit_layout: {
    description: `Update the target dashboard layout topology from one raw \`entityDocument\`, then return the same complete layout document shape as \`read_layout\`. ${DASHBOARD_LAYOUT_STRUCTURE_GUIDANCE} ${DASHBOARD_LAYOUT_DOCUMENT_GUIDANCE}`,
    kind: 'edit',
    entityKind: 'dashboard_layout',
  },
  rename_layout: {
    description: 'Rename the target dashboard layout by exact `entityId` and `name`.',
    kind: 'rename',
    entityKind: 'dashboard_layout',
  },
  edit_widget: {
    description:
      'Patch the existing widget in one dashboard panel by exact `entityId` and `panelId`, then return the same complete layout document shape as `read_layout`. Use `params` for local or non-linked widget params, `pairColor` to select its color-store channel, and `colorPair` for shared linked fields. Use `colorPair: { field: null }` to clear one shared field or `colorPair: null` to clear the selected channel. Use `edit_layout` to add, replace, or remove widget bindings. ' +
      'Credential values returned as `[redacted]` preserve the existing same-slot value; submit a concrete value to replace one and omit it from a submitted credential object to delete it. ' +
      'Data-chart drawing state is user-managed and is neither returned nor editable through Copilot. ' +
      DASHBOARD_LAYOUT_DOCUMENT_GUIDANCE,
    kind: 'edit',
    entityKind: 'dashboard_layout',
  },
  get_available_widgets: {
    description:
      'List canonical dashboard widget catalog items, including widget keys, categories, editable fields, and linked color-pair fields. Use the selected key with edit_layout when adding or replacing a dashboard widget.',
    kind: 'inspect',
    entityKind: 'dashboard_layout',
    surfaceKind: 'dashboard_widget',
  },
  get_widgets_metadata: {
    description:
      'Get canonical dashboard widget contracts by exact `widgetKeys`, including defaults, editable params, and authoritative `linkedParamFields` that can synchronize through a shared non-gray layout color store.',
    kind: 'inspect',
    entityKind: 'dashboard_layout',
    surfaceKind: 'dashboard_widget',
  },
  sleep: {
    description: 'Pause for a short duration.',
    kind: 'utility',
  },
  [CopilotTool.read_block_outputs]: {
    description:
      'Return structured output entries for the given block ids, each with an exact `path` such as `agent.content` plus its output `type`. Copy `outputs[].path` exactly and wrap it once as `<agent.content>`. Do not invent `block.`, `output`, or workflow block id prefixes.',
    kind: 'inspect',
    entityKind: 'workflow',
  },
  [CopilotTool.read_block_upstream_references]: {
    description:
      'Return exact upstream outputs and workflow variable tags accessible to the given block ids. Each accessible output includes exact `path` and `type`. Copy each returned `accessibleBlocks.outputs[].path` exactly into `<...>`, and copy each variable `tag` exactly as `<variable.name>`. Do not invent new paths.',
    kind: 'inspect',
    entityKind: 'workflow',
  },
  gdrive_request_access: {
    description: 'Request Google Drive access and return the selected credentialId.',
    kind: 'request_access',
    entityKind: 'google_drive',
  },
  list_gdrive_files: {
    description:
      'List Google Drive files in the selected workspace using the credentialId returned by gdrive_request_access.',
    kind: 'list',
    entityKind: 'google_drive',
  },
  read_gdrive_file: {
    description:
      'Read a Google doc or sheet in the selected workspace using the credentialId returned by gdrive_request_access.',
    kind: 'read',
    entityKind: 'google_drive',
  },
}
