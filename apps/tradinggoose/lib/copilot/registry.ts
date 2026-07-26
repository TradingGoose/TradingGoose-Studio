import { z } from 'zod'
import {
  CUSTOM_TOOL_DOCUMENT_FORMAT,
  INDICATOR_DOCUMENT_FORMAT,
  KNOWLEDGE_BASE_DOCUMENT_FORMAT,
  MCP_SERVER_DOCUMENT_FORMAT,
  SKILL_DOCUMENT_FORMAT,
  WATCHLIST_DOCUMENT_FORMAT,
  WORKFLOW_VARIABLE_DOCUMENT_FORMAT,
} from '@/lib/copilot/entity-documents'
import { MONITOR_DOCUMENT_FORMAT } from '@/lib/copilot/monitor/monitor-documents'
import { REVIEW_ENTITY_KINDS } from '@/lib/copilot/review-sessions/types'
import { ListingIdentitySchema } from '@/lib/listing/identity'
import {
  TG_MERMAID_DOCUMENT_FORMAT,
  WORKFLOW_GRAPH_MERMAID_DOCUMENT_FORMAT,
} from '@/lib/workflows/document-format'
import {
  DASHBOARD_LAYOUT_DOCUMENT_FORMAT,
  DASHBOARD_LAYOUT_STRUCTURE_DOCUMENT_FORMAT,
} from '@/widgets/layout-document'
import {
  GetAgentAccessoryCatalogInput,
  GetAgentAccessoryCatalogResult,
  GetAvailableBlocksInput,
  GetAvailableBlocksResult,
  GetBlocksMetadataInput,
  GetBlocksMetadataResult,
  GetIndicatorCatalogInput,
  GetIndicatorCatalogResult,
  GetIndicatorMetadataInput,
  GetIndicatorMetadataResult,
  ReadBlockOutputsInput,
  ReadBlockOutputsResult,
  ReadBlockUpstreamReferencesInput,
  ReadBlockUpstreamReferencesResult,
  WidgetCatalogItemSchema,
  WidgetMetadataProfileSchema,
} from './tools/shared/schemas'

// Tool IDs supported by the Copilot runtime
const COPILOT_TOOL_IDS = [
  'plan',
  'checkoff_todo',
  'mark_todo_in_progress',
  'read_workflow',
  'create_workflow',
  'edit_workflow',
  'edit_workflow_block',
  'rename_workflow',
  'run_workflow',
  'read_workflow_logs',
  'get_available_blocks',
  'get_blocks_metadata',
  'get_agent_accessory_catalog',
  'get_indicator_catalog',
  'get_indicator_metadata',
  'search_documentation',
  'search_listing',
  'search_online',
  'make_api_request',
  'read_environment_variables',
  'set_environment_variables',
  'read_oauth_credentials',
  'read_credentials',
  'list_workflows',
  'edit_workflow_variable',
  'oauth_request_access',
  'deploy_workflow',
  'check_deployment_status',
  'list_knowledge_bases',
  'read_knowledge_base',
  'create_knowledge_base',
  'edit_knowledge_base',
  'rename_knowledge_base',
  'query_knowledge_base',
  'list_custom_tools',
  'read_custom_tool',
  'create_custom_tool',
  'edit_custom_tool',
  'rename_custom_tool',
  'list_monitors',
  'read_monitor',
  'edit_monitor',
  'list_indicators',
  'read_indicator',
  'create_indicator',
  'edit_indicator',
  'rename_indicator',
  'list_skills',
  'read_skill',
  'create_skill',
  'edit_skill',
  'rename_skill',
  'list_mcp_servers',
  'read_mcp_server',
  'create_mcp_server',
  'edit_mcp_server',
  'rename_mcp_server',
  'list_watchlist',
  'read_watchlist',
  'create_watchlist',
  'edit_watchlist',
  'rename_watchlist',
  'list_layout',
  'create_layout',
  'read_layout',
  'edit_layout',
  'rename_layout',
  'edit_widget',
  'get_available_widgets',
  'get_widgets_metadata',
  'sleep',
  'read_block_outputs',
  'read_block_upstream_references',
  'gdrive_request_access',
  'list_gdrive_files',
  'read_gdrive_file',
] as const
export const ToolIds = z.enum(COPILOT_TOOL_IDS)
export type ToolId = (typeof COPILOT_TOOL_IDS)[number]
export const CopilotTool = Object.fromEntries(COPILOT_TOOL_IDS.map((id) => [id, id])) as {
  [K in ToolId]: K
}

/**
 * Tools whose execution provenance targets one owner-scoped dashboard layout.
 * The copilot store applies the turn's dashboard-layout context to exactly
 * these tools at pin time.
 */
export const DASHBOARD_LAYOUT_TOOL_NAMES: ReadonlySet<string> = new Set<ToolId>([
  CopilotTool.read_layout,
  CopilotTool.edit_layout,
  CopilotTool.rename_layout,
  CopilotTool.edit_widget,
])

