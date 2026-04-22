import { z } from 'zod'
import {
  CUSTOM_TOOL_DOCUMENT_FORMAT,
  INDICATOR_DOCUMENT_FORMAT,
  MCP_SERVER_DOCUMENT_FORMAT,
  SKILL_DOCUMENT_FORMAT,
} from '@/lib/copilot/entity-documents'
import { MONITOR_DOCUMENT_FORMAT } from '@/lib/copilot/monitor/monitor-documents'
import { TG_MERMAID_DOCUMENT_FORMAT } from '@/lib/workflows/document-format'
import {
  GetBlockOutputsInput,
  GetBlockOutputsResult,
  GetBlocksAndToolsInput,
  GetBlocksAndToolsResult,
  GetBlocksMetadataInput,
  GetBlocksMetadataResult,
  GetBlockUpstreamReferencesInput,
  GetBlockUpstreamReferencesResult,
  GetIndicatorCatalogInput,
  GetIndicatorCatalogResult,
  GetIndicatorMetadataInput,
  GetIndicatorMetadataResult,
  GetTriggerBlocksInput,
  GetTriggerBlocksResult,
  KnowledgeBaseArgsSchema,
  KnowledgeBaseResultSchema,
} from './tools/shared/schemas'

// Tool IDs supported by the Copilot runtime
export const ToolIds = z.enum([
  'plan',
  'checkoff_todo',
  'mark_todo_in_progress',
  'get_user_workflow',
  'create_workflow',
  'edit_workflow',
  'edit_workflow_block',
  'rename_workflow',
  'run_workflow',
  'get_workflow_console',
  'get_blocks_and_tools',
  'get_blocks_metadata',
  'get_indicator_catalog',
  'get_indicator_metadata',
  'search_documentation',
  'search_online',
  'make_api_request',
  'get_environment_variables',
  'set_environment_variables',
  'get_oauth_credentials',
  'get_credentials',
  'list_user_workflows',
  'get_workflow_from_name',
  'get_global_workflow_variables',
  'set_global_workflow_variables',
  'oauth_request_access',
  'get_trigger_blocks',
  'deploy_workflow',
  'check_deployment_status',
  'knowledge_base',
  'list_custom_tools',
  'get_custom_tool',
  'create_custom_tool',
  'edit_custom_tool',
  'rename_custom_tool',
  'list_monitors',
  'get_monitor',
  'edit_monitor',
  'list_indicators',
  'get_indicator',
  'create_indicator',
  'edit_indicator',
  'rename_indicator',
  'list_skills',
  'get_skill',
  'create_skill',
  'edit_skill',
  'rename_skill',
  'list_mcp_servers',
  'get_mcp_server',
  'create_mcp_server',
  'edit_mcp_server',
  'rename_mcp_server',
  'sleep',
  'get_block_outputs',
  'get_block_upstream_references',
  'gdrive_request_access',
  'list_gdrive_files',
  'read_gdrive_file',
])
export type ToolId = z.infer<typeof ToolIds>

// Base SSE wrapper for tool_call events emitted by the LLM
const ToolCallSSEBase = z.object({
  type: z.literal('tool_call'),
  data: z.object({
    id: z.string(),
    name: ToolIds,
    arguments: z.record(z.any()),
    partial: z.boolean().default(false),
  }),
})

// Reusable small schemas
const BooleanOptional = z.boolean().optional()
const NumberOptional = z.number().optional()
const RequiredId = z.string().trim().min(1)
const WorkflowContextArgs = z.object({
  workflowId: z.string().optional(),
})
const EntityReviewTargetArgs = z.object({
  entityId: RequiredId.optional(),
})

function buildEntityDocumentMutationArgs<TDocumentFormat extends string>(
  documentFormat: TDocumentFormat,
  options?: { includeEntityId?: boolean }
) {
  const shape = {
    entityDocument: z.string().min(1),
    documentFormat: z.literal(documentFormat).optional(),
  }

  return options?.includeEntityId === false ? z.object(shape) : EntityReviewTargetArgs.extend(shape)
}

const CreateWorkflowArgs = z
  .object({
    name: z.string().trim().min(1).optional(),
    description: z.string().optional(),
    color: z.string().optional(),
    folderId: z.string().nullable().optional(),
    workspaceId: RequiredId.optional(),
  })
  .strict()

