import { z } from 'zod'

// Generic envelope used by client to validate API responses
export const ExecuteResponseSuccessSchema = z.object({
  success: z.literal(true),
  result: z.unknown(),
})

// get_blocks_and_tools
export const GetBlocksAndToolsInput = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      'Optional capability search query used to narrow the canonical workflow block catalog, for example "historical OHLCV", "indicator function", or "Slack notification".'
    ),
  triggerAllowed: z
    .boolean()
    .optional()
    .describe('Optional filter for blocks that can start a workflow or be used as triggers.'),
})
export const BlockRequiredCredentialsSchema = z.object({
  type: z.enum(['oauth', 'api_key', 'bot_token']),
  service: z.string().optional(),
  description: z.string(),
})
export const BlockMermaidContractSchema = z.object({
  renderKind: z.enum(['standard', 'condition', 'loop_container', 'parallel_container']),
  requiresSubgraph: z.boolean(),
  childrenPlacement: z.enum(['none', 'inside_container', 'outside_container']),
  incomingEdgeTarget: z.enum(['block', 'container_start']),
  outgoingEdgeSource: z.enum(['block', 'container_end', 'condition_branch']),
  conditionBranchNodePattern: z.string().optional(),
  conditionBranchHandlePattern: z.string().optional(),
  containerStartNodePattern: z.string().optional(),
  containerEndNodePattern: z.string().optional(),
  canonicalCommentPrefixes: z.object({
    workflow: z.string(),
    block: z.string(),
    edge: z.string(),
  }),
})
export const BlockMermaidExamplesSchema = z.object({
  minimalDocument: z.string(),
  connectedDocument: z.string(),
})
export const BlockMermaidSubBlockOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
})
export const BlockMermaidSubBlockSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  type: z.string(),
  mode: z.enum(['basic', 'advanced', 'both', 'trigger']).optional(),
  required: z.boolean().optional(),
  description: z.string().optional(),
  placeholder: z.string().optional(),
  canonicalParamId: z.string().optional(),
  language: z.string().optional(),
  generationType: z.string().optional(),
  defaultValue: z.unknown().optional(),
  options: z.array(BlockMermaidSubBlockOptionSchema).optional(),
})
export const BlockInputReferencePatternSchema = z.object({
  syntax: z.string(),
  summary: z.string(),
  examples: z.array(z.string()).min(1),
  sourceTools: z
    .array(
      z.enum([
        'get_block_outputs',
        'get_block_upstream_references',
        'get_global_workflow_variables',
        'get_environment_variables',
      ])
    )
    .min(1),
})
export const BlockInputReferenceRuleSchema = z.object({
  title: z.string(),
  summary: z.string(),
  examples: z.array(z.string()).optional(),
})
export const BlockInputReferenceGrammarSchema = z.object({
  hardRequirement: z.literal(true),
  summary: z.string(),
  workflowOutputs: BlockInputReferencePatternSchema,
  workflowVariables: BlockInputReferencePatternSchema,
  environmentVariables: BlockInputReferencePatternSchema,
  blockSpecificRules: z.array(BlockInputReferenceRuleSchema).optional(),
})
export const BlockMermaidOperationSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  mermaidContract: BlockMermaidContractSchema,
  mermaidExamples: BlockMermaidExamplesSchema,
})
export type BlockMermaidOperationType = z.infer<typeof BlockMermaidOperationSchema>
export const BlockMermaidCatalogItemSchema = z.object({
  blockType: z.string(),
  blockName: z.string(),
  blockDescription: z.string().optional(),
  triggerAllowed: z.boolean().optional(),
  mermaidContract: BlockMermaidContractSchema,
  operationIds: z.array(z.string()).optional(),
})
export type BlockMermaidCatalogItemType = z.infer<typeof BlockMermaidCatalogItemSchema>
export const BlockMermaidProfileSchema = BlockMermaidCatalogItemSchema.extend({
  bestPractices: z.string().optional(),
  authType: z.enum(['OAuth', 'API Key', 'Bot Token']).optional(),
  requiredCredentials: BlockRequiredCredentialsSchema.optional(),
  yamlDocumentation: z.string().optional(),
  subBlocks: z.array(BlockMermaidSubBlockSchema).optional(),
  inputReferenceGrammar: BlockInputReferenceGrammarSchema.optional(),
  mermaidExamples: BlockMermaidExamplesSchema,
  operations: z.array(BlockMermaidOperationSchema).optional(),
})
export type BlockMermaidProfileType = z.infer<typeof BlockMermaidProfileSchema>
export const GetBlocksAndToolsResult = z.object({
  blocks: z.array(BlockMermaidCatalogItemSchema),
})
export type GetBlocksAndToolsResultType = z.infer<typeof GetBlocksAndToolsResult>