// Reusable small schemas
const BooleanOptional = z.boolean().optional()
const NumberOptional = z.number().optional()
const RequiredId = z.string().trim().min(1)
const CUSTOM_TOOL_DOCUMENT_ARGUMENT_DESCRIPTION =
  'Full `tg-custom-tool-document-v1` content JSON with exactly `schemaText` and `codeText`. Identity is supplied separately as `name`. `schemaText` is a JSON-encoded string, not an object, for an OpenAI function tool schema: {"type":"function","function":{"description":"What the tool does","parameters":{"type":"object","properties":{},"required":[]}}}. Do not include a `name` property inside `function`. `codeText` is raw async JavaScript function body only; use <paramName> for inputs and {{ENV_VAR_NAME}} for environment variables.'
const EntityTargetArgs = z.object({
  entityId: RequiredId,
})
const RenameSavedEntityArgs = EntityTargetArgs.extend({
  name: z.string().trim().min(1).describe('New entity name.'),
}).strict()
const WorkspaceTargetArgs = z.object({
  workspaceId: RequiredId,
})
const PersonalOrWorkspaceReadArgs = z.discriminatedUnion('scope', [
  z
    .object({
      scope: z.literal('personal'),
    })
    .strict(),
  WorkspaceTargetArgs.extend({
    scope: z.literal('workspace'),
  }).strict(),
])
const SetEnvironmentVariablesArgs = z.discriminatedUnion('scope', [
  z
    .object({
      scope: z.literal('personal'),
      variables: z.record(z.string(), z.string()),
    })
    .strict(),
  WorkspaceTargetArgs.extend({
    scope: z.literal('workspace'),
    variables: z.record(z.string(), z.string()),
  }).strict(),
])

function buildEntityDocumentMutationArgs<TDocumentFormat extends string>(
  documentFormat: TDocumentFormat
) {
  const shape = {
    entityDocument: z.string().min(1),
    documentFormat: z.literal(documentFormat).optional(),
  }

  return EntityTargetArgs.extend(shape)
}

function buildEntityDocumentCreateArgs<TDocumentFormat extends string>(
  documentFormat: TDocumentFormat
) {
  return WorkspaceTargetArgs.extend({
    name: z.string().trim().min(1).describe('Canonical entity name.'),
    entityDocument: z.string().min(1),
    documentFormat: z.literal(documentFormat).optional(),
  }).strict()
}

const CreateWorkflowArgs = z
  .object({
    name: z.string().trim().min(1).optional(),
    description: z.string().optional(),
    folderId: z.string().nullable().optional(),
    workspaceId: RequiredId,
  })
  .strict()

const EditWorkflowArgs = z
  .object({
    entityDocument: z
      .string()
      .min(1)
      .describe(
        'Minimal Mermaid flowchart for the entire workflow graph, not a partial patch. Include flowchart direction, existing block ids as node/subgraph ids, new block `id:` and `type:` labels, subgraph nesting, and edge arrows. Do not include `%% TG_*` metadata, subBlocks, outputs, enabled, positions, or full block metadata. Existing block ids are stable identities: their type and details are preserved by id, and supplied labels must match current block names. This tool cannot replace an existing block or change its type; new ids create new blocks with generated positions. Use edit_workflow_block for block internals.'
      ),
    removedBlockIds: z
      .array(z.string().trim().min(1))
      .optional()
      .describe(
        'Existing block root ids intentionally removed from the workflow graph. Removing a loop or parallel root removes its descendants.'
      ),
    entityId: RequiredId,
  })
  .strict()
  .describe(
    "Full workflow topology rewrite tool using minimal Mermaid. Do not use this to replace an existing block, rename one existing block, or patch one block's `enabled` or `subBlocks`; use `edit_workflow_block` instead."
  )