const RenameWorkflowArgs = z
  .object({
    workflowId: RequiredId,
    name: z.string().trim().min(1),
  })
  .strict()

const EditWorkflowArgs = z
  .object({
    workflowDocument: z
      .string()
      .min(1)
      .describe(
        'Complete raw `tg-mermaid-v1` Mermaid document for the entire workflow, not a partial patch. Preserve unchanged canonical `%% TG_BLOCK` and `%% TG_EDGE` entries. Use this only for graph or topology changes such as adding, removing, reconnecting, or replacing blocks, loops, parallels, or condition branches.'
      ),
    documentFormat: z.literal(TG_MERMAID_DOCUMENT_FORMAT).optional(),
    workflowId: RequiredId,
    currentWorkflowState: z.string().optional(),
  })
  .strict()
  .describe(
    'Full workflow document replacement tool. Do not use this to rename one existing block or patch one block\'s `enabled` or `subBlocks`; use `edit_workflow_block` instead.'
  )

const EditWorkflowBlockArgs = z
  .object({
    workflowId: RequiredId,
    blockId: z
      .string()
      .trim()
      .min(1)
      .describe(
        'Exact existing workflow block instance id from `get_user_workflow.workflowSummary.blocks`. Do not invent ids.'
      ),
    blockType: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Optional safety check. Must match the existing workflow block type.'),
    name: z.string().trim().min(1).optional(),
    enabled: z.boolean().optional(),
    subBlocks: z
      .record(z.any())
      .optional()
      .describe(
        'Partial patch for the selected block only: map changed canonical sub-block ids to replacement values. Do not send a full workflow document, unchanged fields, or invented keys. Use `get_blocks_metadata` for canonical ids and `get_user_workflow` for current derived sub-block entries.'
      ),
    currentWorkflowState: z.string().optional(),
  })
  .strict()
  .describe(
    'Single-block patch tool. Default to this when only one existing block needs a `name`, `enabled`, or `subBlocks` change and the workflow graph stays the same.'
  )

const EditCustomToolArgs = buildEntityDocumentMutationArgs(CUSTOM_TOOL_DOCUMENT_FORMAT)
const CreateCustomToolArgs = buildEntityDocumentMutationArgs(CUSTOM_TOOL_DOCUMENT_FORMAT, {
  includeEntityId: false,
})
const GetIndicatorArgs = z
  .object({
    entityId: RequiredId.optional(),
    runtimeId: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Built-in default indicator runtime id from `list_indicators`, such as `RSI`. Use this for read-only built-in inspection.'
      ),
  })
  .strict()
const EditIndicatorArgs = buildEntityDocumentMutationArgs(INDICATOR_DOCUMENT_FORMAT)
const CreateIndicatorArgs = buildEntityDocumentMutationArgs(INDICATOR_DOCUMENT_FORMAT, {
  includeEntityId: false,
})
const EditSkillArgs = buildEntityDocumentMutationArgs(SKILL_DOCUMENT_FORMAT)
const CreateSkillArgs = buildEntityDocumentMutationArgs(SKILL_DOCUMENT_FORMAT, {
  includeEntityId: false,
})
const EditMcpServerArgs = buildEntityDocumentMutationArgs(MCP_SERVER_DOCUMENT_FORMAT)
const CreateMcpServerArgs = buildEntityDocumentMutationArgs(MCP_SERVER_DOCUMENT_FORMAT, {
  includeEntityId: false,
})

