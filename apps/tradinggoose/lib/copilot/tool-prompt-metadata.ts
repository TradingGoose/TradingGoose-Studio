import type { ToolId } from "@/lib/copilot/registry";

export interface ToolPromptMetadata {
	description: string;
	rules?: string;
	instructions?: string[];
	kind?: string;
	entityKind?: string;
	surfaceKind?: string;
	mutatesState?: boolean;
	requiresCurrentState?: boolean;
	discoveryToolNames?: string[];
	verificationToolNames?: string[];
	requiredToolResults?: string[];
}

const WORKFLOW_DOCUMENT_RULES = [
	"Workflows are edited as full document updates, not operation arrays.",
	"`get_user_workflow` and `get_workflow_from_name` return `workflowId`, `entityId`, `workflowDocument`, `entityDocument`, and `documentFormat: tg-mermaid-v1`.",
	"`get_user_workflow` must receive the target `workflowId`; do not rely on the current workflow context as the target.",
	"`edit_workflow` must receive the target `workflowId`, full edited `workflowDocument`, and `documentFormat: tg-mermaid-v1`.",
	"Call `get_user_workflow` or `get_workflow_from_name` before `edit_workflow` so your edit starts from the target workflow document.",
	"If you add new blocks or reconnect handles, call `get_blocks_metadata` for the block types you need before editing the workflow document.",
	"When you need exact Mermaid structure for blocks, call `get_blocks_metadata` for the relevant block types and follow its returned `mermaidContract`, `mermaidExamples`, and per-operation variants instead of guessing the shape.",
	"`TG_BLOCK` payloads must keep the canonical workflow state shape from `get_user_workflow`; workflow documents use `type` and `name`.",
	"`TG_EDGE` payloads are the canonical workflow edge state. When you add, remove, or reconnect blocks, keep the visible Mermaid connection lines and matching `TG_EDGE` comments in sync.",
	"Preserve the current `flowchart TD` or `flowchart LR` direction unless the user explicitly asks to change layout orientation. Prefer `flowchart LR` for new workflows because the Studio canvas defaults to left-to-right flow.",
	"Preserve the exact visible container-edge forms returned by `get_user_workflow`. Loop and parallel edges may connect through block aliases or explicit container start/end nodes depending on the canonical handle stored in `TG_EDGE`.",
	"For loop and parallel blocks, keep child blocks inside the container subgraph. External incoming edges enter through the container boundary, and child outputs inside the container reconnect to the container end before leaving the container.",
	"Do not rewrite bare loop or parallel block edges into explicit `__loop_start`, `__loop_end`, `__parallel_start`, or `__parallel_end` node connections unless the canonical `TG_EDGE` handle requires that exact visible form.",
	"Condition blocks are not rendered like normal blocks. Keep the condition block as a subgraph with its decision diamond plus explicit branch nodes and `condition-*` handles returned by `get_user_workflow`.",
	"Workflow inspection tools may return `blockType` and `blockName` metadata. Do not paste those metadata objects into `TG_BLOCK` payloads.",
	"Do not rewrite workflow blocks into simplified metadata objects from `get_blocks_metadata`; edit the exact document structure returned by `get_user_workflow`.",
].join(" ");

const SKILL_DOCUMENT_RULES = [
	"Skills are edited as full document updates.",
	"`get_skill` must receive the target `entityId` and returns `entityDocument` in `documentFormat: tg-skill-document-v1`.",
	"`edit_skill` must receive the target `entityId`, full edited `entityDocument`, and `documentFormat: tg-skill-document-v1`.",
	"Call `get_skill` before `edit_skill` so your edit starts from the target skill document.",
].join(" ");

const CUSTOM_TOOL_DOCUMENT_RULES = [
	"Custom tools are edited as full document updates.",
	"`get_custom_tool` must receive the target `entityId` and returns `entityDocument` in `documentFormat: tg-custom-tool-document-v1`.",
	"`edit_custom_tool` must receive the target `entityId`, full edited `entityDocument`, and `documentFormat: tg-custom-tool-document-v1`.",
	"Call `get_custom_tool` before `edit_custom_tool` so your edit starts from the target custom tool document.",
].join(" ");