const EditWorkflowBlockArgs = z
  .object({
    entityId: RequiredId,
    blockId: z
      .string()
      .trim()
      .min(1)
      .describe(
        'Exact existing workflow block instance id from `read_workflow.workflowSummary.blocks`. Do not invent ids.'
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
      .record(z.string(), z.any())
      .optional()
      .describe(
        'Partial patch for the selected block only: map changed canonical sub-block ids to replacement values. Do not send a full workflow document, unchanged fields, or invented keys. Use `get_blocks_metadata` for canonical ids and `read_workflow` for current derived sub-block entries.'
      ),
  })
  .strict()
  .describe(
    'Single-block patch tool. Default to this when only one existing block needs a `name`, `enabled`, or `subBlocks` change and the workflow graph stays the same.'
  )

const CustomToolDocumentMutationShape = {
  entityDocument: z.string().min(1).describe(CUSTOM_TOOL_DOCUMENT_ARGUMENT_DESCRIPTION),
  documentFormat: z.literal(CUSTOM_TOOL_DOCUMENT_FORMAT).optional(),
}
const EditCustomToolArgs = EntityTargetArgs.extend(CustomToolDocumentMutationShape)
  .strict()
  .describe('Update a saved custom tool by replacing the full custom-tool document.')
const CreateCustomToolArgs = WorkspaceTargetArgs.extend({
  name: z.string().trim().min(1).describe('Canonical custom-tool name.'),
  ...CustomToolDocumentMutationShape,
})
  .strict()
  .describe('Create a custom tool from the full custom-tool document.')
const GetIndicatorArgs = z
  .object({
    entityId: RequiredId.optional(),
    runtimeId: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Indicator runtime id from `list_indicators`. Built-in ids inspect read-only defaults; custom ids resolve the saved custom indicator.'
      ),
  })
  .strict()
  .refine((args) => !!args.entityId || !!args.runtimeId, {
    message: 'entityId or runtimeId is required',
  })
  .refine((args) => !(args.entityId && args.runtimeId), {
    message: 'Use either entityId or runtimeId, not both',
  })
const EditIndicatorArgs = buildEntityDocumentMutationArgs(INDICATOR_DOCUMENT_FORMAT)
const CreateIndicatorArgs = buildEntityDocumentCreateArgs(INDICATOR_DOCUMENT_FORMAT)
const EditSkillArgs = buildEntityDocumentMutationArgs(SKILL_DOCUMENT_FORMAT)
const CreateSkillArgs = buildEntityDocumentCreateArgs(SKILL_DOCUMENT_FORMAT)
const EditMcpServerArgs = buildEntityDocumentMutationArgs(MCP_SERVER_DOCUMENT_FORMAT)
const CreateMcpServerArgs = buildEntityDocumentCreateArgs(MCP_SERVER_DOCUMENT_FORMAT)
const EditWatchlistArgs = buildEntityDocumentMutationArgs(WATCHLIST_DOCUMENT_FORMAT)
const CreateWatchlistArgs = buildEntityDocumentCreateArgs(WATCHLIST_DOCUMENT_FORMAT)
const CreateDashboardLayoutArgs = z
  .object({
    name: z.string().trim().min(1).optional(),
    workspaceId: RequiredId,
  })
  .strict()
  .describe(
    'Create a dashboard layout shell. The first user-owned layout in the workspace is active automatically; later layouts are inactive until activated.'
  )
const DashboardLayoutTargetArgs = EntityTargetArgs.strict()
const EditDashboardLayoutArgs = EntityTargetArgs.extend({
  entityDocument: z
    .string()
    .min(1)
    .describe(
      'Raw tg-dashboard-layout-structure-v3 JSON document. Existing panels use id/type to retain their widget or add widget.key to replace it; new panels use widget.key.'
    ),
  documentFormat: z.literal(DASHBOARD_LAYOUT_STRUCTURE_DOCUMENT_FORMAT).optional(),
  removedPanelIds: z
    .array(z.string().trim().min(1))
    .optional()
    .describe(
      'Existing panel ids intentionally removed by omitting them from the submitted layout structure.'
    ),
}).strict()
const EditDashboardWidgetArgs = EntityTargetArgs.extend({
  panelId: RequiredId.describe('Exact dashboard panel id containing the target widget.'),
  pairColor: z
    .enum(['gray', 'red', 'orange', 'blue', 'green', 'purple'])
    .optional()
    .describe(
      "Select this widget's layout-scoped color-store channel. Gray is unlinked/local. Compatible widgets synchronize linked fields only when assigned the same non-gray color; changing color preserves existing local and shared state."
    ),
  params: z
    .record(z.string(), z.any())
    .nullable()
    .optional()
    .describe(
      'Patch persisted local widget params. For a non-gray widget, do not put fields from get_widgets_metadata.linkedParamFields here; update those through colorPair. Data-chart drawing fields are user-managed and unavailable to Copilot.'
    ),
  colorPair: z
    .record(z.string(), z.any())
    .nullable()
    .optional()
    .describe(
      "Patch shared fields in the widget's selected non-gray layout color store. Use { field: null } to clear one shared field, or null to clear the whole selected color channel."
    ),
}).strict()
const GetWidgetsMetadataArgs = z
  .object({
    widgetKeys: z.array(z.string().trim().min(1)).min(1),
  })
  .strict()
const ListWidgetsArgs = z
  .object({
    category: z.enum(['editor', 'list', 'utility', 'trading']).optional(),
  })
  .strict()