// Tool argument schemas for the Studio runtime tool surface
export const ToolArgSchemas = {
  plan: z.object({
    objective: z.string().optional(),
    todoList: z
      .array(
        z.union([
          z.string(),
          z.object({
            id: z.string().optional(),
            todoId: z.string().optional(),
            content: z.string(),
          }),
        ])
      )
      .optional(),
  }),
  checkoff_todo: z.object({
    id: z.string().optional(),
    todoId: z.string().optional(),
  }),
  mark_todo_in_progress: z.object({
    id: z.string().optional(),
    todoId: z.string().optional(),
  }),
  get_user_workflow: z
    .object({
      workflowId: RequiredId,
    })
    .strict(),
  create_workflow: CreateWorkflowArgs,
  list_user_workflows: z.object({}),
  get_workflow_from_name: z.object({ workflow_name: z.string().trim().min(1) }).strict(),
  get_global_workflow_variables: z.object({
    workflowId: RequiredId,
  }),
  set_global_workflow_variables: z.object({
    workflowId: RequiredId,
    operations: z.array(
      z.object({
        operation: z.enum(['add', 'delete', 'edit']),
        name: z.string(),
        type: z.enum(['plain', 'number', 'boolean', 'array', 'object']).optional(),
        value: z.string().optional(),
      })
    ),
  }),
  oauth_request_access: z.object({
    providerName: z.string().optional(),
  }),
  deploy_workflow: z.object({
    action: z.enum(['deploy', 'undeploy']).optional().default('deploy'),
    deployType: z.enum(['api', 'chat']).optional().default('api'),
    workflowId: RequiredId,
  }),
  check_deployment_status: z.object({
    workflowId: RequiredId,
  }),

  edit_workflow: EditWorkflowArgs,
  edit_workflow_block: EditWorkflowBlockArgs,
  rename_workflow: RenameWorkflowArgs,

  run_workflow: z.object({
    workflowId: RequiredId,
    workflow_input: z.union([z.string(), z.record(z.any())]).optional(),
  }),

  get_workflow_console: z.object({
    workflowId: RequiredId,
    limit: NumberOptional,
    includeDetails: BooleanOptional,
  }),

  get_blocks_and_tools: GetBlocksAndToolsInput,

  get_blocks_metadata: GetBlocksMetadataInput,

  get_indicator_catalog: GetIndicatorCatalogInput,

  get_indicator_metadata: GetIndicatorMetadataInput,

  get_trigger_blocks: GetTriggerBlocksInput,

  search_documentation: z.object({
    query: z.string(),
    topK: NumberOptional,
  }),

  search_online: z.object({
    query: z.string(),
    num: z.number().optional().default(10),
    type: z.enum(['search', 'news', 'places', 'images']).optional().default('search'),
    gl: z.string().optional(),
    hl: z.string().optional(),
  }),

  make_api_request: z.object({
    url: z.string(),
    method: z.enum(['GET', 'POST', 'PUT']),
    queryParams: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    headers: z.record(z.string()).optional(),
    body: z.union([z.record(z.any()), z.string()]).optional(),
  }),

  get_environment_variables: WorkflowContextArgs,

  set_environment_variables: WorkflowContextArgs.extend({
    variables: z.record(z.string()),
  }),

  get_oauth_credentials: WorkflowContextArgs,

  get_credentials: WorkflowContextArgs,

  gdrive_request_access: z.object({}),

  list_gdrive_files: WorkflowContextArgs.extend({
    search_query: z.string().optional(),
    num_results: z.number().optional().default(50),
  }),

  read_gdrive_file: z.object({
    fileId: z.string(),
    type: z.enum(['doc', 'sheet']),
    range: z.string().optional(),
    workflowId: z.string().optional(),
  }),

  knowledge_base: KnowledgeBaseArgsSchema,

  list_custom_tools: z.object({}),
  get_custom_tool: EntityReviewTargetArgs,
  create_custom_tool: CreateCustomToolArgs,
  edit_custom_tool: EditCustomToolArgs,
  rename_custom_tool: EditCustomToolArgs,

  list_monitors: z.object({
    workflowId: z.string().optional(),
    blockId: z.string().optional(),
  }),
  get_monitor: z.object({
    monitorId: RequiredId,
  }),
  edit_monitor: z.object({
    monitorId: RequiredId,
    monitorDocument: z.string().min(1),
    documentFormat: z.literal(MONITOR_DOCUMENT_FORMAT).optional(),
  }),

  list_indicators: z.object({}),
  get_indicator: GetIndicatorArgs,
  create_indicator: CreateIndicatorArgs,
  edit_indicator: EditIndicatorArgs,
  rename_indicator: EditIndicatorArgs,

  list_skills: z.object({}),
  get_skill: EntityReviewTargetArgs,
  create_skill: CreateSkillArgs,
  edit_skill: EditSkillArgs,
  rename_skill: EditSkillArgs,

  list_mcp_servers: z.object({}),
  get_mcp_server: EntityReviewTargetArgs,
  create_mcp_server: CreateMcpServerArgs,
  edit_mcp_server: EditMcpServerArgs,
  rename_mcp_server: EditMcpServerArgs,

  sleep: z.object({
    seconds: z
      .number()
      .min(0)
      .max(180)
      .describe('The number of seconds to sleep (0-180, max 3 minutes)'),
  }),

  get_block_outputs: GetBlockOutputsInput.extend({
    workflowId: RequiredId,
  }),

  get_block_upstream_references: GetBlockUpstreamReferencesInput.extend({
    workflowId: RequiredId,
  }),
} as const