// get_blocks_metadata
export const GetBlocksMetadataInput = z.object({
  blockIds: z
    .array(
      z
        .string()
        .min(1)
        .describe(
          'Canonical block type id from `get_blocks_and_tools`, such as `historical_data` or `function`, not a workflow instance block id.'
        )
    )
    .min(1)
    .describe(
      'Canonical workflow block type ids to inspect in detail. Use `get_blocks_and_tools` first when the available built-in options are not yet known.'
    ),
})
export const GetBlocksMetadataResult = z.object({ metadata: z.record(BlockMermaidProfileSchema) })
export type GetBlocksMetadataResultType = z.infer<typeof GetBlocksMetadataResult>

// get_indicator_catalog / get_indicator_metadata
export const IndicatorCatalogSectionIdSchema = z.enum([
  'section:document',
  'section:runtime',
  'section:context',
  'section:inputs',
  'section:indicator_options',
  'section:triggers',
  'section:unsupported',
])
export type IndicatorCatalogSectionId = z.infer<typeof IndicatorCatalogSectionIdSchema>

export const IndicatorCatalogSupportSchema = z.enum(['supported', 'curated', 'unsupported'])
export type IndicatorCatalogSupport = z.infer<typeof IndicatorCatalogSupportSchema>

export const IndicatorCatalogItemTypeSchema = z.enum([
  'section',
  'document_field',
  'runtime_behavior',
  'context_surface',
  'input_function',
  'indicator_option',
  'trigger_api',
  'unsupported_feature',
])
export type IndicatorCatalogItemType = z.infer<typeof IndicatorCatalogItemTypeSchema>

export const IndicatorSourceReferenceSchema = z.object({
  label: z.string(),
  path: z.string(),
})
export type IndicatorSourceReference = z.infer<typeof IndicatorSourceReferenceSchema>

export const IndicatorCatalogSectionSchema = z.object({
  id: IndicatorCatalogSectionIdSchema,
  title: z.string(),
  summary: z.string(),
  itemCount: z.number(),
})
export type IndicatorCatalogSection = z.infer<typeof IndicatorCatalogSectionSchema>

export const IndicatorCatalogItemSchema = z.object({
  id: z.string(),
  sectionId: IndicatorCatalogSectionIdSchema,
  type: IndicatorCatalogItemTypeSchema.exclude(['section']),
  title: z.string(),
  summary: z.string(),
  support: IndicatorCatalogSupportSchema,
  relatedIds: z.array(z.string()).optional(),
})
export type IndicatorCatalogItem = z.infer<typeof IndicatorCatalogItemSchema>

export const IndicatorMetadataExampleSchema = z.object({
  title: z.string(),
  summary: z.string().optional(),
  code: z.string().optional(),
  indicatorId: z.string().optional(),
})
export type IndicatorMetadataExample = z.infer<typeof IndicatorMetadataExampleSchema>

export const IndicatorMetadataEntrySchema = z.object({
  id: z.string(),
  sectionId: IndicatorCatalogSectionIdSchema.optional(),
  type: IndicatorCatalogItemTypeSchema,
  title: z.string(),
  summary: z.string(),
  detail: z.string(),
  support: IndicatorCatalogSupportSchema,
  signature: z.string().optional(),
  supportedValues: z.array(z.string()).optional(),
  defaultValue: z.unknown().optional(),
  relatedIds: z.array(z.string()).optional(),
  examples: z.array(IndicatorMetadataExampleSchema).optional(),
  sourceReferences: z.array(IndicatorSourceReferenceSchema).optional(),
})
export type IndicatorMetadataEntry = z.infer<typeof IndicatorMetadataEntrySchema>

export const GetIndicatorCatalogInput = z.object({
  sections: z
    .array(IndicatorCatalogSectionIdSchema)
    .min(1)
    .optional()
    .describe(
      'Optional exact section ids to narrow the catalog. Omit to inspect every supported indicator authoring section.'
    ),
  query: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      'Optional capability search query used to narrow the TradingGoose indicator authoring catalog, for example `input enum`, `overlay`, `trigger`, or `runtime output`.'
    ),
  includeItems: z
    .boolean()
    .optional()
    .describe('When false, return only section summaries without the individual item ids.'),
})
export const GetIndicatorCatalogResult = z.object({
  sections: z.array(IndicatorCatalogSectionSchema),
  items: z.array(IndicatorCatalogItemSchema),
  count: z.number(),
  query: z.string().optional(),
})
export type GetIndicatorCatalogResultType = z.infer<typeof GetIndicatorCatalogResult>

