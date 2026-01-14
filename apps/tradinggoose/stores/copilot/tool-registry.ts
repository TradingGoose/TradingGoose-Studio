import type { BaseClientToolMetadata } from '@/lib/copilot/tools/client/base-tool'
import { GetBlocksAndToolsClientTool } from '@/lib/copilot/tools/client/blocks/get-blocks-and-tools'
import { GetBlocksMetadataClientTool } from '@/lib/copilot/tools/client/blocks/get-blocks-metadata'
import { GetTriggerBlocksClientTool } from '@/lib/copilot/tools/client/blocks/get-trigger-blocks'
import { GetExamplesRagClientTool } from '@/lib/copilot/tools/client/examples/get-examples-rag'
import { GetOperationsExamplesClientTool } from '@/lib/copilot/tools/client/examples/get-operations-examples'
import { GetTriggerExamplesClientTool } from '@/lib/copilot/tools/client/examples/get-trigger-examples'
import { SummarizeClientTool } from '@/lib/copilot/tools/client/examples/summarize'
import { ListGDriveFilesClientTool } from '@/lib/copilot/tools/client/gdrive/list-files'
import { ReadGDriveFileClientTool } from '@/lib/copilot/tools/client/gdrive/read-file'
import { GDriveRequestAccessClientTool } from '@/lib/copilot/tools/client/google/gdrive-request-access'
import { getClientTool, registerClientTool } from '@/lib/copilot/tools/client/manager'
import { CheckoffTodoClientTool } from '@/lib/copilot/tools/client/other/checkoff-todo'
import { MakeApiRequestClientTool } from '@/lib/copilot/tools/client/other/make-api-request'
import { MarkTodoInProgressClientTool } from '@/lib/copilot/tools/client/other/mark-todo-in-progress'
import { OAuthRequestAccessClientTool } from '@/lib/copilot/tools/client/other/oauth-request-access'
import { PlanClientTool } from '@/lib/copilot/tools/client/other/plan'
import { SearchDocumentationClientTool } from '@/lib/copilot/tools/client/other/search-documentation'
import { SearchOnlineClientTool } from '@/lib/copilot/tools/client/other/search-online'
import { GetEnvironmentVariablesClientTool } from '@/lib/copilot/tools/client/user/get-environment-variables'
import { GetOAuthCredentialsClientTool } from '@/lib/copilot/tools/client/user/get-oauth-credentials'
import { SetEnvironmentVariablesClientTool } from '@/lib/copilot/tools/client/user/set-environment-variables'
import { EditWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/edit-workflow'
import { PreviewEditWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/preview-edit-workflow'
import { GetGlobalWorkflowVariablesClientTool } from '@/lib/copilot/tools/client/workflow/get-global-workflow-variables'
import { GetUserWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/get-user-workflow'
import { GetWorkflowConsoleClientTool } from '@/lib/copilot/tools/client/workflow/get-workflow-console'
import { GetWorkflowFromNameClientTool } from '@/lib/copilot/tools/client/workflow/get-workflow-from-name'
import { ListUserWorkflowsClientTool } from '@/lib/copilot/tools/client/workflow/list-user-workflows'
import { RunWorkflowClientTool } from '@/lib/copilot/tools/client/workflow/run-workflow'
import { SetGlobalWorkflowVariablesClientTool } from '@/lib/copilot/tools/client/workflow/set-global-workflow-variables'

// Known class-based client tools: map tool name -> instantiator
export const CLIENT_TOOL_INSTANTIATORS: Record<string, (id: string) => any> = {
  run_workflow: (id) => new RunWorkflowClientTool(id),
  get_workflow_console: (id) => new GetWorkflowConsoleClientTool(id),
  get_blocks_and_tools: (id) => new GetBlocksAndToolsClientTool(id),
  get_blocks_metadata: (id) => new GetBlocksMetadataClientTool(id),
  get_trigger_blocks: (id) => new GetTriggerBlocksClientTool(id),
  search_online: (id) => new SearchOnlineClientTool(id),
  search_documentation: (id) => new SearchDocumentationClientTool(id),
  get_environment_variables: (id) => new GetEnvironmentVariablesClientTool(id),
  set_environment_variables: (id) => new SetEnvironmentVariablesClientTool(id),
  list_gdrive_files: (id) => new ListGDriveFilesClientTool(id),
  read_gdrive_file: (id) => new ReadGDriveFileClientTool(id),
  get_oauth_credentials: (id) => new GetOAuthCredentialsClientTool(id),
  make_api_request: (id) => new MakeApiRequestClientTool(id),
  plan: (id) => new PlanClientTool(id),
  checkoff_todo: (id) => new CheckoffTodoClientTool(id),
  mark_todo_in_progress: (id) => new MarkTodoInProgressClientTool(id),
  gdrive_request_access: (id) => new GDriveRequestAccessClientTool(id),
  oauth_request_access: (id) => new OAuthRequestAccessClientTool(id),
  edit_workflow: (id) => new EditWorkflowClientTool(id),
  preview_edit_workflow: (id) => new PreviewEditWorkflowClientTool(id),
  get_user_workflow: (id) => new GetUserWorkflowClientTool(id),
  list_user_workflows: (id) => new ListUserWorkflowsClientTool(id),
  get_workflow_from_name: (id) => new GetWorkflowFromNameClientTool(id),
  get_global_workflow_variables: (id) => new GetGlobalWorkflowVariablesClientTool(id),
  set_global_workflow_variables: (id) => new SetGlobalWorkflowVariablesClientTool(id),
  get_trigger_examples: (id) => new GetTriggerExamplesClientTool(id),
  get_examples_rag: (id) => new GetExamplesRagClientTool(id),
  get_operations_examples: (id) => new GetOperationsExamplesClientTool(id),
  summarize_conversation: (id) => new SummarizeClientTool(id),
}

// Read-only static metadata for class-based tools (no instances)
export const CLASS_TOOL_METADATA: Record<string, BaseClientToolMetadata | undefined> = {
  run_workflow: (RunWorkflowClientTool as any)?.metadata,
  get_workflow_console: (GetWorkflowConsoleClientTool as any)?.metadata,
  get_blocks_and_tools: (GetBlocksAndToolsClientTool as any)?.metadata,
  get_blocks_metadata: (GetBlocksMetadataClientTool as any)?.metadata,
  get_trigger_blocks: (GetTriggerBlocksClientTool as any)?.metadata,
  search_online: (SearchOnlineClientTool as any)?.metadata,
  search_documentation: (SearchDocumentationClientTool as any)?.metadata,
  get_environment_variables: (GetEnvironmentVariablesClientTool as any)?.metadata,
  set_environment_variables: (SetEnvironmentVariablesClientTool as any)?.metadata,
  list_gdrive_files: (ListGDriveFilesClientTool as any)?.metadata,
  read_gdrive_file: (ReadGDriveFileClientTool as any)?.metadata,
  get_oauth_credentials: (GetOAuthCredentialsClientTool as any)?.metadata,
  make_api_request: (MakeApiRequestClientTool as any)?.metadata,
  plan: (PlanClientTool as any)?.metadata,
  checkoff_todo: (CheckoffTodoClientTool as any)?.metadata,
  mark_todo_in_progress: (MarkTodoInProgressClientTool as any)?.metadata,
  gdrive_request_access: (GDriveRequestAccessClientTool as any)?.metadata,
  edit_workflow: (EditWorkflowClientTool as any)?.metadata,
  preview_edit_workflow: (PreviewEditWorkflowClientTool as any)?.metadata,
  get_user_workflow: (GetUserWorkflowClientTool as any)?.metadata,
  list_user_workflows: (ListUserWorkflowsClientTool as any)?.metadata,
  get_workflow_from_name: (GetWorkflowFromNameClientTool as any)?.metadata,
  get_global_workflow_variables: (GetGlobalWorkflowVariablesClientTool as any)?.metadata,
  set_global_workflow_variables: (SetGlobalWorkflowVariablesClientTool as any)?.metadata,
  get_trigger_examples: (GetTriggerExamplesClientTool as any)?.metadata,
  get_examples_rag: (GetExamplesRagClientTool as any)?.metadata,
  oauth_request_access: (OAuthRequestAccessClientTool as any)?.metadata,
  get_operations_examples: (GetOperationsExamplesClientTool as any)?.metadata,
  summarize_conversation: (SummarizeClientTool as any)?.metadata,
}

export function ensureClientToolInstance(
  toolName: string | undefined,
  toolCallId: string | undefined
) {
  try {
    if (!toolName || !toolCallId) return
    if (getClientTool(toolCallId)) return
    const make = CLIENT_TOOL_INSTANTIATORS[toolName]
    if (make) {
      const inst = make(toolCallId)
      registerClientTool(toolCallId, inst)
    }
  } catch { }
}