const INDICATOR_DOCUMENT_RULES = [
	"Indicators are edited as full document updates.",
	"`get_indicator` must receive the target `entityId` and returns `entityDocument` in `documentFormat: tg-indicator-document-v1`.",
	"`edit_indicator` must receive the target `entityId`, full edited `entityDocument`, and `documentFormat: tg-indicator-document-v1`.",
	"Call `get_indicator` before `edit_indicator` so your edit starts from the target indicator document.",
].join(" ");

const MCP_SERVER_DOCUMENT_RULES = [
	"MCP servers are edited as full document updates.",
	"`get_mcp_server` must receive the target `entityId` and returns `entityDocument` in `documentFormat: tg-mcp-server-document-v1`.",
	"`edit_mcp_server` must receive the target `entityId`, full edited `entityDocument`, and `documentFormat: tg-mcp-server-document-v1`.",
	"Call `get_mcp_server` before `edit_mcp_server` so your edit starts from the target MCP server document.",
].join(" ");

const MONITOR_DOCUMENT_RULES = [
	"Monitors are edited as full document updates.",
	"`get_monitor` returns `monitorDocument` in `documentFormat: tg-monitor-document-v1`.",
	"`edit_monitor` must receive the full edited `monitorDocument`, the target `monitorId`, and `documentFormat: tg-monitor-document-v1`.",
	"Call `get_monitor` before `edit_monitor` so your edit starts from the target monitor document.",
	"Monitors must reference a deployed workflow indicator trigger block, a trigger-capable indicator, a supported live provider interval, and a valid listing.",
].join(" ");

