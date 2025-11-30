export interface CopilotToolDef {
  name: string
  description: string
  arguments: string
  rules?: string
}

// Snapshot of TradingGoose copilot tools (see apps/tradinggoose/lib/copilot/registry.ts)
export const COPILOT_TOOLS: CopilotToolDef[] = [
  { name: 'get_user_workflow', description: 'Return the user workflow YAML/JSON.', arguments: '{}' },
  { name: 'list_user_workflows', description: 'List workflow names for the user.', arguments: '{}' },
  {
    name: 'get_workflow_from_name',
    description: 'Load workflow by name.',
    arguments: '{ "workflow_name": "string" }',
  },
  {
    name: 'get_global_workflow_variables',
    description: 'Fetch global workflow variables.',
    arguments: '{}',
  },
  {
    name: 'set_global_workflow_variables',
    description: 'Add/edit/delete global workflow variables.',
    arguments:
      '{ "operations": [ { "operation": "add|delete|edit", "name": "string", "type": "plain|number|boolean|array|object", "value": "any" } ] }',
    rules: 'Prefer targeted updates; do not remove or overwrite secrets without explicit user confirmation.',
  },
  { name: 'oauth_request_access', description: 'Request OAuth access.', arguments: '{}' },
  {
    name: 'edit_workflow',
    description: 'Apply workflow operations.',
    arguments:
      '{ "operations": [ { "operation_type": "add|edit|delete", "block_id": "string", "params": { ... } } ] }',
    rules:
      'Only propose safe, minimal diffs; never assume the edit was applied until the user approves; include a short rationale for each operation.',
  },
  { name: 'run_workflow', description: 'Run workflow with input.', arguments: '{ "workflow_input": "string" }' },
  {
    name: 'get_workflow_console',
    description: 'Retrieve workflow console/logs.',
    arguments: '{ "limit"?: number, "includeDetails"?: boolean }',
  },
  { name: 'get_blocks_and_tools', description: 'List available blocks and tools.', arguments: '{}' },
  {
    name: 'get_blocks_metadata',
    description: 'Fetch metadata for blocks.',
    arguments: '{ "blockIds": ["string", ...] }',
  },
  { name: 'get_trigger_blocks', description: 'List trigger block IDs.', arguments: '{}' },
  { name: 'get_trigger_examples', description: 'Get trigger examples.', arguments: '{}' },
  {
    name: 'get_examples_rag',
    description: 'Retrieve examples via RAG.',
    arguments: '{ "query": "string" }',
  },
  {
    name: 'get_operations_examples',
    description: 'Retrieve operation examples.',
    arguments: '{ "query": "string" }',
  },
  {
    name: 'plan',
    description: 'Draft a plan/TODO list.',
    arguments: '{ "objective"?: "string", "todoList"?: [ { "id"?: "string", "content": "string" } | "string" ] }',
  },
  {
    name: 'mark_todo_in_progress',
    description: 'Mark a plan TODO as in-progress.',
    arguments: '{ "id"?: "string", "todoId"?: "string" }',
  },
  {
    name: 'checkoff_todo',
    description: 'Mark a plan TODO as completed.',
    arguments: '{ "id"?: "string", "todoId"?: "string" }',
  },
  {
    name: 'search_documentation',
    description: 'Search Sim/Docs.',
    arguments: '{ "query": "string", "topK"?: number }',
  },
  {
    name: 'search_online',
    description: 'Search web/news/images.',
    arguments:
      '{ "query": "string", "num"?: number, "type"?: "search|news|places|images", "gl"?: "string", "hl"?: "string" }',
    rules: 'Avoid sending secrets; ask for confirmation before external searches when sensitive.',
  },
  {
    name: 'make_api_request',
    description: 'HTTP request helper.',
    arguments:
      '{ "url": "string", "method": "GET|POST|PUT", "queryParams"?: object, "headers"?: object, "body"?: object|string }',
    rules: 'Do not send secrets; default to GET unless the user specifies; summarize intent before making mutating calls.',
  },
  { name: 'get_environment_variables', description: 'Get environment variables.', arguments: '{}' },
  {
    name: 'set_environment_variables',
    description: 'Set environment variables.',
    arguments: '{ "variables": { "<name>": "string" } }',
    rules: 'Never overwrite secrets without explicit user confirmation; prefer minimal changes.',
  },
  { name: 'get_oauth_credentials', description: 'List OAuth credentials.', arguments: '{}' },
  { name: 'gdrive_request_access', description: 'Request Google Drive access.', arguments: '{}' },
  {
    name: 'list_gdrive_files',
    description: 'List Google Drive files.',
    arguments: '{ "search_query"?: "string", "num_results"?: number }',
  },
  {
    name: 'read_gdrive_file',
    description: 'Read a Google doc/sheet.',
    arguments: '{ "fileId": "string", "type": "doc|sheet", "range"?: "string" }',
  },
  {
    name: 'summarize_conversation',
    description: 'Summarize the conversation so far.',
    arguments: '{}',
  },
  { name: 'reason', description: 'Provide chain-of-thought output.', arguments: '{ "reasoning": "string" }' },
]