const EditWorkflowVariableArgs = EntityTargetArgs.extend({
  entityDocument: z
    .string()
    .min(1)
    .describe(
      'Full `tg-workflow-variable-document-v1` JSON document for workflow variables. Preserve existing `variableId` values from `read_workflow`; choose a new unique `variableId` only for a new variable: {"variables":[{"variableId":"var-risk-limit","name":"riskLimit","type":"number","value":100}]}.'
    ),
  removedVariableIds: z
    .array(z.string().trim().min(1))
    .optional()
    .describe('Existing variable ids intentionally removed from the workflow.'),
  documentFormat: z.literal(WORKFLOW_VARIABLE_DOCUMENT_FORMAT).optional(),
}).strict()
const KnowledgeBaseDocumentMutationShape = {
  entityDocument: z
    .string()
    .min(1)
    .describe(
      'Full `tg-knowledge-base-document-v1` content JSON with exactly `description` and `chunkingConfig`: {"description":"","chunkingConfig":{"maxSize":1024,"minSize":1,"overlap":200}}. Identity is supplied separately as `name` when creating and through rename_knowledge_base when renaming.'
    ),
  documentFormat: z.literal(KNOWLEDGE_BASE_DOCUMENT_FORMAT).optional(),
}
const CreateKnowledgeBaseArgs = WorkspaceTargetArgs.extend({
  name: z.string().trim().min(1).describe('Canonical knowledge-base name.'),
  ...KnowledgeBaseDocumentMutationShape,
})
  .strict()
  .describe('Create a knowledge base in a workspace from the full knowledge-base document.')
const EditKnowledgeBaseArgs = EntityTargetArgs.extend(KnowledgeBaseDocumentMutationShape)
  .strict()
  .describe('Update a knowledge base by replacing the full knowledge-base document.')
const QueryKnowledgeBaseArgs = z
  .object({
    entityId: RequiredId,
    query: z.string().trim().min(1),
    topK: z.number().min(1).max(50).optional(),
  })
  .strict()

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
            content: z.string(),
          }),
        ])
      )
      .optional(),
  }),
  checkoff_todo: z.object({
    id: z.string(),
  }),
  mark_todo_in_progress: z.object({
    id: z.string(),
  }),
  [CopilotTool.read_workflow]: z
    .object({
      entityId: RequiredId,
    })
    .strict(),
  create_workflow: CreateWorkflowArgs,
  [CopilotTool.list_workflows]: WorkspaceTargetArgs.strict(),
  [CopilotTool.edit_workflow_variable]: EditWorkflowVariableArgs,
  oauth_request_access: z.object({
    providerName: z.string().optional(),
  }),
  deploy_workflow: z.object({
    action: z.enum(['deploy', 'undeploy']).optional().default('deploy'),
    deployType: z.enum(['api', 'chat']).optional().default('api'),
    entityId: RequiredId,
  }),
  check_deployment_status: z.object({
    entityId: RequiredId,
  }),

  edit_workflow: EditWorkflowArgs,
  edit_workflow_block: EditWorkflowBlockArgs,
  rename_workflow: RenameSavedEntityArgs,

  run_workflow: z.object({
    entityId: RequiredId,
    triggerBlockId: z
      .string()
      .trim()
      .min(1)
      .describe('Exact trigger block id from `read_workflow.workflowSummary.blocks`.'),
    workflow_input: z.union([z.string(), z.record(z.string(), z.any())]).optional(),
  }),

  [CopilotTool.read_workflow_logs]: EntityTargetArgs.extend({
    limit: NumberOptional,
    includeDetails: BooleanOptional,
  }).strict(),

  [CopilotTool.get_available_blocks]: GetAvailableBlocksInput,

  [CopilotTool.get_blocks_metadata]: GetBlocksMetadataInput,

  [CopilotTool.get_agent_accessory_catalog]: GetAgentAccessoryCatalogInput,

  [CopilotTool.get_indicator_catalog]: GetIndicatorCatalogInput,

  [CopilotTool.get_indicator_metadata]: GetIndicatorMetadataInput,

  search_documentation: z.object({
    query: z.string(),
    topK: NumberOptional,
  }),

  search_listing: z
    .object({
      query: z.string().trim().min(1),
    })
    .strict(),

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
    queryParams: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.union([z.record(z.string(), z.any()), z.string()]).optional(),
  }),

  [CopilotTool.read_environment_variables]: PersonalOrWorkspaceReadArgs,

  set_environment_variables: SetEnvironmentVariablesArgs,

  [CopilotTool.read_oauth_credentials]: PersonalOrWorkspaceReadArgs,

  [CopilotTool.read_credentials]: PersonalOrWorkspaceReadArgs,

  gdrive_request_access: z.object({}),

  list_gdrive_files: WorkspaceTargetArgs.extend({
    credentialId: z.string(),
    search_query: z.string().optional(),
    num_results: z.number().optional().default(50),
  }).strict(),

  read_gdrive_file: WorkspaceTargetArgs.extend({
    credentialId: z.string(),
    fileId: z.string(),
    type: z.enum(['doc', 'sheet']),
    range: z.string().optional(),
  }).strict(),

  list_knowledge_bases: WorkspaceTargetArgs.strict(),
  read_knowledge_base: EntityTargetArgs,
  create_knowledge_base: CreateKnowledgeBaseArgs,
  edit_knowledge_base: EditKnowledgeBaseArgs,
  rename_knowledge_base: RenameSavedEntityArgs,
  query_knowledge_base: QueryKnowledgeBaseArgs,

  list_custom_tools: WorkspaceTargetArgs.strict(),
  [CopilotTool.read_custom_tool]: EntityTargetArgs,
  create_custom_tool: CreateCustomToolArgs,
  edit_custom_tool: EditCustomToolArgs,
  rename_custom_tool: RenameSavedEntityArgs,

  list_monitors: WorkspaceTargetArgs.extend({
    entityId: z.string().optional(),
    blockId: z.string().optional(),
  }).strict(),
  [CopilotTool.read_monitor]: z.object({
    monitorId: RequiredId,
  }),
  edit_monitor: z.object({
    monitorId: RequiredId,
    monitorDocument: z.string().min(1),
    documentFormat: z.literal(MONITOR_DOCUMENT_FORMAT).optional(),
  }),

  [CopilotTool.list_indicators]: WorkspaceTargetArgs.strict(),
  [CopilotTool.read_indicator]: GetIndicatorArgs,
  create_indicator: CreateIndicatorArgs,
  edit_indicator: EditIndicatorArgs,
  rename_indicator: RenameSavedEntityArgs,

  list_skills: WorkspaceTargetArgs.strict(),
  [CopilotTool.read_skill]: EntityTargetArgs,
  create_skill: CreateSkillArgs,
  edit_skill: EditSkillArgs,
  rename_skill: RenameSavedEntityArgs,

  list_mcp_servers: WorkspaceTargetArgs.strict(),
  [CopilotTool.read_mcp_server]: EntityTargetArgs,
  create_mcp_server: CreateMcpServerArgs,
  edit_mcp_server: EditMcpServerArgs,
  rename_mcp_server: RenameSavedEntityArgs,

  list_watchlist: WorkspaceTargetArgs.strict(),
  read_watchlist: EntityTargetArgs,
  create_watchlist: CreateWatchlistArgs,
  edit_watchlist: EditWatchlistArgs,
  rename_watchlist: RenameSavedEntityArgs,
  list_layout: WorkspaceTargetArgs.strict(),
  create_layout: CreateDashboardLayoutArgs,
  read_layout: DashboardLayoutTargetArgs,
  edit_layout: EditDashboardLayoutArgs,
  rename_layout: RenameSavedEntityArgs,
  edit_widget: EditDashboardWidgetArgs,
  get_available_widgets: ListWidgetsArgs,
  get_widgets_metadata: GetWidgetsMetadataArgs,

  sleep: z.object({
    seconds: z
      .number()
      .min(0)
      .max(180)
      .describe('The number of seconds to sleep (0-180, max 3 minutes)'),
  }),

  [CopilotTool.read_block_outputs]: ReadBlockOutputsInput.extend({
    entityId: RequiredId,
  }),

  [CopilotTool.read_block_upstream_references]: ReadBlockUpstreamReferencesInput.extend({
    entityId: RequiredId,
  }),
} as const

