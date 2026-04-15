import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import {
  CUSTOM_TOOL_DOCUMENT_FORMAT,
  getEntityDocumentSchema,
  INDICATOR_DOCUMENT_FORMAT,
  MCP_SERVER_DOCUMENT_FORMAT,
  SKILL_DOCUMENT_FORMAT,
} from '@/lib/copilot/entity-documents'
import {
  type EmbeddedDocumentValidator,
  type RuntimeToolManifestSemanticValidator,
} from '@/lib/copilot/workflow-subblock-semantic-contracts'
import { MONITOR_DOCUMENT_FORMAT, MonitorDocumentSchema } from '@/lib/copilot/monitor/monitor-documents'
import { TG_MERMAID_DOCUMENT_FORMAT } from '@/lib/workflows/document-format'

export type { RuntimeToolManifestSemanticValidator } from '@/lib/copilot/workflow-subblock-semantic-contracts'

type WorkflowGraphContractSpec = {
  canonicalBlock: {
    idPath: string
    typePath: string
    parentIdPath: string
  }
  visibleOverlay: {
    idLabel: string
    typeLabel: string
  }
  inferParentsFromContainerSubgraphs: boolean
  containers: Array<{
    blockType: string
    startNodeSuffix: string
    endNodeSuffix: string
    startSourceHandle: string
    endSourceHandle: string
    endTargetHandle: string
  }>
  conditionalBranches: Array<{
    blockType: string
    handlePrefix: string
    branchNodeSeparator: string
  }>
}

type AnnotatedGraphDocumentContract = {
  type: 'annotated_graph'
  nodePrefix: string
  edgePrefix: string
  spec: WorkflowGraphContractSpec
  embeddedValidators?: EmbeddedDocumentValidator[]
}

type DocumentSemanticSpecDefinition = {
  documentFormat: string
  preferredDocumentField: string
  buildSemanticValidators: (
    documentField: string,
    options?: AutomaticSemanticValidatorOptions
  ) => RuntimeToolManifestSemanticValidator[]
}

type AutomaticSemanticValidatorOptions = {
  workflowEmbeddedValidators?: EmbeddedDocumentValidator[]
}

function toJsonSchemaRecord(schema: z.ZodTypeAny): Record<string, unknown> {
  const jsonSchema = zodToJsonSchema(schema, {
    $refStrategy: 'none',
    target: 'jsonSchema7',
  })

  if (!jsonSchema || typeof jsonSchema !== 'object' || Array.isArray(jsonSchema)) {
    return {
      type: 'object',
      properties: {},
      additionalProperties: true,
    }
  }

  const { $schema, definitions, ...parameters } = jsonSchema as Record<string, unknown>
  return parameters
}

type JsonDocumentSemanticSpec = {
  documentFormat: string
  documentLabel: string
  schema: Record<string, unknown>
}

const JSON_DOCUMENT_SPECS: JsonDocumentSemanticSpec[] = [
  {
    documentFormat: SKILL_DOCUMENT_FORMAT,
    documentLabel: 'skill',
    schema: toJsonSchemaRecord(getEntityDocumentSchema('skill')),
  },
  {
    documentFormat: CUSTOM_TOOL_DOCUMENT_FORMAT,
    documentLabel: 'custom tool',
    schema: toJsonSchemaRecord(getEntityDocumentSchema('custom_tool')),
  },
  {
    documentFormat: INDICATOR_DOCUMENT_FORMAT,
    documentLabel: 'indicator',
    schema: toJsonSchemaRecord(getEntityDocumentSchema('indicator')),
  },
  {
    documentFormat: MCP_SERVER_DOCUMENT_FORMAT,
    documentLabel: 'MCP server',
    schema: toJsonSchemaRecord(getEntityDocumentSchema('mcp_server')),
  },
  {
    documentFormat: MONITOR_DOCUMENT_FORMAT,
    documentLabel: 'monitor',
    schema: toJsonSchemaRecord(MonitorDocumentSchema),
  },
]

export const WORKFLOW_GRAPH_CONTRACT_SPEC: WorkflowGraphContractSpec = {
  canonicalBlock: {
    idPath: 'id',
    typePath: 'type',
    parentIdPath: 'data.parentId',
  },
  visibleOverlay: {
    idLabel: 'id',
    typeLabel: 'type',
  },
  inferParentsFromContainerSubgraphs: true,
  containers: [
    {
      blockType: 'loop',
      startNodeSuffix: '__loop_start',
      endNodeSuffix: '__loop_end',
      startSourceHandle: 'loop-start-source',
      endSourceHandle: 'loop-end-source',
      endTargetHandle: 'loop-end-target',
    },
    {
      blockType: 'parallel',
      startNodeSuffix: '__parallel_start',
      endNodeSuffix: '__parallel_end',
      startSourceHandle: 'parallel-start-source',
      endSourceHandle: 'parallel-end-source',
      endTargetHandle: 'parallel-end-target',
    },
  ],
  conditionalBranches: [
    {
      blockType: 'condition',
      handlePrefix: 'condition-',
      branchNodeSeparator: '__condition_',
    },
  ],
}