// Tool-specific SSE schemas (tool_call with typed arguments)
function toolCallSSEFor<TName extends ToolId, TArgs extends z.ZodTypeAny>(
  name: TName,
  argsSchema: TArgs
) {
  return ToolCallSSEBase.extend({
    data: ToolCallSSEBase.shape.data.extend({
      name: z.literal(name),
      arguments: argsSchema,
    }),
  })
}

export const ToolSSESchemas = {
  plan: toolCallSSEFor('plan', ToolArgSchemas.plan),
  checkoff_todo: toolCallSSEFor('checkoff_todo', ToolArgSchemas.checkoff_todo),
  mark_todo_in_progress: toolCallSSEFor(
    'mark_todo_in_progress',
    ToolArgSchemas.mark_todo_in_progress
  ),
  get_user_workflow: toolCallSSEFor('get_user_workflow', ToolArgSchemas.get_user_workflow),
  create_workflow: toolCallSSEFor('create_workflow', ToolArgSchemas.create_workflow),
  list_user_workflows: toolCallSSEFor('list_user_workflows', ToolArgSchemas.list_user_workflows),
  get_workflow_from_name: toolCallSSEFor(
    'get_workflow_from_name',
    ToolArgSchemas.get_workflow_from_name
  ),
  get_global_workflow_variables: toolCallSSEFor(
    'get_global_workflow_variables',
    ToolArgSchemas.get_global_workflow_variables
  ),
  set_global_workflow_variables: toolCallSSEFor(
    'set_global_workflow_variables',
    ToolArgSchemas.set_global_workflow_variables
  ),
  edit_workflow: toolCallSSEFor('edit_workflow', ToolArgSchemas.edit_workflow),
  edit_workflow_block: toolCallSSEFor('edit_workflow_block', ToolArgSchemas.edit_workflow_block),
  rename_workflow: toolCallSSEFor('rename_workflow', ToolArgSchemas.rename_workflow),
  run_workflow: toolCallSSEFor('run_workflow', ToolArgSchemas.run_workflow),
  get_workflow_console: toolCallSSEFor('get_workflow_console', ToolArgSchemas.get_workflow_console),
  get_blocks_and_tools: toolCallSSEFor('get_blocks_and_tools', ToolArgSchemas.get_blocks_and_tools),
  get_blocks_metadata: toolCallSSEFor('get_blocks_metadata', ToolArgSchemas.get_blocks_metadata),
  get_indicator_catalog: toolCallSSEFor(
    'get_indicator_catalog',
    ToolArgSchemas.get_indicator_catalog
  ),
  get_indicator_metadata: toolCallSSEFor(
    'get_indicator_metadata',
    ToolArgSchemas.get_indicator_metadata
  ),
  get_trigger_blocks: toolCallSSEFor('get_trigger_blocks', ToolArgSchemas.get_trigger_blocks),
  search_documentation: toolCallSSEFor('search_documentation', ToolArgSchemas.search_documentation),
  search_online: toolCallSSEFor('search_online', ToolArgSchemas.search_online),
  make_api_request: toolCallSSEFor('make_api_request', ToolArgSchemas.make_api_request),
  get_environment_variables: toolCallSSEFor(
    'get_environment_variables',
    ToolArgSchemas.get_environment_variables
  ),
  set_environment_variables: toolCallSSEFor(
    'set_environment_variables',
    ToolArgSchemas.set_environment_variables
  ),
  get_oauth_credentials: toolCallSSEFor(
    'get_oauth_credentials',
    ToolArgSchemas.get_oauth_credentials
  ),
  get_credentials: toolCallSSEFor('get_credentials', ToolArgSchemas.get_credentials),
  gdrive_request_access: toolCallSSEFor(
    'gdrive_request_access',
    ToolArgSchemas.gdrive_request_access
  ),
  list_gdrive_files: toolCallSSEFor('list_gdrive_files', ToolArgSchemas.list_gdrive_files),
  read_gdrive_file: toolCallSSEFor('read_gdrive_file', ToolArgSchemas.read_gdrive_file),
  oauth_request_access: toolCallSSEFor('oauth_request_access', ToolArgSchemas.oauth_request_access),
  deploy_workflow: toolCallSSEFor('deploy_workflow', ToolArgSchemas.deploy_workflow),
  check_deployment_status: toolCallSSEFor(
    'check_deployment_status',
    ToolArgSchemas.check_deployment_status
  ),
  knowledge_base: toolCallSSEFor('knowledge_base', ToolArgSchemas.knowledge_base),
  list_custom_tools: toolCallSSEFor('list_custom_tools', ToolArgSchemas.list_custom_tools),
  get_custom_tool: toolCallSSEFor('get_custom_tool', ToolArgSchemas.get_custom_tool),
  create_custom_tool: toolCallSSEFor('create_custom_tool', ToolArgSchemas.create_custom_tool),
  edit_custom_tool: toolCallSSEFor('edit_custom_tool', ToolArgSchemas.edit_custom_tool),
  rename_custom_tool: toolCallSSEFor('rename_custom_tool', ToolArgSchemas.rename_custom_tool),
  list_monitors: toolCallSSEFor('list_monitors', ToolArgSchemas.list_monitors),
  get_monitor: toolCallSSEFor('get_monitor', ToolArgSchemas.get_monitor),
  edit_monitor: toolCallSSEFor('edit_monitor', ToolArgSchemas.edit_monitor),
  list_indicators: toolCallSSEFor('list_indicators', ToolArgSchemas.list_indicators),
  get_indicator: toolCallSSEFor('get_indicator', ToolArgSchemas.get_indicator),
  create_indicator: toolCallSSEFor('create_indicator', ToolArgSchemas.create_indicator),
  edit_indicator: toolCallSSEFor('edit_indicator', ToolArgSchemas.edit_indicator),
  rename_indicator: toolCallSSEFor('rename_indicator', ToolArgSchemas.rename_indicator),
  list_skills: toolCallSSEFor('list_skills', ToolArgSchemas.list_skills),
  get_skill: toolCallSSEFor('get_skill', ToolArgSchemas.get_skill),
  create_skill: toolCallSSEFor('create_skill', ToolArgSchemas.create_skill),
  edit_skill: toolCallSSEFor('edit_skill', ToolArgSchemas.edit_skill),
  rename_skill: toolCallSSEFor('rename_skill', ToolArgSchemas.rename_skill),
  list_mcp_servers: toolCallSSEFor('list_mcp_servers', ToolArgSchemas.list_mcp_servers),
  get_mcp_server: toolCallSSEFor('get_mcp_server', ToolArgSchemas.get_mcp_server),
  create_mcp_server: toolCallSSEFor('create_mcp_server', ToolArgSchemas.create_mcp_server),
  edit_mcp_server: toolCallSSEFor('edit_mcp_server', ToolArgSchemas.edit_mcp_server),
  rename_mcp_server: toolCallSSEFor('rename_mcp_server', ToolArgSchemas.rename_mcp_server),
  sleep: toolCallSSEFor('sleep', ToolArgSchemas.sleep),
  get_block_outputs: toolCallSSEFor('get_block_outputs', ToolArgSchemas.get_block_outputs),
  get_block_upstream_references: toolCallSSEFor(
    'get_block_upstream_references',
    ToolArgSchemas.get_block_upstream_references
  ),
} as const

