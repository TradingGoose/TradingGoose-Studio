import type { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import {
  CUSTOM_TOOL_DOCUMENT_FORMAT,
  getEntityDocumentSchema,
  INDICATOR_DOCUMENT_FORMAT,
  MCP_SERVER_DOCUMENT_FORMAT,
  SKILL_DOCUMENT_FORMAT,
} from '@/lib/copilot/entity-documents'
import {
  MONITOR_DOCUMENT_FORMAT,
  MonitorDocumentSchema,
} from '@/lib/copilot/monitor/monitor-documents'
import type { RuntimeToolManifestSemanticValidator } from '@/lib/copilot/workflow-subblock-semantic-contracts'
import { TG_MERMAID_DOCUMENT_FORMAT } from '@/lib/workflows/document-format'

export type { RuntimeToolManifestSemanticValidator } from '@/lib/copilot/workflow-subblock-semantic-contracts'

type DocumentSemanticSpecDefinition = {
  documentFormat: string
  preferredDocumentField: string
  buildSemanticValidators: (documentField: string) => RuntimeToolManifestSemanticValidator[]
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

const TG_WORKFLOW_LINE_PREFIX = '%% TG_WORKFLOW '
const TG_BLOCK_LINE_PREFIX = '%% TG_BLOCK '
const TG_EDGE_LINE_PREFIX = '%% TG_EDGE '

const TG_WORKFLOW_METADATA_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['version', 'direction'],
  additionalProperties: true,
  properties: {
    version: { const: TG_MERMAID_DOCUMENT_FORMAT },
    direction: { enum: ['TD', 'LR'] },
  },
}

const TG_POSITION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['x', 'y'],
  additionalProperties: true,
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
  },
}

const TG_BLOCK_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['id', 'type', 'name', 'position', 'subBlocks', 'outputs', 'enabled'],
  additionalProperties: true,
  properties: {
    id: { type: 'string' },
    type: { type: 'string' },
    name: { type: 'string' },
    position: TG_POSITION_SCHEMA,
    subBlocks: { type: 'object' },
    outputs: { type: 'object' },
    enabled: { type: 'boolean' },
  },
}

const TG_EDGE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['source', 'target'],
  additionalProperties: true,
  properties: {
    id: { type: 'string' },
    source: { type: 'string' },
    target: { type: 'string' },
    sourceHandle: { type: 'string' },
    targetHandle: { type: 'string' },
  },
}

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
  documentField: string
): RuntimeToolManifestSemanticValidator[] {
  return [
    {
      path: documentField,
      kind: 'string_requires_real_newlines',
      description:
        'Cheap format guard only. Use raw Mermaid text with real newlines; Studio validates TG_WORKFLOW, TG_BLOCK, and edge consistency.',
      message:
        'Expected raw Mermaid text with real newline characters, not JSON-escaped `\\n` sequences.',
    },
    {
      path: documentField,
      kind: 'string_starts_with',
      args: { prefix: 'flowchart ' },
      description:
        'Cheap format guard only. Start with a Mermaid `flowchart` declaration; Studio validates canonical workflow structure.',
      message: 'Expected raw Mermaid text that starts with a `flowchart` declaration.',
    },
    {
      path: documentField,
      kind: 'string_requires_line_prefix',
      args: { prefix: TG_WORKFLOW_LINE_PREFIX, minMatches: 1 },
      description: 'Include a standalone canonical `%% TG_WORKFLOW {...}` metadata line.',
      message: 'Workflow documents must include a standalone `%% TG_WORKFLOW {...}` metadata line.',
    },
    {
      path: documentField,
      kind: 'string_requires_line_prefix',
      args: { prefix: TG_BLOCK_LINE_PREFIX, minMatches: 1 },
      description: 'Include standalone canonical `%% TG_BLOCK {...}` metadata lines.',
      message: 'Workflow documents must include standalone `%% TG_BLOCK {...}` metadata lines.',
    },
    {
      path: documentField,
      kind: 'string_line_prefix_json_schema',
      args: { prefix: TG_WORKFLOW_LINE_PREFIX, schema: TG_WORKFLOW_METADATA_SCHEMA },
      description: 'Validate each `TG_WORKFLOW` metadata JSON payload.',
      message:
        '`TG_WORKFLOW` metadata must be canonical JSON with `version: "tg-mermaid-v1"` and `direction` of `TD` or `LR`.',
    },
    {
      path: documentField,
      kind: 'string_line_prefix_json_schema',
      args: { prefix: TG_BLOCK_LINE_PREFIX, schema: TG_BLOCK_SCHEMA },
      description: 'Validate each `TG_BLOCK` metadata JSON payload.',
      message:
        '`TG_BLOCK` metadata must be canonical block state with `id`, `type`, `name`, `position`, `subBlocks`, `outputs`, and `enabled`.',
    },
    {
      path: documentField,
      kind: 'string_line_prefix_json_schema',
      args: { prefix: TG_EDGE_LINE_PREFIX, schema: TG_EDGE_SCHEMA },
      description: 'Validate each `TG_EDGE` metadata JSON payload when edge lines are present.',
      message: '`TG_EDGE` metadata must be canonical edge state with string `source` and `target`.',
    },
    {
      path: documentField,
      kind: 'string_forbids_substring',
      args: { substring: '"blockType"' },
      description: 'Use canonical `TG_BLOCK.type`, not simplified block metadata aliases.',
      message: 'Use `type` in `TG_BLOCK` metadata, not `blockType`.',
    },
    {
      path: documentField,
      kind: 'string_forbids_substring',
      args: { substring: '"blockName"' },
      description: 'Use canonical `TG_BLOCK.name`, not simplified block metadata aliases.',
      message: 'Use `name` in `TG_BLOCK` metadata, not `blockName`.',
    },
    {
      path: documentField,
      kind: 'string_forbids_substring',
      args: { substring: '"blockDescription"' },
      description: 'Use canonical `TG_BLOCK` state, not simplified block metadata aliases.',
      message: '`TG_BLOCK` metadata must not include `blockDescription`.',
    },
    {
      path: documentField,
      kind: 'string_document_contract',
      args: {
        format: TG_MERMAID_DOCUMENT_FORMAT,
        workflowPrefix: TG_WORKFLOW_LINE_PREFIX,
        blockPrefix: TG_BLOCK_LINE_PREFIX,
        edgePrefix: TG_EDGE_LINE_PREFIX,
      },
      description:
        'Keep visible Mermaid connection lines aligned with canonical `TG_EDGE` metadata.',
      message:
        'Visible Mermaid connections and `TG_EDGE` metadata must describe the same logical workflow edges.',
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
    preferredDocumentField: 'entityDocument',
    buildSemanticValidators: buildWorkflowDocumentSemanticValidators,
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
      return (
        getSchemaType(
          propertySchema && typeof propertySchema === 'object' && !Array.isArray(propertySchema)
            ? (propertySchema as Record<string, unknown>)
            : null
        ) === 'string'
      )
    })
    .map(([fieldName]) => fieldName)

  return matchingFields[0] ?? null
}

export function buildAutomaticSemanticValidators(
  parameters: Record<string, unknown>
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

  return semanticSpec.buildSemanticValidators(documentField)
}