export const ServerToolArgSchemas = {
  ...ToolArgSchemas,
} satisfies Record<ToolId, z.ZodTypeAny>

// Known result schemas per tool (what tool_result.result should conform to)
const WorkflowTargetEnvelope = z.object({
  entityKind: z.literal('workflow'),
  entityId: z.string(),
  entityName: z.string(),
  workspaceId: z.string().optional(),
})

const WorkflowDocumentEnvelope = WorkflowTargetEnvelope.extend({
  documentFormat: z.literal(TG_MERMAID_DOCUMENT_FORMAT),
  entityDocument: z.string(),
})

const WorkflowGraphDocumentEnvelope = WorkflowTargetEnvelope.extend({
  documentFormat: z.literal(WORKFLOW_GRAPH_MERMAID_DOCUMENT_FORMAT),
  entityDocument: z.string(),
})

const WorkflowSummaryResult = z.object({
  blocks: z.array(
    z.object({
      blockId: z.string(),
      blockType: z.string(),
      blockName: z.string(),
      enabled: z.boolean().optional(),
      parentId: z.string().optional(),
      subBlockIds: z.array(z.string()),
      connections: z.object({
        externalIn: z.number(),
        externalOut: z.number(),
        internalIn: z.number(),
        internalOut: z.number(),
      }),
    })
  ),
  edges: z.array(
    z.object({
      source: z.string(),
      target: z.string(),
      sourceHandle: z.string().optional(),
      targetHandle: z.string().optional(),
      scope: z.enum(['external', 'internal']),
    })
  ),
  connectionIssues: z.array(
    z.object({
      edgeIndex: z.number(),
      source: z.string(),
      target: z.string(),
      sourceHandle: z.string().optional(),
      targetHandle: z.string().optional(),
      message: z.string(),
    })
  ),
})