export function buildWorkflowDocumentContract(
  embeddedValidators?: EmbeddedDocumentValidator[]
): AnnotatedGraphDocumentContract {
  return {
    type: 'annotated_graph',
    nodePrefix: '%% TG_BLOCK ',
    edgePrefix: '%% TG_EDGE ',
    spec: WORKFLOW_GRAPH_CONTRACT_SPEC,
    ...(embeddedValidators && embeddedValidators.length > 0 ? { embeddedValidators } : {}),
  }
}

export const WORKFLOW_DOCUMENT_CONTRACT: AnnotatedGraphDocumentContract =
  buildWorkflowDocumentContract()

function getObjectPropertySchema(
  parameters: Record<string, unknown>,
  propertyName: string
): Record<string, unknown> | null {
  const properties = parameters.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return null
  }

  const propertySchema = (properties as Record<string, unknown>)[propertyName]
  return propertySchema && typeof propertySchema === 'object' && !Array.isArray(propertySchema)
    ? (propertySchema as Record<string, unknown>)
    : null
}

function getConstStringValue(propertySchema: Record<string, unknown> | null): string | null {
  if (!propertySchema) return null

  if (typeof propertySchema.const === 'string') {
    return propertySchema.const
  }

  return null
}

function buildWorkflowDocumentSemanticValidators(
  documentField: string,
  workflowEmbeddedValidators?: EmbeddedDocumentValidator[]
): RuntimeToolManifestSemanticValidator[] {
  return [
    {
      path: documentField,
      kind: 'string_requires_real_newlines',
      description: 'Use raw Mermaid text with real newlines.',
      message:
        'Expected raw Mermaid text with real newline characters, not JSON-escaped `\\n` sequences.',
    },
    {
      path: documentField,
      kind: 'string_starts_with',
      args: { prefix: 'flowchart ' },
      description: 'Start with a Mermaid `flowchart` declaration.',
      message: 'Expected raw Mermaid text that starts with a `flowchart` declaration.',
    },
    {
      path: documentField,
      kind: 'string_requires_line_prefix',
      args: { prefix: '%% TG_WORKFLOW ', minMatches: 1 },
      description: 'Include a standalone `%% TG_WORKFLOW {...}` line.',
      message:
        'Missing a standalone `%% TG_WORKFLOW {...}` metadata line. Keep it on its own line near the top of the document.',
    },
    {
      path: documentField,
      kind: 'string_line_prefix_json_schema',
      args: {
        prefix: '%% TG_WORKFLOW ',
        minMatches: 0,
        schema: {
          type: 'object',
          required: ['version', 'direction'],
          additionalProperties: true,
          properties: {
            version: { const: 'tg-mermaid-v1' },
            direction: { enum: ['TD', 'LR'] },
          },
        },
      },
      description: 'Use canonical `TG_WORKFLOW` JSON metadata.',
    },
    {
      path: documentField,
      kind: 'string_requires_line_prefix',
      args: { prefix: '%% TG_BLOCK ', minMatches: 1 },
      description: 'Include standalone canonical `%% TG_BLOCK {...}` lines.',
      message:
        'Workflow document did not contain any standalone `%% TG_BLOCK {...}` block entries. Do not embed `TG_BLOCK` JSON inside node labels.',
    },
    {
      path: documentField,
      kind: 'string_line_prefix_json_schema',
      args: {
        prefix: '%% TG_BLOCK ',
        minMatches: 0,
        schema: {
          type: 'object',
          required: ['id', 'type', 'name', 'position', 'subBlocks', 'outputs', 'enabled'],
          additionalProperties: true,
          properties: {
            id: { type: 'string' },
            type: { type: 'string' },
            name: { type: 'string' },
            position: {
              type: 'object',
              required: ['x', 'y'],
              additionalProperties: true,
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
              },
            },
            subBlocks: { type: 'object', additionalProperties: true },
            outputs: { type: 'object', additionalProperties: true },
            enabled: { type: 'boolean' },
          },
        },
      },
      description: 'Use canonical `TG_BLOCK` JSON state.',
    },
    {
      path: documentField,
      kind: 'string_forbids_substring',
      args: { substring: '$$TG_BLOCK' },
      description: 'Do not embed `TG_BLOCK` JSON inside labels.',
      message: 'Do not embed `TG_BLOCK` JSON inside node labels. Emit `%% TG_BLOCK {...}` on its own line.',
    },
    {
      path: documentField,
      kind: 'string_forbids_substring',
      args: { substring: '"blockType":' },
      description: 'Use canonical `TG_BLOCK.type`.',
      message:
        'Workflow documents use canonical `TG_BLOCK.type`, not metadata aliases like `blockType`.',
    },
    {
      path: documentField,
      kind: 'string_forbids_substring',
      args: { substring: '"blockName":' },
      description: 'Use canonical `TG_BLOCK.name`.',
      message:
        'Workflow documents use canonical `TG_BLOCK.name`, not metadata aliases like `blockName`.',
    },
    {
      path: documentField,
      kind: 'string_document_contract',
      args: {
        contract: buildWorkflowDocumentContract(workflowEmbeddedValidators),
      },
      description: 'Keep visible edges and canonical `TG_EDGE` state aligned.',
    },
    {
      path: documentField,
      kind: 'string_line_prefix_json_schema',
      args: {
        prefix: '%% TG_EDGE ',
        minMatches: 0,
        schema: {
          type: 'object',
          required: ['source', 'target'],
          additionalProperties: true,
          properties: {
            source: { type: 'string' },
            target: { type: 'string' },
          },
        },
      },
      description: 'Use canonical `TG_EDGE` JSON state.',
    },
  ]
}

