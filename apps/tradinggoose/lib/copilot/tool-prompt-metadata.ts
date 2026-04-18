import type { ToolId } from "@/lib/copilot/registry";

export interface ToolPromptMetadata {
	description: string;
	kind?: string;
	entityKind?: string;
	surfaceKind?: string;
}

export const TOOL_PROMPT_METADATA: Record<ToolId, ToolPromptMetadata> = {
	plan: {
		description: "Draft a plan or todo list for multi-step work.",
		kind: "plan",
		entityKind: "planning",
	},
	checkoff_todo: {
		description: "Mark a plan todo as completed.",
		kind: "task",
		entityKind: "planning",
	},
	mark_todo_in_progress: {
		description: "Mark a plan todo as in progress.",
		kind: "task",
		entityKind: "planning",
	},
	get_user_workflow: {
		description:
			"Read a workflow by exact `workflowId` and return `workflowId`, `entityId`, `workflowDocument`, `entityDocument`, and `documentFormat`.",
		kind: "read",
		entityKind: "workflow",
	},
	edit_workflow: {
		description:
			"Update a workflow using exact argument keys `workflowId`, full `workflowDocument`, and `documentFormat: tg-mermaid-v1`, then return the resulting workflow state.",
		kind: "edit",
		entityKind: "workflow",
	},
	run_workflow: {
		description: "Run the target workflow with optional input.",
		kind: "run",
		entityKind: "workflow",
	},
	get_workflow_console: {
		description: "Retrieve workflow console or log output.",
		kind: "read",
		entityKind: "workflow",
	},
	get_blocks_and_tools: {
		description:
			"Search the canonical workflow block catalog before designing or replacing workflow capabilities. Returns canonical block types, names, descriptions, trigger support, Mermaid structure contracts, and operation ids. Use `query` to find built-in options such as historical OHLCV data, indicator/function processing, notifications, storage, APIs, and integrations.",
		kind: "inspect",
		entityKind: "workflow",
	},
	get_blocks_metadata: {
		description:
			"Fetch detailed canonical profiles for workflow block types returned by `get_blocks_and_tools`, including sub-block ids, option values, examples, auth requirements, best practices, operations, and Mermaid structure examples.",
		kind: "inspect",
		entityKind: "workflow",
	},
	search_documentation: {
		description: "Search internal documentation.",
		kind: "search",
		entityKind: "documentation",
	},
	search_online: {
		description: "Search web, news, places, or images.",
		kind: "search",
		entityKind: "external",
	},
	make_api_request: {
		description: "Make an HTTP request.",
		kind: "execute",
		entityKind: "external",
	},
	get_environment_variables: {
		description:
			"Get environment variables for the current workspace or workflow context.",
		kind: "read",
		entityKind: "environment",
	},
	set_environment_variables: {
		description: "Set environment variables.",
		kind: "edit",
		entityKind: "environment",
	},
	get_oauth_credentials: {
		description: "List OAuth credentials.",
		kind: "read",
		entityKind: "credential",
	},
	get_credentials: {
		description: "Get OAuth credentials and related environment variable names.",
		kind: "read",
		entityKind: "credential",
	},
	list_user_workflows: {
		description: "List workflows in the current workspace.",
		kind: "list",
		entityKind: "workflow",
	},
	get_workflow_from_name: {
		description:
			"Read a workflow by exact `workflow_name` and return the same workflow document payload as `get_user_workflow`.",
		kind: "read",
		entityKind: "workflow",
	},
	get_global_workflow_variables: {
		description: "Get global workflow variables.",
		kind: "read",
		entityKind: "workflow",
	},
	set_global_workflow_variables: {
		description: "Add, edit, or delete global workflow variables.",
		kind: "edit",
		entityKind: "workflow",
	},
	oauth_request_access: {
		description: "Request OAuth access.",
		kind: "request_access",
		entityKind: "credential",
	},
	get_trigger_blocks: {
		description:
			"List canonical workflow block types that can start workflows or act as triggers.",
		kind: "inspect",
		entityKind: "workflow",
	},
	deploy_workflow: {
		description: "Deploy or undeploy the target workflow.",
		kind: "deploy",
		entityKind: "workflow",
	},
	check_deployment_status: {
		description: "Check workflow deployment status.",
		kind: "read",
		entityKind: "workflow",
	},
	knowledge_base: {
		description: "Create, list, get, or query knowledge bases.",
		kind: "knowledge",
		entityKind: "knowledge_base",
	},
	list_custom_tools: {
		description: "List custom tools in the current workspace.",
		kind: "list",
		entityKind: "custom_tool",
	},
	get_custom_tool: {
		description:
			"Return the target custom tool as an editable document payload with `entityDocument` and `documentFormat`.",
		kind: "read",
		entityKind: "custom_tool",
	},
	edit_custom_tool: {
		description:
			"Update the target custom tool from a full custom tool document and return the resulting document.",
		kind: "edit",
		entityKind: "custom_tool",
	},
	list_monitors: {
		description: "List indicator monitors in the current workspace, optionally filtered by workflow or block.",
		kind: "list",
		surfaceKind: "monitor",
	},
	get_monitor: {
		description:
			"Return the target monitor as an editable document payload with `monitorDocument` and `documentFormat`.",
		kind: "read",
		surfaceKind: "monitor",
	},
	edit_monitor: {
		description:
			"Update the target monitor from a full monitor document and return the resulting monitor document.",
		kind: "edit",
		surfaceKind: "monitor",
	},
	list_indicators: {
		description: "List indicators in the current workspace.",
		kind: "list",
		entityKind: "indicator",
	},
	get_indicator: {
		description:
			"Return the target indicator as an editable document payload with `entityDocument` and `documentFormat`.",
		kind: "read",
		entityKind: "indicator",
	},
	edit_indicator: {
		description:
			"Update the target indicator from a full indicator document and return the resulting document.",
		kind: "edit",
		entityKind: "indicator",
	},
	list_skills: {
		description: "List skills in the current workspace.",
		kind: "list",
		entityKind: "skill",
	},
	get_skill: {
		description:
			"Return the target skill as an editable document payload with `entityDocument` and `documentFormat`.",
		kind: "read",
		entityKind: "skill",
	},
	edit_skill: {
		description:
			"Update the target skill from a full skill document and return the resulting document.",
		kind: "edit",
		entityKind: "skill",
	},
	list_mcp_servers: {
		description: "List MCP servers in the current workspace.",
		kind: "list",
		entityKind: "mcp_server",
	},
	get_mcp_server: {
		description:
			"Return the target MCP server as an editable document payload with `entityDocument` and `documentFormat`.",
		kind: "read",
		entityKind: "mcp_server",
	},
	edit_mcp_server: {
		description:
			"Update the target MCP server from a full server document and return the resulting document.",
		kind: "edit",
		entityKind: "mcp_server",
	},
	sleep: {
		description: "Pause for a short duration.",
		kind: "utility",
	},
	get_block_outputs: {
		description: "Return available output paths for the given block ids.",
		kind: "inspect",
		entityKind: "workflow",
	},
	get_block_upstream_references: {
		description:
			"Return upstream outputs and variables accessible to the given block ids.",
		kind: "inspect",
		entityKind: "workflow",
	},
	gdrive_request_access: {
		description: "Request Google Drive access.",
		kind: "request_access",
		entityKind: "google_drive",
	},
	list_gdrive_files: {
		description: "List Google Drive files.",
		kind: "list",
		entityKind: "google_drive",
	},
	read_gdrive_file: {
		description: "Read a Google doc or sheet.",
		kind: "read",
		entityKind: "google_drive",
	},
};