// Known result schemas per tool (what tool_result.result should conform to)
const WorkflowTargetEnvelope = z.object({
  entityKind: z.literal('workflow'),
  entityId: z.string(),
  entityName: z.string().optional(),
  workspaceId: z.string().optional(),
  workflowId: z.string(),
  workflowName: z.string().optional(),
})

const WorkflowDocumentEnvelope = WorkflowTargetEnvelope.extend({
  documentFormat: z.literal(TG_MERMAID_DOCUMENT_FORMAT),
  entityDocument: z.string(),
  workflowDocument: z.string(),
  workflowSummary: z
    .object({
      blocks: z.array(
        z.object({
          blockId: z.string(),
          blockType: z.string(),
          blockName: z.string(),
          enabled: z.boolean().optional(),
          subBlockIds: z.array(z.string()),
        })
      ),
    })
    .optional(),
})

const GenericEntityListEntry = z.object({
  entityId: z.string(),
  entityName: z.string(),
  workspaceId: z.string().optional(),
  entityDescription: z.string().optional(),
  entityTitle: z.string().optional(),
  entityFunctionName: z.string().optional(),
  entityColor: z.string().optional(),
  entityTransport: z.string().optional(),
  entityUrl: z.string().optional(),
  entityEnabled: z.boolean().optional(),
  entityConnectionStatus: z.string().optional(),
})