function buildJsonDocumentSemanticValidators(
  documentField: string,
  spec: JsonDocumentSemanticSpec
): RuntimeToolManifestSemanticValidator[] {
  return [
    {
      path: documentField,
      kind: 'string_starts_with',
      args: { prefix: '{' },
      description: 'Start with a JSON object.',
      message: 'Expected raw JSON document text that starts with `{`.',
    },
    {
      path: documentField,
      kind: 'string_json_schema',
      args: { schema: spec.schema },
      description: `Match the canonical ${spec.documentLabel} document schema.`,
      message: `Expected valid \`${spec.documentFormat}\` JSON matching the canonical ${spec.documentLabel} document schema.`,
    },
  ]
}

const DOCUMENT_SEMANTIC_SPECS = [
  {
    documentFormat: TG_MERMAID_DOCUMENT_FORMAT,
    preferredDocumentField: 'workflowDocument',
    buildSemanticValidators: (documentField, options) =>
      buildWorkflowDocumentSemanticValidators(
        documentField,
        options?.workflowEmbeddedValidators
      ),
  },
  ...JSON_DOCUMENT_SPECS.map((spec) => ({
    documentFormat: spec.documentFormat,
    preferredDocumentField: 'entityDocument',
    buildSemanticValidators: (documentField: string) =>
      buildJsonDocumentSemanticValidators(documentField, spec),
  })),
] satisfies DocumentSemanticSpecDefinition[]

const DOCUMENT_SEMANTIC_SPEC_BY_FORMAT = new Map(
  DOCUMENT_SEMANTIC_SPECS.map((spec) => [spec.documentFormat, spec] as const)
)

function getSchemaType(propertySchema: Record<string, unknown> | null): string | null {
  if (!propertySchema) return null
  return typeof propertySchema.type === 'string' ? propertySchema.type : null
}

function detectDocumentField(
  parameters: Record<string, unknown>,
  preferredDocumentField: string
): string | null {
  const preferredSchema = getObjectPropertySchema(parameters, preferredDocumentField)
  if (getSchemaType(preferredSchema) === 'string') {
    return preferredDocumentField
  }

  const properties = parameters.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return null
  }

  const matchingFields = Object.entries(properties as Record<string, unknown>)
    .filter(([fieldName, propertySchema]) => {
      if (!fieldName.endsWith('Document')) return false
      return getSchemaType(
        propertySchema && typeof propertySchema === 'object' && !Array.isArray(propertySchema)
          ? (propertySchema as Record<string, unknown>)
          : null
      ) === 'string'
    })
    .map(([fieldName]) => fieldName)

  return matchingFields[0] ?? null
}

export function buildAutomaticSemanticValidators(
  parameters: Record<string, unknown>,
  options?: AutomaticSemanticValidatorOptions
): RuntimeToolManifestSemanticValidator[] {
  const documentFormat = getConstStringValue(getObjectPropertySchema(parameters, 'documentFormat'))
  const semanticSpec = documentFormat ? DOCUMENT_SEMANTIC_SPEC_BY_FORMAT.get(documentFormat) : null
  if (!semanticSpec) {
    return []
  }

  const documentField = detectDocumentField(parameters, semanticSpec.preferredDocumentField)
  if (!documentField) {
    return []
  }

  return semanticSpec.buildSemanticValidators(documentField, options)
}