const WorkflowVariableReadEnvelope = z.object({
  workflowVariableDocumentFormat: z.literal(WORKFLOW_VARIABLE_DOCUMENT_FORMAT),
  workflowVariableDocument: z.string(),
})

const WorkflowReadDocumentEnvelope = WorkflowDocumentEnvelope.extend({
  workflowSummary: WorkflowSummaryResult,
}).merge(WorkflowVariableReadEnvelope)

const WorkflowVariableDocumentEnvelope = WorkflowTargetEnvelope.extend({
  documentFormat: z.literal(WORKFLOW_VARIABLE_DOCUMENT_FORMAT),
  entityDocument: z.string(),
  variables: z.record(z.string(), z.any()),
})

// A list is a discovery surface: id, canonical name, and basic usability state.
const GenericEntityListEntry = z.object({
  entityId: z.string(),
  entityName: z.string(),
  entityDescription: z.string().optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().optional(),
  isActive: z.boolean().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})

const GenericEntityListResult = z.object({
  entityKind: z.enum([
    'workflow',
    'skill',
    'custom_tool',
    'indicator',
    'mcp_server',
    'watchlist',
    'dashboard_layout',
  ]),
  entities: z.array(GenericEntityListEntry),
  count: z.number(),
})

const KnowledgeBaseDocumentEnvelope = z.object({
  entityKind: z.literal('knowledge_base'),
  entityId: z.string(),
  entityName: z.string(),
  workspaceId: z.string().optional(),
  documentFormat: z.literal(KNOWLEDGE_BASE_DOCUMENT_FORMAT),
  entityDocument: z.string(),
  docCount: z.number().optional(),
  tokenCount: z.number().optional(),
  embeddingModel: z.string().optional(),
  embeddingDimension: z.number().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})

const QueryKnowledgeBaseResult = z.object({
  entityKind: z.literal('knowledge_base'),
  entityId: z.string(),
  entityName: z.string(),
  query: z.string(),
  topK: z.number(),
  totalResults: z.number(),
  results: z.array(
    z.object({
      documentId: z.string(),
      content: z.string(),
      chunkIndex: z.number(),
      similarity: z.number(),
    })
  ),
})