const GenericEntityListResult = z.object({
  entityKind: z.enum(['skill', 'custom_tool', 'indicator', 'mcp_server']),
  entities: z.array(GenericEntityListEntry),
  count: z.number(),
})

const IndicatorListEntry = z.object({
  name: z.string(),
  source: z.enum(['default', 'custom']),
  color: z.string().optional(),
  editable: z.boolean(),
  callableInFunctionBlock: z.boolean(),
  inputTitles: z.array(z.string()).optional(),
  entityId: z.string().optional(),
  runtimeId: z.string().optional(),
})

const IndicatorListResult = z.object({
  entityKind: z.literal('indicator'),
  indicators: z.array(IndicatorListEntry),
  count: z.number(),
})

const EntityDocumentEnvelopeBase = z.object({
  entityKind: z.enum(['skill', 'custom_tool', 'indicator', 'mcp_server']),
  entityId: z.string().optional(),
  entityName: z.string().optional(),
  entityDocument: z.string(),
})

const SkillDocumentEnvelope = EntityDocumentEnvelopeBase.extend({
  documentFormat: z.literal(SKILL_DOCUMENT_FORMAT),
})

const CustomToolDocumentEnvelope = EntityDocumentEnvelopeBase.extend({
  documentFormat: z.literal(CUSTOM_TOOL_DOCUMENT_FORMAT),
})

