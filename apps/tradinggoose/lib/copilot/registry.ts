import { z } from 'zod'
import {
  GetBlockConfigInput,
  GetBlockConfigResult,
  GetBlockOptionsInput,
  GetBlockOptionsResult,
  GetBlockOutputsInput,
  GetBlockOutputsResult,
  GetBlocksAndToolsInput,
  GetBlocksAndToolsResult,
  GetBlocksMetadataInput,
  GetBlocksMetadataResult,
  GetBlockUpstreamReferencesInput,
  GetBlockUpstreamReferencesResult,
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
  'edit_workflow',
  'preview_edit_workflow',
  'run_workflow',
  'get_workflow_console',
  'get_blocks_and_tools',
  'get_blocks_metadata',
  'get_block_options',
  'get_block_config',
  'get_trigger_examples',
  'get_examples_rag',
  'get_operations_examples',
  'search_documentation',
  'search_online',
  'search_patterns',
  'search_errors',
  'remember_debug',
  'make_api_request',
  'get_environment_variables',
  'set_environment_variables',
  'get_oauth_credentials',
  'get_credentials',
  'list_user_workflows',
  'get_workflow_from_name',
  'get_workflow_data',
  'get_global_workflow_variables',
  'set_global_workflow_variables',
  'oauth_request_access',
  'get_trigger_blocks',
  'deploy_workflow',
  'check_deployment_status',
  'knowledge_base',
  'manage_custom_tool',
  'manage_skill',
  'manage_mcp_tool',
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
export type ToolCallSSE = z.infer<typeof ToolCallSSEBase>

// Reusable small schemas
const StringArray = z.array(z.string())
const BooleanOptional = z.boolean().optional()
const NumberOptional = z.number().optional()

// Tool argument schemas (per SSE examples provided)
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
  get_user_workflow: z.object({}),
  list_user_workflows: z.object({}),
  get_workflow_from_name: z.object({ workflow_name: z.string() }),
  get_workflow_data: z.object({
    data_type: z.enum(['global_variables', 'custom_tools', 'skills', 'mcp_tools', 'files']),
  }),
  get_global_workflow_variables: z.object({}),
  set_global_workflow_variables: z.object({
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
  }),
  check_deployment_status: z.object({
    workflowId: z.string().optional(),
  }),

  edit_workflow: z.object({
    operations: z
      .array(
        z.object({
          operation_type: z.enum(['add', 'edit', 'delete']),
          block_id: z.string(),
          params: z.record(z.any()).optional(),
        })
      )
      .min(1),
  }),
  preview_edit_workflow: z.object({
    operations: z
      .array(
        z.object({
          operation_type: z.enum(['add', 'edit', 'delete']),
          block_id: z.string(),
          params: z.record(z.any()).optional(),
        })
      )
      .min(1),
  }),

  run_workflow: z.object({
    workflow_input: z.union([z.string(), z.record(z.any())]).optional(),
  }),

  get_workflow_console: z.object({
    limit: NumberOptional,
    includeDetails: BooleanOptional,
  }),

  get_blocks_and_tools: GetBlocksAndToolsInput,

  get_blocks_metadata: GetBlocksMetadataInput,

  get_block_options: GetBlockOptionsInput,

  get_block_config: GetBlockConfigInput,

  get_trigger_blocks: GetTriggerBlocksInput,

  get_trigger_examples: z.object({}),

  get_examples_rag: z.object({
    query: z.string(),
  }),

  get_operations_examples: z.object({
    query: z.string(),
  }),

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

  search_patterns: z.object({
    queries: z.array(z.string()).min(1).max(3),
    limit: z.number().optional().default(3),
  }),

  search_errors: z.object({
    query: z.string(),
    limit: z.number().optional().default(5),
  }),

  remember_debug: z.object({
    operation: z.enum(['add', 'edit', 'delete']),
    id: z.string().optional(),
    problem: z.string().optional(),
    solution: z.string().optional(),
    description: z.string().optional(),
  }),

  make_api_request: z.object({
    url: z.string(),
    method: z.enum(['GET', 'POST', 'PUT']),
    queryParams: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    headers: z.record(z.string()).optional(),
    body: z.union([z.record(z.any()), z.string()]).optional(),
  }),

  get_environment_variables: z.object({}),

  set_environment_variables: z.object({
    variables: z.record(z.string()),
  }),

  get_oauth_credentials: z.object({}),

  get_credentials: z.object({}),

  gdrive_request_access: z.object({}),

  list_gdrive_files: z.object({
    search_query: z.string().optional(),
    num_results: z.number().optional().default(50),
  }),

  read_gdrive_file: z.object({
    fileId: z.string(),
    type: z.enum(['doc', 'sheet']),
    range: z.string().optional(),
  }),

  knowledge_base: KnowledgeBaseArgsSchema,

  manage_custom_tool: z.object({
    operation: z
      .enum(['add', 'edit', 'delete', 'list'])
      .describe(
        'The operation to perform: add (create new), edit (update existing), delete, or list'
      ),
    toolId: z
      .string()
      .optional()
      .describe(
        'Required for edit and delete operations. The database ID of the custom tool (e.g., "0robnW7_JUVwZrDkq1mqj"). Use manage_custom_tool with operation "list" or get_workflow_data with data_type "custom_tools" to get the list of tools and their IDs. Do NOT use the function name - use the actual "id" field from the tool.'
      ),
    title: z
      .string()
      .optional()
      .describe(
        'Optional display title for the custom tool. If omitted, the function name will be used.'
      ),
    schema: z
      .object({
        type: z.literal('function'),
        function: z.object({
          name: z.string().describe('The function name (camelCase, e.g. getWeather)'),
          description: z.string().optional().describe('What the function does'),
          parameters: z.object({
            type: z.string(),
            properties: z.record(z.any()),
            required: z.array(z.string()).optional(),
          }),
        }),
      })
      .optional()
      .describe('Required for add. The OpenAI function calling format schema.'),
    code: z
      .string()
      .optional()
      .describe(
        'Required for add. The JavaScript function body code. Use {{ENV_VAR}} for environment variables and reference parameters directly by name.'
      ),
  }),
  manage_skill: z.object({
    operation: z
      .enum(['add', 'edit', 'delete', 'list'])
      .describe(
        'The operation to perform: add (create new), edit (update existing), delete, or list'
      ),
    skillId: z
      .string()
      .optional()
      .describe(
        'Required for edit and delete operations. The database ID of the skill. Use manage_skill with operation "list" or get_workflow_data with data_type "skills" to get the list of skills and their IDs.'
      ),
    name: z
      .string()
      .optional()
      .describe('Required for add. The skill name in kebab-case, for example market-research.'),
    description: z
      .string()
      .optional()
      .describe('Required for add. A short description of what the skill does.'),
    content: z
      .string()
      .optional()
      .describe('Required for add. The full skill instructions content.'),
  }),

  manage_mcp_tool: z.object({
    operation: z
      .enum(['add', 'edit', 'delete', 'list'])
      .describe(
        'The operation to perform: add (create new), edit (update existing), delete, or list'
      ),
    serverId: z
      .string()
      .optional()
      .describe(
        'Required for edit and delete operations. The database ID of the MCP server. Use manage_mcp_tool with operation "list" to get the available servers and their IDs.'
      ),
    config: z
      .object({
        name: z.string().describe('The display name for the MCP server'),
        transport: z
          .enum(['streamable-http'])
          .optional()
          .default('streamable-http')
          .describe('Transport protocol (currently only streamable-http is supported)'),
        url: z.string().optional().describe('The MCP server endpoint URL (required for add)'),
        headers: z
          .record(z.string())
          .optional()
          .describe('Optional HTTP headers to send with requests'),
        timeout: z.number().optional().describe('Request timeout in milliseconds (default: 30000)'),
        enabled: z.boolean().optional().describe('Whether the server is enabled (default: true)'),
      })
      .optional()
      .describe('Required for add and edit operations. The MCP server configuration.'),
  }),

  sleep: z.object({
    seconds: z
      .number()
      .min(0)
      .max(180)
      .describe('The number of seconds to sleep (0-180, max 3 minutes)'),
  }),

  get_block_outputs: GetBlockOutputsInput,

  get_block_upstream_references: GetBlockUpstreamReferencesInput,
} as const
export type ToolArgSchemaMap = typeof ToolArgSchemas

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
  list_user_workflows: toolCallSSEFor('list_user_workflows', ToolArgSchemas.list_user_workflows),
  get_workflow_from_name: toolCallSSEFor(
    'get_workflow_from_name',
    ToolArgSchemas.get_workflow_from_name
  ),
  get_workflow_data: toolCallSSEFor('get_workflow_data', ToolArgSchemas.get_workflow_data),
  get_global_workflow_variables: toolCallSSEFor(
    'get_global_workflow_variables',
    ToolArgSchemas.get_global_workflow_variables
  ),
  set_global_workflow_variables: toolCallSSEFor(
    'set_global_workflow_variables',
    ToolArgSchemas.set_global_workflow_variables
  ),
  edit_workflow: toolCallSSEFor('edit_workflow', ToolArgSchemas.edit_workflow),
  preview_edit_workflow: toolCallSSEFor(
    'preview_edit_workflow',
    ToolArgSchemas.preview_edit_workflow
  ),
  run_workflow: toolCallSSEFor('run_workflow', ToolArgSchemas.run_workflow),
  get_workflow_console: toolCallSSEFor('get_workflow_console', ToolArgSchemas.get_workflow_console),
  get_blocks_and_tools: toolCallSSEFor('get_blocks_and_tools', ToolArgSchemas.get_blocks_and_tools),
  get_blocks_metadata: toolCallSSEFor('get_blocks_metadata', ToolArgSchemas.get_blocks_metadata),
  get_block_options: toolCallSSEFor('get_block_options', ToolArgSchemas.get_block_options),
  get_block_config: toolCallSSEFor('get_block_config', ToolArgSchemas.get_block_config),
  get_trigger_blocks: toolCallSSEFor('get_trigger_blocks', ToolArgSchemas.get_trigger_blocks),
  get_trigger_examples: toolCallSSEFor('get_trigger_examples', ToolArgSchemas.get_trigger_examples),
  get_examples_rag: toolCallSSEFor('get_examples_rag', ToolArgSchemas.get_examples_rag),
  get_operations_examples: toolCallSSEFor(
    'get_operations_examples',
    ToolArgSchemas.get_operations_examples
  ),
  search_documentation: toolCallSSEFor('search_documentation', ToolArgSchemas.search_documentation),
  search_online: toolCallSSEFor('search_online', ToolArgSchemas.search_online),
  search_patterns: toolCallSSEFor('search_patterns', ToolArgSchemas.search_patterns),
  search_errors: toolCallSSEFor('search_errors', ToolArgSchemas.search_errors),
  remember_debug: toolCallSSEFor('remember_debug', ToolArgSchemas.remember_debug),
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
  manage_custom_tool: toolCallSSEFor('manage_custom_tool', ToolArgSchemas.manage_custom_tool),
  manage_skill: toolCallSSEFor('manage_skill', ToolArgSchemas.manage_skill),
  manage_mcp_tool: toolCallSSEFor('manage_mcp_tool', ToolArgSchemas.manage_mcp_tool),
  sleep: toolCallSSEFor('sleep', ToolArgSchemas.sleep),
  get_block_outputs: toolCallSSEFor('get_block_outputs', ToolArgSchemas.get_block_outputs),
  get_block_upstream_references: toolCallSSEFor(
    'get_block_upstream_references',
    ToolArgSchemas.get_block_upstream_references
  ),
} as const
export type ToolSSESchemaMap = typeof ToolSSESchemas