const IndicatorListEntry = z.object({
  name: z.string(),
  source: z.enum(['default', 'custom']),
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
  entityKind: z.enum(['skill', 'custom_tool', 'indicator', 'mcp_server', 'watchlist']),
  entityId: z.string().optional(),
  entityName: z.string(),
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
  source: z.string().optional(),
  providerId: z.string(),
  indicatorId: z.string().optional(),
  interval: z.string().optional(),
  serviceId: z.string().optional(),
  credentialId: z.string().optional(),
  accountId: z.string().optional(),
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

const WatchlistDocumentEnvelope = EntityDocumentEnvelopeBase.extend({
  documentFormat: z.literal(WATCHLIST_DOCUMENT_FORMAT),
})

const DocumentDiffReviewMetadata = z.object({
  requiresReview: z.literal(true).optional(),
  reviewBaseStateHash: z.string().optional(),
  preview: z
    .object({
      documentDiff: z.object({
        before: z.string(),
        after: z.string(),
      }),
    })
    .optional(),
})

const EditEntityDocumentResultBase = DocumentDiffReviewMetadata.extend({
  success: z.boolean(),
})

const SavedEntityRenameResult = DocumentDiffReviewMetadata.extend({
  success: z.boolean(),
  workspaceId: z.string(),
  ownerUserId: z.string().optional(),
  entityKind: z.enum(REVIEW_ENTITY_KINDS),
  entityId: z.string(),
  entityName: z.string(),
  updatedAt: z.string().optional(),
})

const WorkflowMutationResult = WorkflowTargetEnvelope.merge(DocumentDiffReviewMetadata).extend({
  success: z.boolean(),
})
const WorkflowCreateMutationResult = WorkflowMutationResult.extend({
  entityId: z.string().optional(),
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

const KnowledgeBaseDocumentMutationResult = EditEntityDocumentResultBase.merge(
  KnowledgeBaseDocumentEnvelope.extend({
    entityId: z.string().optional(),
  })
)

const McpServerDocumentMutationResult = EditEntityDocumentResultBase.merge(
  McpServerDocumentEnvelope.extend({
    entityKind: z.literal('mcp_server'),
  })
)

const WatchlistDocumentMutationResult = EditEntityDocumentResultBase.merge(
  WatchlistDocumentEnvelope.extend({
    entityKind: z.literal('watchlist'),
  })
)

const DashboardLayoutProjectionEnvelope = z.object({
  entityKind: z.literal('dashboard_layout'),
  entityName: z.string(),
  workspaceId: z.string(),
  ownerUserId: z.string(),
  documentFormat: z.literal(DASHBOARD_LAYOUT_DOCUMENT_FORMAT),
  entityDocument: z.string(),
})

const DashboardLayoutDocumentEnvelope = DashboardLayoutProjectionEnvelope.extend({
  entityId: z.string(),
})

const DashboardLayoutCreateMutationResult = DocumentDiffReviewMetadata.merge(
  DashboardLayoutProjectionEnvelope.extend({
    success: z.boolean(),
    entityId: z.string().optional(),
  })
)

const DashboardLayoutDocumentMutationResult = EditEntityDocumentResultBase.merge(
  DashboardLayoutDocumentEnvelope
)

const WorkflowPreviewEdge = z.object({
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
})

const WorkflowMutationResultShape = {
  requiresReview: z.literal(true).optional(),
  workflowState: z.unknown().optional(),
  reviewBaseStateHash: z.string().optional(),
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
}

const EditWorkflowResult = WorkflowGraphDocumentEnvelope.extend(WorkflowMutationResultShape)
const EditWorkflowBlockResult = WorkflowDocumentEnvelope.extend(WorkflowMutationResultShape)
const EditWorkflowVariableResult = WorkflowVariableDocumentEnvelope.extend({
  requiresReview: z.literal(true).optional(),
  reviewBaseStateHash: z.string().optional(),
  success: z.boolean().optional(),
  preview: z
    .object({
      documentDiff: z.object({
        before: z.string(),
        after: z.string(),
      }),
    })
    .optional(),
})

const EnvironmentVariablesMutationResult = DocumentDiffReviewMetadata.extend({
  success: z.boolean(),
  scope: z.enum(['personal', 'workspace']),
  workspaceId: z.string().optional(),
  message: z.any().optional(),
  data: z.any().optional(),
  variableCount: z.number().optional(),
  variableNames: z.array(z.string()).optional(),
  totalVariableCount: z.number().optional(),
  addedVariables: z.array(z.string()).optional(),
  updatedVariables: z.array(z.string()).optional(),
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
    id: z.string(),
  }),
  mark_todo_in_progress: z.object({
    id: z.string(),
  }),
  [CopilotTool.read_workflow]: WorkflowReadDocumentEnvelope,
  create_workflow: WorkflowCreateMutationResult,
  [CopilotTool.list_workflows]: GenericEntityListResult.extend({
    entityKind: z.literal('workflow'),
  }),
  [CopilotTool.edit_workflow_variable]: EditWorkflowVariableResult,
  oauth_request_access: z.object({
    granted: z.boolean().optional(),
    message: z.string().optional(),
  }),

  edit_workflow: EditWorkflowResult,
  edit_workflow_block: EditWorkflowBlockResult,
  rename_workflow: SavedEntityRenameResult,
  run_workflow: z.object({
    executionId: z.string().optional(),
    message: z.any().optional(),
    data: z.any().optional(),
  }),
  [CopilotTool.read_workflow_logs]: z.object({
    entries: z.array(ExecutionEntry),
  }),
  [CopilotTool.get_available_blocks]: GetAvailableBlocksResult,
  [CopilotTool.get_blocks_metadata]: GetBlocksMetadataResult,
  [CopilotTool.get_agent_accessory_catalog]: GetAgentAccessoryCatalogResult,
  [CopilotTool.get_indicator_catalog]: GetIndicatorCatalogResult,
  [CopilotTool.get_indicator_metadata]: GetIndicatorMetadataResult,
  search_documentation: z.object({ results: z.array(z.any()) }),
  search_listing: z.object({ results: z.array(ListingIdentitySchema) }),
  search_online: z.object({
    results: z.array(z.any()),
    query: z.string().optional(),
    type: z.string().optional(),
    totalResults: z.number().optional(),
    source: z.enum(['exa', 'serper']).optional(),
  }),
  make_api_request: z.object({
    status: z.number(),
    statusText: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    data: z.any().optional(),
    body: z.any().optional(),
  }),
  [CopilotTool.read_environment_variables]: z.object({
    variableNames: z.array(z.string()),
    personalVariableNames: z.array(z.string()),
    workspaceVariableNames: z.array(z.string()),
    conflicts: z.array(z.string()),
    count: z.number(),
  }),
  set_environment_variables: EnvironmentVariablesMutationResult,
  [CopilotTool.read_oauth_credentials]: z.object({
    credentials: z.array(
      z.object({
        id: z.string(),
        provider: z.string(),
        isDefault: z.boolean().optional(),
      })
    ),
    total: z.number().optional(),
  }),
  [CopilotTool.read_credentials]: z.union([
    z.object({
      oauth: z.object({
        connected: z.object({
          credentials: z.array(
            z.object({
              id: z.string(),
              provider: z.string(),
              isDefault: z.boolean().optional(),
            })
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
          z.object({
            id: z.string(),
            provider: z.string(),
            isDefault: z.boolean().optional(),
          })
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
    credentialId: z.string().optional(),
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
  list_knowledge_bases: GenericEntityListResult.extend({
    entityKind: z.literal('knowledge_base'),
  }),
  read_knowledge_base: KnowledgeBaseDocumentEnvelope,
  create_knowledge_base: KnowledgeBaseDocumentMutationResult,
  edit_knowledge_base: KnowledgeBaseDocumentMutationResult,
  rename_knowledge_base: SavedEntityRenameResult,
  query_knowledge_base: QueryKnowledgeBaseResult,
  list_custom_tools: GenericEntityListResult.extend({
    entityKind: z.literal('custom_tool'),
  }),
  [CopilotTool.read_custom_tool]: CustomToolDocumentEnvelope.extend({
    entityKind: z.literal('custom_tool'),
  }),
  create_custom_tool: CustomToolDocumentMutationResult,
  edit_custom_tool: CustomToolDocumentMutationResult,
  rename_custom_tool: SavedEntityRenameResult,
  list_monitors: MonitorListResult,
  [CopilotTool.read_monitor]: MonitorDocumentEnvelope,
  edit_monitor: z
    .object({
      success: z.boolean(),
    })
    .merge(DocumentDiffReviewMetadata)
    .merge(MonitorDocumentEnvelope),
  [CopilotTool.list_indicators]: IndicatorListResult,
  [CopilotTool.read_indicator]: IndicatorDocumentEnvelope.extend({
    entityKind: z.literal('indicator'),
  }),
  create_indicator: IndicatorDocumentMutationResult,
  edit_indicator: IndicatorDocumentMutationResult,
  rename_indicator: SavedEntityRenameResult,
  list_skills: GenericEntityListResult.extend({
    entityKind: z.literal('skill'),
  }),
  [CopilotTool.read_skill]: SkillDocumentEnvelope.extend({
    entityKind: z.literal('skill'),
  }),
  create_skill: SkillDocumentMutationResult,
  edit_skill: SkillDocumentMutationResult,
  rename_skill: SavedEntityRenameResult,
  list_mcp_servers: GenericEntityListResult.extend({
    entityKind: z.literal('mcp_server'),
  }),
  [CopilotTool.read_mcp_server]: McpServerDocumentEnvelope.extend({
    entityKind: z.literal('mcp_server'),
  }),
  create_mcp_server: McpServerDocumentMutationResult,
  edit_mcp_server: McpServerDocumentMutationResult,
  rename_mcp_server: SavedEntityRenameResult,
  list_watchlist: GenericEntityListResult.extend({
    entityKind: z.literal('watchlist'),
  }),
  read_watchlist: WatchlistDocumentEnvelope.extend({
    entityKind: z.literal('watchlist'),
  }),
  create_watchlist: WatchlistDocumentMutationResult,
  edit_watchlist: WatchlistDocumentMutationResult,
  rename_watchlist: SavedEntityRenameResult,
  list_layout: GenericEntityListResult.extend({
    entityKind: z.literal('dashboard_layout'),
  }),
  create_layout: DashboardLayoutCreateMutationResult,
  read_layout: DashboardLayoutDocumentEnvelope,
  edit_layout: DashboardLayoutDocumentMutationResult,
  rename_layout: SavedEntityRenameResult,
  edit_widget: DashboardLayoutDocumentMutationResult,
  get_available_widgets: z.object({
    widgets: z.array(WidgetCatalogItemSchema),
    count: z.number(),
  }),
  get_widgets_metadata: z.object({
    metadata: z.record(z.string(), WidgetMetadataProfileSchema),
  }),
  sleep: z.object({
    success: z.boolean(),
    seconds: z.number(),
    message: z.string().optional(),
  }),
  [CopilotTool.read_block_outputs]: ReadBlockOutputsResult,
  [CopilotTool.read_block_upstream_references]: ReadBlockUpstreamReferencesResult,
} as const

// Consolidated registry entry per tool
export const ToolRegistry = Object.freeze(
  ToolIds.options.reduce(
    (acc, toolId) => {
      const args = ToolArgSchemas[toolId]
      const result = ToolResultSchemas[toolId]
      acc[toolId] = { id: toolId, args, result }
      return acc
    },
    {} as Record<
      ToolId,
      {
        id: ToolId
        args: z.ZodTypeAny
        result: z.ZodTypeAny
      }
    >
  )
)

export function isToolId(toolId: string): toolId is ToolId {
  return Object.hasOwn(ToolRegistry, toolId)
}

export function getToolContract(toolId: string) {
  return isToolId(toolId) ? ToolRegistry[toolId] : undefined
}
