import type { ToolId } from "@/lib/copilot/registry";

export interface ToolPromptMetadata {
	description: string;
	rules?: string;
	instructions?: string[];
	kind?: string;
	entityKind?: string;
	mutatesState?: boolean;
	requiresCurrentState?: boolean;
	discoveryToolNames?: string[];
	verificationToolNames?: string[];
	injectWorkflowId?: boolean;
	requiredToolResults?: string[];
}

const WORKFLOW_DOCUMENT_RULES = [
	"Workflows are edited as full document updates, not operation arrays.",
	"`get_user_workflow` returns `workflowDocument` in `documentFormat: tg-mermaid-v1`.",
	"`edit_workflow` must receive the full edited `workflowDocument` and `documentFormat: tg-mermaid-v1`.",
	"Call `get_user_workflow` before `edit_workflow` so your edit starts from the current workflow document.",
	"If you add new blocks or reconnect handles, call `get_blocks_metadata` for the block types you need before editing the workflow document.",
].join(" ");

const ENTITY_REVIEW_DRAFT_RULE =
	"`edit_skill`, `edit_custom_tool`, `edit_indicator`, and `edit_mcp_server` use review drafts. They update the active review draft for that entity kind and do not directly persist the canonical entity until the user accepts the review.";

const SKILL_DOCUMENT_RULES = [
	"Skills are edited as full document updates.",
	"`get_skill` returns `entityDocument` in `documentFormat: tg-skill-document-v1`.",
	"`edit_skill` must receive the full edited `entityDocument` and `documentFormat: tg-skill-document-v1`.",
	"Call `get_skill` before `edit_skill` so your edit starts from the current skill document.",
].join(" ");

const CUSTOM_TOOL_DOCUMENT_RULES = [
	"Custom tools are edited as full document updates.",
	"`get_custom_tool` returns `entityDocument` in `documentFormat: tg-custom-tool-document-v1`.",
	"`edit_custom_tool` must receive the full edited `entityDocument` and `documentFormat: tg-custom-tool-document-v1`.",
	"Call `get_custom_tool` before `edit_custom_tool` so your edit starts from the current custom tool document.",
].join(" ");

const INDICATOR_DOCUMENT_RULES = [
	"Indicators are edited as full document updates.",
	"`get_indicator` returns `entityDocument` in `documentFormat: tg-indicator-document-v1`.",
	"`edit_indicator` must receive the full edited `entityDocument` and `documentFormat: tg-indicator-document-v1`.",
	"Call `get_indicator` before `edit_indicator` so your edit starts from the current indicator document.",
].join(" ");

const MCP_SERVER_DOCUMENT_RULES = [
	"MCP servers are edited as full document updates.",
	"`get_mcp_server` returns `entityDocument` in `documentFormat: tg-mcp-server-document-v1`.",
	"`edit_mcp_server` must receive the full edited `entityDocument` and `documentFormat: tg-mcp-server-document-v1`.",
	"Call `get_mcp_server` before `edit_mcp_server` so your edit starts from the current MCP server document.",
].join(" ");

const MONITOR_DOCUMENT_RULES = [
	"Monitors are edited as full document updates.",
	"`get_monitor` returns `entityDocument` in `documentFormat: tg-monitor-document-v1`.",
	"`edit_monitor` must receive the full edited `entityDocument`, the target `entityId`, and `documentFormat: tg-monitor-document-v1`.",
	"Call `get_monitor` before `edit_monitor` so your edit starts from the current monitor document.",
	"Monitors must reference a deployed workflow indicator trigger block, a trigger-capable indicator, a supported live provider interval, and a valid listing.",
].join(" ");

