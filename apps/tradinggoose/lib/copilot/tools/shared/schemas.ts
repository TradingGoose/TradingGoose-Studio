import { z } from 'zod'

// Generic envelope used by client to validate API responses
export const ExecuteResponseSuccessSchema = z.object({
  success: z.literal(true),
  result: z.unknown(),
})

// dashboard widget catalog / metadata
export const WidgetCatalogItemSchema = z.object({
  widgetKey: z.string(),
  title: z.string(),
  category: z.enum(['editor', 'list', 'utility', 'trading']),
  description: z.string(),
  editable: z.boolean(),
  editableFields: z.array(z.string()),
  linkedParamFields: z.array(z.string()),
})

type WidgetParamFieldContractValue = {
  field: string
  kind: string
  referenceKind?: string
  allowedValues?: string[]
}

const WidgetParamFieldContractSchema: z.ZodType<WidgetParamFieldContractValue> = z.object({
  field: z.string(),
  kind: z.string(),
  referenceKind: z.string().optional(),
  allowedValues: z.array(z.string()).optional(),
})

export const WidgetMetadataProfileSchema = z.object({
  widgetKey: z.string(),
  title: z.string(),
  category: z.enum(['editor', 'list', 'utility', 'trading']),
  description: z.string(),
  editable: z.boolean(),
  defaultParams: z.record(z.any()).nullable(),
  editableFields: z.array(z.string()),
  paramContract: z.array(WidgetParamFieldContractSchema),
  linkedParamFields: z.array(z.string()),
})

// get_available_blocks
const BlockCatalogCategorySchema = z.enum(['block', 'tool', 'trigger'])
export type BlockCatalogCategory = z.infer<typeof BlockCatalogCategorySchema>
export const GetAvailableBlocksInput = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Optional capability search query used to narrow the canonical workflow block catalog, for example "historical OHLCV", "indicator function", or "Slack notification".'
      ),
    category: BlockCatalogCategorySchema.optional().describe(
      'Optional catalog category filter: core workflow blocks, tool-backed blocks, or trigger blocks.'
    ),
  })
  .strict()