export const GLOBAL_TOOL_MANIFEST_INSTRUCTIONS: string[] = [
	"You are TradingGoose Copilot. Design, build, and edit workflows, monitors, indicators, skills, custom tools, and MCP servers that automate trading analysis and decisions.",
	"Keep TradingGoose surfaces distinct. Workflows, monitors, skills, custom tools, indicators, and MCP servers are separate assets and should not be conflated.",
	"Use enough tools to remove material uncertainty before acting, but avoid redundant or repetitive calls.",
	"When discovery, read, edit, or verification tools exist for the same surface, use that lifecycle instead of guessing hidden state.",
	"Targeted read, view, edit, run, deploy, and inspect tools must receive the explicit target `entityId` or `workflowId` in tool arguments. Do not use `current_*` context as a tool target.",
	"When a discovery or read tool returns `entityId` or `workflowId`, carry that explicit id into follow-up tool calls for that target.",
	"Workflow edits should preserve existing behavior unless the user explicitly asks for a behavior change.",
	WORKFLOW_DOCUMENT_RULES,
	"Treat workflow graphs, block metadata, upstream references, deployments, and variables as separate facts that may each need explicit inspection.",
	"Tool payloads prefer entity-prefixed identifiers such as `blockType`, `blockName`, `entityId`, and `entityName` so metadata is easy to distinguish from editable documents.",
	MONITOR_DOCUMENT_RULES,
	"Monitor work is live signal configuration. Be explicit about workflow target, trigger block, provider, interval, listing, indicator, auth requirements, and whether the monitor should be active.",
	"Skills are reusable instruction assets. Use them for reusable behavior, guidance, and operating procedures, not executable runtime code.",
	"Custom tools are executable function tools with schema plus code. Use them for runtime behavior, validation, deterministic computation, or side effects.",
	"MCP work is server configuration plus exposed external tool inventory. Be explicit about transport, URL, headers, timeout, enablement, and expected tool exposure.",
	"For PineTS or indicator work, call out timeframe, repainting, lookahead bias, execution timing, and signal drift risks when they matter.",
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
			"Return the target workflow as a document payload with `workflowId`, `entityId`, `workflowDocument`, `entityDocument`, and `documentFormat`.",
		kind: "read",
		entityKind: "workflow",
		discoveryToolNames: ["list_user_workflows"],
	},
	edit_workflow: {
		description:
			"Update the target workflow from a full workflow document and return the resulting workflow state.",
		rules: "Do not send operation arrays. Send the full edited workflow document.",
		instructions: [WORKFLOW_DOCUMENT_RULES],
		kind: "edit",
		entityKind: "workflow",
		mutatesState: true,
		requiresCurrentState: true,
		discoveryToolNames: ["list_user_workflows"],
		verificationToolNames: ["get_user_workflow"],
		requiredToolResults: ["get_user_workflow", "get_workflow_from_name"],
	},
	run_workflow: {
		description: "Run the target workflow with optional input.",
		kind: "run",
		entityKind: "workflow",
		verificationToolNames: ["get_workflow_console"],
	},
	get_workflow_console: {
		description: "Retrieve workflow console or log output.",
		kind: "read",
		entityKind: "workflow",
	},
	get_blocks_and_tools: {
		description: "List available workflow blocks with compact Mermaid structure metadata.",
		kind: "inspect",
		entityKind: "workflow",
	},
	get_blocks_metadata: {
		description:
			"Fetch detailed Mermaid structure profiles and examples for workflow blocks.",
		rules:
			"Use the returned `mermaidContract`, `mermaidExamples`, and per-operation Mermaid variants as shape guidance. Do not paste these helper objects into editable workflow documents.",
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
		rules: "Avoid sending secrets or sensitive data in external searches.",
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
			"Prefer minimal changes. Do not overwrite or remove secrets unless the user explicitly asks.",
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
		description: "List workflows in the current workspace.",
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
	},
	set_global_workflow_variables: {
		description: "Add, edit, or delete global workflow variables.",
		rules:
			"Prefer targeted updates. Do not remove secrets or sensitive values unless the user explicitly asks.",
		kind: "edit",
		entityKind: "workflow",
		mutatesState: true,
		verificationToolNames: ["get_global_workflow_variables"],
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
		description: "Deploy or undeploy the target workflow.",
		rules: "Deploy or undeploy only when the user explicitly asks for it.",
		kind: "deploy",
		entityKind: "workflow",
		mutatesState: true,
		verificationToolNames: ["check_deployment_status"],
	},
	check_deployment_status: {
		description: "Check workflow deployment status.",
		kind: "read",
		entityKind: "workflow",
	},
	knowledge_base: {
		description: "Create, list, get, or query knowledge bases.",
		rules: "Avoid duplicates. Only create a knowledge base when the user explicitly asks.",
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
		discoveryToolNames: ["list_custom_tools"],
	},
	edit_custom_tool: {
		description:
			"Update the target custom tool from a full custom tool document and return the resulting document.",
		rules: "Do not send partial patches. Send the full edited custom tool document.",
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
		surfaceKind: "monitor",
	},
	get_monitor: {
		description:
			"Return the target monitor as an editable document payload with `monitorDocument` and `documentFormat`.",
		kind: "read",
		surfaceKind: "monitor",
		discoveryToolNames: ["list_monitors"],
	},
	edit_monitor: {
		description:
			"Update the target monitor from a full monitor document and return the resulting monitor document.",
		rules:
			"Do not send partial patches. Send the full edited monitor document with the target monitorId.",
		instructions: [MONITOR_DOCUMENT_RULES],
		kind: "edit",
		surfaceKind: "monitor",
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
			"Return the target indicator as an editable document payload with `entityDocument` and `documentFormat`.",
		kind: "read",
		entityKind: "indicator",
		discoveryToolNames: ["list_indicators"],
	},
	edit_indicator: {
		description:
			"Update the target indicator from a full indicator document and return the resulting document.",
		rules: "Do not send partial patches. Send the full edited indicator document.",
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
			"Return the target skill as an editable document payload with `entityDocument` and `documentFormat`.",
		kind: "read",
		entityKind: "skill",
		discoveryToolNames: ["list_skills"],
	},
	edit_skill: {
		description:
			"Update the target skill from a full skill document and return the resulting document.",
		rules: "Do not send partial patches. Send the full edited skill document.",
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
			"Return the target MCP server as an editable document payload with `entityDocument` and `documentFormat`.",
		kind: "read",
		entityKind: "mcp_server",
		discoveryToolNames: ["list_mcp_servers"],
	},
	edit_mcp_server: {
		description:
			"Update the target MCP server from a full server document and return the resulting document.",
		rules: "Do not send partial patches. Send the full edited MCP server document.",
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