export const GetIndicatorMetadataInput = z.object({
  targetIds: z
    .array(
      z
        .string()
        .min(1)
        .describe(
          'Exact indicator section ids or item ids returned by `get_indicator_catalog`, such as `section:inputs`, `input.int`, or `indicator.overlay`.'
        )
    )
    .min(1)
    .max(50)
    .describe(
      'Exact indicator section ids or item ids to inspect in detail. Use `get_indicator_catalog` first when the available ids are not yet known.'
    ),
})
export const GetIndicatorMetadataResult = z.object({
  items: z.array(IndicatorMetadataEntrySchema),
  missingIds: z.array(z.string()),
})
export type GetIndicatorMetadataResultType = z.infer<typeof GetIndicatorMetadataResult>

// get_trigger_blocks
export const GetTriggerBlocksInput = z.object({})
export const GetTriggerBlocksResult = z.object({
  triggerBlockIds: z.array(z.string()),
})
export type GetTriggerBlocksResultType = z.infer<typeof GetTriggerBlocksResult>

// knowledge_base - shared schema used by client tool, server tool, and registry
export const KnowledgeBaseArgsSchema = z.object({
  operation: z.enum(['create', 'list', 'get', 'query']),
  args: z
    .object({
      /** Name of the knowledge base (required for create) */
      name: z.string().optional(),
      /** Description of the knowledge base (optional for create) */
      description: z.string().optional(),
      /** Workspace ID to associate with (optional for create/list) */
      workspaceId: z.string().optional(),
      /** Knowledge base ID (required for get, query) */
      knowledgeBaseId: z.string().optional(),
      /** Search query text (required for query) */
      query: z.string().optional(),
      /** Number of results to return (optional for query, defaults to 5) */
      topK: z.number().min(1).max(50).optional(),
      /** Chunking configuration (optional for create) */
      chunkingConfig: z
        .object({
          maxSize: z.number().min(100).max(4000).default(1024),
          minSize: z.number().min(1).max(2000).default(1),
          overlap: z.number().min(0).max(500).default(200),
        })
        .optional(),
    })
    .optional(),
})
export type KnowledgeBaseArgs = z.infer<typeof KnowledgeBaseArgsSchema>

export const KnowledgeBaseResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.any().optional(),
})
export type KnowledgeBaseResult = z.infer<typeof KnowledgeBaseResultSchema>

export const GetBlockOutputsInput = z.object({
  blockIds: z.array(z.string()).optional(),
})
export const GetBlockOutputsResult = z.object({
  blocks: z.array(
    z.object({
      blockId: z.string(),
      blockName: z.string(),
      blockType: z.string(),
      outputs: z.array(z.string()),
      insideSubflowOutputs: z.array(z.string()).optional(),
      outsideSubflowOutputs: z.array(z.string()).optional(),
    })
  ),
  variables: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
        tag: z.string(),
      })
    )
    .optional(),
})
export type GetBlockOutputsInputType = z.infer<typeof GetBlockOutputsInput>
export type GetBlockOutputsResultType = z.infer<typeof GetBlockOutputsResult>

export const GetBlockUpstreamReferencesInput = z.object({
  blockIds: z.array(z.string()).min(1),
})
export const GetBlockUpstreamReferencesResult = z.object({
  results: z.array(
    z.object({
      blockId: z.string(),
      blockName: z.string(),
      insideSubflows: z
        .array(
          z.object({
            blockId: z.string(),
            blockName: z.string(),
            blockType: z.string(),
          })
        )
        .optional(),
      accessibleBlocks: z.array(
        z.object({
          blockId: z.string(),
          blockName: z.string(),
          blockType: z.string(),
          outputs: z.array(z.string()),
          accessContext: z.enum(['inside', 'outside']).optional(),
        })
      ),
      variables: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          type: z.string(),
          tag: z.string(),
        })
      ),
    })
  ),
})
export type GetBlockUpstreamReferencesInputType = z.infer<typeof GetBlockUpstreamReferencesInput>
export type GetBlockUpstreamReferencesResultType = z.infer<typeof GetBlockUpstreamReferencesResult>