const BlockRequiredCredentialsSchema = z.object({
  type: z.enum(['oauth', 'api_key', 'bot_token']),
  service: z.string().optional(),
  description: z.string(),
})
const BlockMermaidContractSchema = z.object({
  renderKind: z.enum(['standard', 'condition', 'loop_container', 'parallel_container']),
  requiresSubgraph: z.boolean(),
  childrenPlacement: z.enum(['none', 'inside_container', 'outside_container']),
  canonicalCommentPrefixes: z.object({
    workflow: z.string(),
    block: z.string(),
    edge: z.string(),
  }),
})
const BlockMermaidExamplesSchema = z.object({
  minimalDocument: z.string(),
  connectedDocument: z.string(),
})
const BlockMermaidSubBlockOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
})
const BlockMermaidSubBlockSchema = z.object({
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
const BlockInputReferencePatternSchema = z.object({
  syntax: z.string(),
  summary: z.string(),
  examples: z.array(z.string()).min(1),
  sourceTools: z
    .array(
      z.enum([
        'read_block_outputs',
        'read_block_upstream_references',
        'read_workflow',
        'read_environment_variables',
      ])
    )
    .min(1),
})
const BlockInputReferenceRuleSchema = z.object({
  title: z.string(),
  summary: z.string(),
  examples: z.array(z.string()).optional(),
})
const BlockInputReferenceGrammarSchema = z.object({
  hardRequirement: z.literal(true),
  summary: z.string(),
  workflowOutputs: BlockInputReferencePatternSchema,
  workflowVariables: BlockInputReferencePatternSchema,
  environmentVariables: BlockInputReferencePatternSchema,
  blockSpecificRules: z.array(BlockInputReferenceRuleSchema).optional(),
})
const BlockMermaidOperationSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  mermaidContract: BlockMermaidContractSchema,
  mermaidExamples: BlockMermaidExamplesSchema,
})
export type BlockMermaidOperationType = z.infer<typeof BlockMermaidOperationSchema>
const BlockMermaidCatalogItemSchema = z.object({
  blockType: z.string(),
  blockName: z.string(),
  category: BlockCatalogCategorySchema,
  blockDescription: z.string().optional(),
  mermaidContract: BlockMermaidContractSchema,
  operationIds: z.array(z.string()).optional(),
})
export type BlockMermaidCatalogItemType = z.infer<typeof BlockMermaidCatalogItemSchema>
const BlockMermaidProfileSchema = BlockMermaidCatalogItemSchema.extend({
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
export const GetAvailableBlocksResult = z.object({
  blocks: z.array(BlockMermaidCatalogItemSchema),
})

// get_blocks_metadata
export const GetBlocksMetadataInput = z.object({
  blockTypes: z
    .array(
      z
        .string()
        .min(1)
        .describe(
          'Canonical block type id from `get_available_blocks`, such as `historical_data` or `function`, not a workflow instance block id.'
        )
    )
    .min(1)
    .describe(
      'Canonical workflow block type ids to inspect in detail. Use `get_available_blocks` first when the available built-in options are not yet known.'
    ),
})
export const GetBlocksMetadataResult = z.object({
  metadata: z.record(BlockMermaidProfileSchema),
})

// get_agent_accessory_catalog
export const GetAgentAccessoryCatalogInput = z
  .object({
    workspaceId: z.string().trim().min(1),
  })
  .strict()

const AgentToolAccessoryOptionSchema = z.object({
  id: z.string(),
  source: z.enum(['block', 'custom_tool', 'mcp']),
  title: z.string(),
  value: z.record(z.any()),
})
const AgentSkillAccessoryOptionSchema = z.object({
  id: z.string(),
  source: z.literal('skill'),
  title: z.string(),
  value: z.record(z.any()),
})

export const GetAgentAccessoryCatalogResult = z.object({
  tools: z.array(AgentToolAccessoryOptionSchema),
  skills: z.array(AgentSkillAccessoryOptionSchema),
})
export type GetAgentAccessoryCatalogInputType = z.infer<typeof GetAgentAccessoryCatalogInput>
export type GetAgentAccessoryCatalogResultType = z.infer<typeof GetAgentAccessoryCatalogResult>

// get_indicator_catalog / get_indicator_metadata
const IndicatorCatalogSectionIdSchema = z.enum([
  'section:document',
  'section:runtime',
  'section:context',
  'section:inputs',
  'section:indicator_options',
  'section:triggers',
  'section:unsupported',
])
export type IndicatorCatalogSectionId = z.infer<typeof IndicatorCatalogSectionIdSchema>

const IndicatorCatalogSupportSchema = z.enum(['supported', 'curated', 'unsupported'])

const IndicatorCatalogItemTypeSchema = z.enum([
  'section',
  'document_field',
  'runtime_behavior',
  'context_surface',
  'input_function',
  'indicator_option',
  'trigger_api',
  'unsupported_feature',
])

const IndicatorSourceReferenceSchema = z.object({
  label: z.string(),
  path: z.string(),
})

const IndicatorCatalogSectionSchema = z.object({
  id: IndicatorCatalogSectionIdSchema,
  title: z.string(),
  summary: z.string(),
  itemCount: z.number(),
})
export type IndicatorCatalogSection = z.infer<typeof IndicatorCatalogSectionSchema>

const IndicatorCatalogItemSchema = z.object({
  id: z.string(),
  sectionId: IndicatorCatalogSectionIdSchema,
  type: IndicatorCatalogItemTypeSchema.exclude(['section']),
  title: z.string(),
  summary: z.string(),
  support: IndicatorCatalogSupportSchema,
  relatedIds: z.array(z.string()).optional(),
})
export type IndicatorCatalogItem = z.infer<typeof IndicatorCatalogItemSchema>

const IndicatorMetadataExampleSchema = z.object({
  title: z.string(),
  summary: z.string().optional(),
  code: z.string().optional(),
  indicatorId: z.string().optional(),
})

const IndicatorMetadataEntrySchema = z.object({
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

export const ReadBlockOutputsInput = z.object({
  blockIds: z
    .array(z.string())
    .optional()
    .describe(
      'Optional exact workflow instance block ids from `read_workflow.workflowSummary.blocks`. Omit to inspect every block output in the workflow.'
    ),
})
const BlockOutputReferenceSchema = z.object({
  path: z.string(),
  type: z.string(),
})
export const ReadBlockOutputsResult = z.object({
  blocks: z.array(
    z.object({
      blockId: z.string(),
      blockName: z.string(),
      blockType: z.string(),
      outputs: z.array(BlockOutputReferenceSchema),
      insideSubflowOutputs: z.array(BlockOutputReferenceSchema).optional(),
      outsideSubflowOutputs: z.array(BlockOutputReferenceSchema).optional(),
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
export type ReadBlockOutputsResultType = z.infer<typeof ReadBlockOutputsResult>

export const ReadBlockUpstreamReferencesInput = z.object({
  blockIds: z
    .array(z.string())
    .min(1)
    .describe(
      'Exact workflow instance block ids from `read_workflow.workflowSummary.blocks` whose accessible upstream references should be resolved.'
    ),
})
export const ReadBlockUpstreamReferencesResult = z.object({
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
          outputs: z.array(BlockOutputReferenceSchema),
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
export type ReadBlockUpstreamReferencesResultType = z.infer<
  typeof ReadBlockUpstreamReferencesResult
>