// Known result schemas per tool (what tool_result.result should conform to)
// Note: Where legacy variability exists, schema captures the common/expected shape for new runtime.
const BuildOrEditWorkflowResult = z.object({
  yamlContent: z.string(),
  userWorkflow: z.string().optional(),
  description: z.string().optional(),
  workflowState: z.unknown().optional(),
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
  get_user_workflow: z
    .object({ userWorkflow: z.string() })
    .or(z.object({ yamlContent: z.string() }))
    .or(z.string()),
  list_user_workflows: z.object({ workflow_names: z.array(z.string()) }),
  get_workflow_from_name: z.object({ userWorkflow: z.string() }).or(z.string()),
  get_workflow_data: z.union([
    z.object({
      variables: z.array(z.object({ id: z.string(), name: z.string(), value: z.any() })),
    }),
    z.object({
      customTools: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          functionName: z.string(),
          description: z.string(),
          parameters: z.any().optional(),
        })
      ),
    }),
    z.object({
      skills: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string(),
        })
      ),
    }),
    z.object({
      mcpTools: z.array(
        z.object({
          name: z.string(),
          serverId: z.string(),
          serverName: z.string(),
          description: z.string(),
          inputSchema: z.any().optional(),
        })
      ),
    }),
    z.object({
      files: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          key: z.string(),
          path: z.string(),
          size: z.number(),
          type: z.string(),
          uploadedAt: z.string(),
        })
      ),
    }),
  ]),
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
  preview_edit_workflow: BuildOrEditWorkflowResult,
  run_workflow: z.object({
    executionId: z.string().optional(),
    message: z.any().optional(),
    data: z.any().optional(),
  }),
  get_workflow_console: z.object({ entries: z.array(ExecutionEntry) }),
  get_blocks_and_tools: GetBlocksAndToolsResult,
  get_blocks_metadata: GetBlocksMetadataResult,
  get_block_options: GetBlockOptionsResult,
  get_block_config: GetBlockConfigResult,
  get_trigger_blocks: GetTriggerBlocksResult,
  get_trigger_examples: z.object({
    examples: z.array(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        operations: z.array(z.any()).optional(),
      })
    ),
  }),
  get_examples_rag: z.object({
    examples: z.array(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        operations: z.array(z.any()).optional(),
      })
    ),
  }),
  get_operations_examples: z.object({
    examples: z.array(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        operations: z.array(z.any()).optional(),
      })
    ),
  }),
  search_documentation: z.object({ results: z.array(z.any()) }),
  search_online: z.object({ results: z.array(z.any()) }),
  search_patterns: z.object({
    patterns: z.array(
      z.object({
        blocks_involved: z.array(z.string()).optional(),
        description: z.string().optional(),
        pattern_category: z.string().optional(),
        pattern_name: z.string().optional(),
        use_cases: z.array(z.string()).optional(),
        workflow_json: z.any().optional(),
      })
    ),
  }),
  search_errors: z.object({
    results: z.array(
      z.object({
        problem: z.string().optional(),
        solution: z.string().optional(),
        context: z.string().optional(),
        similarity: z.number().optional(),
      })
    ),
  }),
  remember_debug: z.object({
    success: z.boolean(),
    message: z.string().optional(),
    id: z.string().optional(),
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
  manage_custom_tool: z
    .object({
      success: z.boolean(),
      operation: z.enum(['add', 'edit', 'delete']),
      toolId: z.string().optional(),
      title: z.string().optional(),
      functionName: z.string().optional(),
      message: z.string().optional(),
    })
    .or(
      z.object({
        success: z.boolean(),
        operation: z.literal('list'),
        tools: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            schema: z.any().optional(),
            code: z.string().optional(),
          })
        ),
        count: z.number(),
      })
    ),
  manage_skill: z
    .object({
      success: z.boolean(),
      operation: z.enum(['add', 'edit', 'delete']),
      skillId: z.string().optional(),
      name: z.string().optional(),
      message: z.string().optional(),
    })
    .or(
      z.object({
        success: z.boolean(),
        operation: z.literal('list'),
        skills: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            description: z.string(),
            createdAt: z.any().optional(),
          })
        ),
        count: z.number(),
      })
    ),
  manage_mcp_tool: z
    .object({
      success: z.boolean(),
      operation: z.enum(['add', 'edit', 'delete']),
      serverId: z.string().optional(),
      name: z.string().optional(),
      serverName: z.string().optional(),
      message: z.string().optional(),
    })
    .or(
      z.object({
        success: z.boolean(),
        operation: z.literal('list'),
        servers: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            url: z.string().optional(),
            transport: z.string().optional(),
            enabled: z.boolean().optional(),
            connectionStatus: z.string().optional(),
          })
        ),
        count: z.number(),
      })
    ),
  sleep: z.object({
    success: z.boolean(),
    seconds: z.number(),
    message: z.string().optional(),
  }),
  get_block_outputs: GetBlockOutputsResult,
  get_block_upstream_references: GetBlockUpstreamReferencesResult,
} as const
export type ToolResultSchemaMap = typeof ToolResultSchemas

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
export type ToolRegistryMap = typeof ToolRegistry

export function isToolId(toolId: string): toolId is ToolId {
  return Object.hasOwn(ToolRegistry, toolId)
}

export function getToolContract(toolId: string) {
  return isToolId(toolId) ? ToolRegistry[toolId] : undefined
}

// Convenience helper types inferred from schemas
export type InferArgs<T extends ToolId> = z.infer<(typeof ToolArgSchemas)[T]>
export type InferResult<T extends ToolId> = z.infer<(typeof ToolResultSchemas)[T]>
export type InferToolCallSSE<T extends ToolId> = z.infer<(typeof ToolSSESchemas)[T]>