const MonitorListEntry = z.object({
  monitorId: z.string(),
  monitorName: z.string(),
  monitorDescription: z.string().optional(),
  workflowId: z.string(),
  blockId: z.string(),
  providerId: z.string(),
  indicatorId: z.string(),
  interval: z.string(),
  isActive: z.boolean(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})

const MonitorListResult = z.object({
  surfaceKind: z.literal('monitor'),
  monitors: z.array(MonitorListEntry),
  count: z.number(),
})

const MonitorDocumentEnvelope = z.object({
  surfaceKind: z.literal('monitor'),
  monitorId: z.string(),
  monitorName: z.string().optional(),
  documentFormat: z.literal(MONITOR_DOCUMENT_FORMAT),
  monitorDocument: z.string(),
})

const IndicatorDocumentEnvelope = EntityDocumentEnvelopeBase.extend({
  documentFormat: z.literal(INDICATOR_DOCUMENT_FORMAT),
})

const McpServerDocumentEnvelope = EntityDocumentEnvelopeBase.extend({
  documentFormat: z.literal(MCP_SERVER_DOCUMENT_FORMAT),
})

const EditEntityDocumentResultBase = z.object({
  success: z.boolean(),
  reviewSessionId: z.string().optional(),
  draftSessionId: z.string().optional(),
})

const WorkflowMutationResult = WorkflowTargetEnvelope.extend({
  success: z.boolean(),
})

const CustomToolDocumentMutationResult = EditEntityDocumentResultBase.merge(
  CustomToolDocumentEnvelope.extend({
    entityKind: z.literal('custom_tool'),
  })
)

const IndicatorDocumentMutationResult = EditEntityDocumentResultBase.merge(
  IndicatorDocumentEnvelope.extend({
    entityKind: z.literal('indicator'),
  })
)

const SkillDocumentMutationResult = EditEntityDocumentResultBase.merge(
  SkillDocumentEnvelope.extend({
    entityKind: z.literal('skill'),
  })
)

const McpServerDocumentMutationResult = EditEntityDocumentResultBase.merge(
  McpServerDocumentEnvelope.extend({
    entityKind: z.literal('mcp_server'),
  })
)

const WorkflowPreviewEdge = z.object({
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
})

const BuildOrEditWorkflowResult = WorkflowDocumentEnvelope.extend({
  workflowState: z.unknown().optional(),
  preview: z
    .object({
      blockDiff: z.object({
        added: z.array(z.string()),
        removed: z.array(z.string()),
        updated: z.array(z.string()),
      }),
      edgeDiff: z.object({
        added: z.array(WorkflowPreviewEdge),
        removed: z.array(WorkflowPreviewEdge),
      }),
      warnings: z.array(z.string()),
    })
    .optional(),
  data: z
    .object({
      blocksCount: z.number(),
      edgesCount: z.number(),
    })
    .optional(),
})

const ExecutionEntry = z.object({
  id: z.string(),
  executionId: z.string(),
  level: z.string(),
  trigger: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  totalCost: z.number().nullable(),
  totalTokens: z.number().nullable(),
  blockExecutions: z.array(z.any()),
  output: z.any().optional(),
  errorMessage: z.string().optional(),
  errorBlock: z
    .object({
      blockId: z.string().optional(),
      blockName: z.string().optional(),
      blockType: z.string().optional(),
    })
    .optional(),
})

export const ToolResultSchemas = {
  plan: z.object({
    objective: z.string().optional(),
    todoList: z.array(z.any()).optional(),
  }),
  checkoff_todo: z.object({
    todoId: z.string().optional(),
    id: z.string().optional(),
  }),
  mark_todo_in_progress: z.object({
    todoId: z.string().optional(),
    id: z.string().optional(),
  }),
  get_user_workflow: WorkflowDocumentEnvelope,
  create_workflow: WorkflowMutationResult,
  list_user_workflows: GenericEntityListResult.extend({
    entityKind: z.literal('workflow'),
  }),
  get_workflow_from_name: WorkflowDocumentEnvelope,
  get_global_workflow_variables: z
    .object({ variables: z.record(z.any()) })
    .or(z.array(z.object({ name: z.string(), value: z.any() }))),
  set_global_workflow_variables: z
    .object({ variables: z.record(z.any()) })
    .or(z.object({ message: z.any().optional(), data: z.any().optional() })),
  oauth_request_access: z.object({
    granted: z.boolean().optional(),
    message: z.string().optional(),
  }),

  edit_workflow: BuildOrEditWorkflowResult,
  edit_workflow_block: BuildOrEditWorkflowResult,
  rename_workflow: WorkflowMutationResult,
  run_workflow: z.object({
    executionId: z.string().optional(),
    message: z.any().optional(),
    data: z.any().optional(),
  }),
  get_workflow_console: z.object({ entries: z.array(ExecutionEntry) }),
  get_blocks_and_tools: GetBlocksAndToolsResult,
  get_blocks_metadata: GetBlocksMetadataResult,
  get_indicator_catalog: GetIndicatorCatalogResult,
  get_indicator_metadata: GetIndicatorMetadataResult,
  get_trigger_blocks: GetTriggerBlocksResult,
  search_documentation: z.object({ results: z.array(z.any()) }),
  search_online: z.object({
    results: z.array(z.any()),
    query: z.string().optional(),
    type: z.string().optional(),
    requestedType: z.string().optional(),
    totalResults: z.number().optional(),
    source: z.enum(['exa', 'serper', 'duckduckgo']).optional(),
    warnings: z.array(z.string()).optional(),
  }),
  make_api_request: z.object({
    status: z.number(),
    statusText: z.string().optional(),
    headers: z.record(z.string()).optional(),
    data: z.any().optional(),
    body: z.any().optional(),
  }),
  get_environment_variables: z.union([
    z.object({ variableNames: z.array(z.string()), count: z.number() }),
    z.object({ variables: z.record(z.string()) }),
  ]),
  set_environment_variables: z
    .object({ variables: z.record(z.string()) })
    .or(z.object({ message: z.any().optional(), data: z.any().optional() })),
  get_oauth_credentials: z.object({
    credentials: z.array(
      z.object({ id: z.string(), provider: z.string(), isDefault: z.boolean().optional() })
    ),
    total: z.number().optional(),
  }),
  get_credentials: z.union([
    z.object({
      oauth: z.object({
        connected: z.object({
          credentials: z.array(
            z.object({ id: z.string(), provider: z.string(), isDefault: z.boolean().optional() })
          ),
          total: z.number(),
        }),
        notConnected: z
          .object({
            services: z.array(
              z.object({
                providerId: z.string(),
                name: z.string(),
                description: z.string().optional(),
                baseProvider: z.string().optional(),
              })
            ),
            total: z.number(),
          })
          .optional(),
      }),
      environment: z.object({
        variableNames: z.array(z.string()),
        count: z.number(),
        personalVariables: z.array(z.string()).optional(),
        workspaceVariables: z.array(z.string()).optional(),
        conflicts: z.array(z.string()).optional(),
      }),
    }),
    z.object({
      oauth: z.object({
        credentials: z.array(
          z.object({ id: z.string(), provider: z.string(), isDefault: z.boolean().optional() })
        ),
        total: z.number(),
      }),
      environment: z.object({
        variableNames: z.array(z.string()),
        count: z.number(),
      }),
    }),
  ]),
  gdrive_request_access: z.object({
    granted: z.boolean().optional(),
    message: z.string().optional(),
  }),
  list_gdrive_files: z.object({
    files: z.array(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        mimeType: z.string().optional(),
        size: z.number().optional(),
      })
    ),
  }),
  read_gdrive_file: z.object({
    type: z.string().optional(),
    content: z.string().optional(),
    data: z.any().optional(),
    rows: z.any().optional(),
    range: z.string().optional(),
    metadata: z.any().optional(),
  }),
  deploy_workflow: z.object({
    action: z.enum(['deploy', 'undeploy']).optional(),
    deployType: z.enum(['api', 'chat']).optional(),
    isDeployed: z.boolean().optional(),
    deployedAt: z.string().optional(),
    needsApiKey: z.boolean().optional(),
    message: z.string().optional(),
    endpoint: z.string().optional(),
    curlCommand: z.string().optional(),
    apiKeyPlaceholder: z.string().optional(),
    openedModal: z.boolean().optional(),
  }),
  check_deployment_status: z.object({
    isDeployed: z.boolean(),
    deploymentTypes: z.array(z.string()),
    apiDeployed: z.boolean(),
    chatDeployed: z.boolean(),
    deployedAt: z.string().nullable(),
  }),
  knowledge_base: KnowledgeBaseResultSchema,
  list_custom_tools: GenericEntityListResult.extend({
    entityKind: z.literal('custom_tool'),
  }),
  get_custom_tool: CustomToolDocumentEnvelope.extend({
    entityKind: z.literal('custom_tool'),
  }),
  create_custom_tool: CustomToolDocumentMutationResult,
  edit_custom_tool: CustomToolDocumentMutationResult,
  rename_custom_tool: CustomToolDocumentMutationResult,
  list_monitors: MonitorListResult,
  get_monitor: MonitorDocumentEnvelope,
  edit_monitor: z
    .object({
      success: z.boolean(),
    })
    .merge(MonitorDocumentEnvelope),
  list_indicators: IndicatorListResult,
  get_indicator: IndicatorDocumentEnvelope.extend({
    entityKind: z.literal('indicator'),
  }),
  create_indicator: IndicatorDocumentMutationResult,
  edit_indicator: IndicatorDocumentMutationResult,
  rename_indicator: IndicatorDocumentMutationResult,
  list_skills: GenericEntityListResult.extend({
    entityKind: z.literal('skill'),
  }),
  get_skill: SkillDocumentEnvelope.extend({
    entityKind: z.literal('skill'),
  }),
  create_skill: SkillDocumentMutationResult,
  edit_skill: SkillDocumentMutationResult,
  rename_skill: SkillDocumentMutationResult,
  list_mcp_servers: GenericEntityListResult.extend({
    entityKind: z.literal('mcp_server'),
  }),
  get_mcp_server: McpServerDocumentEnvelope.extend({
    entityKind: z.literal('mcp_server'),
  }),
  create_mcp_server: McpServerDocumentMutationResult,
  edit_mcp_server: McpServerDocumentMutationResult,
  rename_mcp_server: McpServerDocumentMutationResult,
  sleep: z.object({
    success: z.boolean(),
    seconds: z.number(),
    message: z.string().optional(),
  }),
  get_block_outputs: GetBlockOutputsResult,
  get_block_upstream_references: GetBlockUpstreamReferencesResult,
} as const

// Consolidated registry entry per tool
export const ToolRegistry = Object.freeze(
  ToolIds.options.reduce(
    (acc, toolId) => {
      const args = ToolArgSchemas[toolId]
      const sse = ToolSSESchemas[toolId]
      const result = ToolResultSchemas[toolId]
      acc[toolId] = { id: toolId, args, sse, result }
      return acc
    },
    {} as Record<
      ToolId,
      { id: ToolId; args: z.ZodTypeAny; sse: z.ZodTypeAny; result: z.ZodTypeAny }
    >
  )
)

export function isToolId(toolId: string): toolId is ToolId {
  return Object.hasOwn(ToolRegistry, toolId)
}

export function getToolContract(toolId: string) {
  return isToolId(toolId) ? ToolRegistry[toolId] : undefined
}