export const GLOBAL_TOOL_MANIFEST_INSTRUCTIONS: string[] = [
	"You are TradingGoose Copilot. Design, build, and edit workflows, monitors, indicators, skills, custom tools, and MCP servers that automate trading analysis and decisions.",
	"Keep TradingGoose surfaces distinct. Workflows, monitors, skills, custom tools, indicators, and MCP servers are separate assets and should not be conflated.",
	"Use enough tools to remove material uncertainty before acting, but avoid redundant or repetitive calls.",
	"When discovery, read, edit, or verification tools exist for the same surface, use that lifecycle instead of guessing hidden state.",
	"Workflow edits should preserve existing behavior unless the user explicitly asks for a behavior change.",
	WORKFLOW_DOCUMENT_RULES,
	"Treat workflow graphs, block metadata, upstream references, deployments, and variables as separate facts that may each need explicit inspection.",
	MONITOR_DOCUMENT_RULES,
	"Monitor work is live signal configuration. Be explicit about workflow target, trigger block, provider, interval, listing, indicator, auth requirements, and whether the monitor should be active.",
	"Skills are reusable instruction assets. Use them for reusable behavior, guidance, and operating procedures, not executable runtime code.",
	"Custom tools are executable function tools with schema plus code. Use them for runtime behavior, validation, deterministic computation, or side effects.",
	"MCP work is server configuration plus exposed external tool inventory. Be explicit about transport, URL, headers, timeout, enablement, and expected tool exposure.",
	"For PineTS or indicator work, call out timeframe, repainting, lookahead bias, execution timing, and signal drift risks when they matter.",
	"`edit_monitor` applies the monitor only after the user accepts the tool call. It does not use an entity review draft.",
	ENTITY_REVIEW_DRAFT_RULE,
	"When the user wants live market monitoring or signal trigger configuration, prefer `get_monitor` plus `edit_monitor`.",
	"When the user wants reusable instructions or agent behavior, prefer `get_skill` plus `edit_skill`.",
	"When the user wants executable runtime behavior, prefer `get_custom_tool` plus `edit_custom_tool`.",
	"When the user wants a persisted indicator or trading logic asset, prefer `get_indicator` plus `edit_indicator`.",
	"When the user wants external tool connectivity or MCP server configuration, prefer `get_mcp_server` plus `edit_mcp_server`.",
];

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
			"Return the current workflow as a document payload with `workflowDocument` and `documentFormat`.",
		kind: "read",
		entityKind: "workflow",
		discoveryToolNames: ["list_user_workflows"],
		injectWorkflowId: true,
	},
	edit_workflow: {
		description:
			"Stage workflow changes from a full workflow document and return a reviewed workflow proposal.",
		rules:
			"Do not send operation arrays. Send the full edited workflow document. The tool stages a review proposal and does not apply the workflow until the user accepts.",
		instructions: [WORKFLOW_DOCUMENT_RULES],
		kind: "edit",
		entityKind: "workflow",
		mutatesState: true,
		requiresCurrentState: true,
		discoveryToolNames: ["list_user_workflows"],
		verificationToolNames: ["get_user_workflow"],
		injectWorkflowId: true,
		requiredToolResults: ["get_user_workflow"],
	},
	run_workflow: {
		description: "Run the active workflow with optional input.",
		kind: "run",
		entityKind: "workflow",
		verificationToolNames: ["get_workflow_console"],
		injectWorkflowId: true,
	},
	get_workflow_console: {
		description: "Retrieve workflow console or log output.",
		kind: "read",
		entityKind: "workflow",
		injectWorkflowId: true,
	},
	get_blocks_and_tools: {
		description: "List available workflow blocks and related tools.",
		kind: "inspect",
		entityKind: "workflow",
	},
	get_blocks_metadata: {
		description: "Fetch metadata for workflow blocks.",
		kind: "inspect",
		entityKind: "workflow",
	},
	get_block_options: {
		description: "List available operations or options for a workflow block.",
		kind: "inspect",
		entityKind: "workflow",
	},
	get_block_config: {
		description:
			"Get block input and output config for a block type and optional operation.",
		kind: "inspect",
		entityKind: "workflow",
	},
	get_trigger_examples: {
		description: "Get trigger examples.",
		kind: "search",
		entityKind: "workflow",
	},
	get_examples_rag: {
		description: "Retrieve related examples through RAG search.",
		kind: "search",
		entityKind: "workflow",
	},
	get_operations_examples: {
		description: "Retrieve operation examples.",
		kind: "search",
		entityKind: "workflow",
	},
	search_documentation: {
		description: "Search internal documentation.",
		kind: "search",
		entityKind: "documentation",
	},
	search_online: {
		description: "Search web, news, places, or images.",
		rules:
			"Avoid sending secrets or sensitive data in external searches. Ask for confirmation when the request is sensitive.",
		kind: "search",
		entityKind: "external",
	},
	make_api_request: {
		description: "Make an HTTP request.",
		rules:
			"Do not send secrets. Default to GET unless the user asked for a mutating request.",
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
		rules:
			"Never overwrite secrets without explicit confirmation. Prefer minimal changes.",
		kind: "edit",
		entityKind: "environment",
		mutatesState: true,
		verificationToolNames: ["get_environment_variables"],
	},
	get_oauth_credentials: {
		description: "List OAuth credentials.",
		kind: "read",
		entityKind: "credential",
	},
	get_credentials: {
		description: "Get OAuth credentials and related environment variable names.",
		rules: "Treat returned credentials as sensitive. Do not expose raw tokens.",
		kind: "read",
		entityKind: "credential",
	},
	list_user_workflows: {
		description: "List workflow names for the current user.",
		kind: "list",
		entityKind: "workflow",
	},
	get_workflow_from_name: {
		description:
			"Load a workflow by name and return the same workflow document payload as `get_user_workflow`.",
		kind: "read",
		entityKind: "workflow",
		discoveryToolNames: ["list_user_workflows"],
	},
	get_global_workflow_variables: {
		description: "Get global workflow variables.",
		kind: "read",
		entityKind: "workflow",
		injectWorkflowId: true,
	},
	set_global_workflow_variables: {
		description: "Add, edit, or delete global workflow variables.",
		rules:
			"Prefer targeted updates. Do not remove secrets without explicit confirmation.",
		kind: "edit",
		entityKind: "workflow",
		mutatesState: true,
		verificationToolNames: ["get_global_workflow_variables"],
		injectWorkflowId: true,
	},
	oauth_request_access: {
		description: "Request OAuth access.",
		kind: "request_access",
		entityKind: "credential",
	},
	get_trigger_blocks: {
		description: "List trigger block ids.",
		kind: "inspect",
		entityKind: "workflow",
	},
	deploy_workflow: {
		description: "Deploy or undeploy the active workflow.",
		rules:
			"Confirm before deploy or undeploy when the user did not explicitly request it.",
		kind: "deploy",
		entityKind: "workflow",
		mutatesState: true,
		verificationToolNames: ["check_deployment_status"],
		injectWorkflowId: true,
	},
	check_deployment_status: {
		description: "Check workflow deployment status.",
		kind: "read",
		entityKind: "workflow",
		injectWorkflowId: true,
	},
	knowledge_base: {
		description: "Create, list, get, or query knowledge bases.",
		rules: "Confirm before creating a knowledge base. Avoid duplicates.",
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
			"Return the current custom tool as an editable document payload with `entityDocument` and `documentFormat`.",
		kind: "read",
		entityKind: "custom_tool",
		discoveryToolNames: ["list_custom_tools"],
	},
	edit_custom_tool: {
		description:
			"Stage custom tool changes from a full custom tool document and update the active custom-tool review draft.",
		rules:
			"Do not send partial patches. Send the full edited custom tool document. The tool updates the active review draft and does not persist until the user accepts.",
		instructions: [CUSTOM_TOOL_DOCUMENT_RULES],
		kind: "edit",
		entityKind: "custom_tool",
		mutatesState: true,
		requiresCurrentState: true,
		discoveryToolNames: ["list_custom_tools"],
		verificationToolNames: ["get_custom_tool"],
		requiredToolResults: ["get_custom_tool"],
	},
	list_monitors: {
		description: "List indicator monitors in the current workspace, optionally filtered by workflow or block.",
		kind: "list",
		entityKind: "monitor",
	},
	get_monitor: {
		description:
			"Return the current monitor as an editable document payload with `entityDocument` and `documentFormat`.",
		kind: "read",
		entityKind: "monitor",
		discoveryToolNames: ["list_monitors"],
	},
	edit_monitor: {
		description:
			"Apply monitor changes from a full monitor document after user confirmation.",
		rules:
			"Do not send partial patches. Send the full edited monitor document with the target entityId. The tool applies the monitor only after the user accepts.",
		instructions: [MONITOR_DOCUMENT_RULES],
		kind: "edit",
		entityKind: "monitor",
		mutatesState: true,
		requiresCurrentState: true,
		discoveryToolNames: ["list_monitors"],
		verificationToolNames: ["get_monitor"],
		requiredToolResults: ["get_monitor"],
	},
	list_indicators: {
		description: "List indicators in the current workspace.",
		kind: "list",
		entityKind: "indicator",
	},
	get_indicator: {
		description:
			"Return the current indicator as an editable document payload with `entityDocument` and `documentFormat`.",
		kind: "read",
		entityKind: "indicator",
		discoveryToolNames: ["list_indicators"],
	},
	edit_indicator: {
		description:
			"Stage indicator changes from a full indicator document and update the active indicator review draft.",
		rules:
			"Do not send partial patches. Send the full edited indicator document. The tool updates the active review draft and does not persist until the user accepts.",
		instructions: [INDICATOR_DOCUMENT_RULES],
		kind: "edit",
		entityKind: "indicator",
		mutatesState: true,
		requiresCurrentState: true,
		discoveryToolNames: ["list_indicators"],
		verificationToolNames: ["get_indicator"],
		requiredToolResults: ["get_indicator"],
	},
	list_skills: {
		description: "List skills in the current workspace.",
		kind: "list",
		entityKind: "skill",
	},
	get_skill: {
		description:
			"Return the current skill as an editable document payload with `entityDocument` and `documentFormat`.",
		kind: "read",
		entityKind: "skill",
		discoveryToolNames: ["list_skills"],
	},
	edit_skill: {
		description:
			"Stage skill changes from a full skill document and update the active skill review draft.",
		rules:
			"Do not send partial patches. Send the full edited skill document. The tool updates the active review draft and does not persist until the user accepts.",
		instructions: [SKILL_DOCUMENT_RULES],
		kind: "edit",
		entityKind: "skill",
		mutatesState: true,
		requiresCurrentState: true,
		discoveryToolNames: ["list_skills"],
		verificationToolNames: ["get_skill"],
		requiredToolResults: ["get_skill"],
	},
	list_mcp_servers: {
		description: "List MCP servers in the current workspace.",
		kind: "list",
		entityKind: "mcp_server",
	},
	get_mcp_server: {
		description:
			"Return the current MCP server as an editable document payload with `entityDocument` and `documentFormat`.",
		kind: "read",
		entityKind: "mcp_server",
		discoveryToolNames: ["list_mcp_servers"],
	},
	edit_mcp_server: {
		description:
			"Stage MCP server changes from a full server document and update the active MCP-server review draft.",
		rules:
			"Do not send partial patches. Send the full edited MCP server document. The tool updates the active review draft and does not persist until the user accepts.",
		instructions: [MCP_SERVER_DOCUMENT_RULES],
		kind: "edit",
		entityKind: "mcp_server",
		mutatesState: true,
		requiresCurrentState: true,
		discoveryToolNames: ["list_mcp_servers"],
		verificationToolNames: ["get_mcp_server"],
		requiredToolResults: ["get_mcp_server"],
	},
	sleep: {
		description: "Pause for a short duration.",
		rules: "Seconds must be between 0 and 180.",
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
