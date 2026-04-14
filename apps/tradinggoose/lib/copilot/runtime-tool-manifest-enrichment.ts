import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import {
  CUSTOM_TOOL_DOCUMENT_FORMAT,
  getEntityDocumentSchema,
  INDICATOR_DOCUMENT_FORMAT,
  MCP_SERVER_DOCUMENT_FORMAT,
  SKILL_DOCUMENT_FORMAT,
} from '@/lib/copilot/entity-documents'
import { MONITOR_DOCUMENT_FORMAT, MonitorDocumentSchema } from '@/lib/copilot/monitor/monitor-documents'
import { TG_MERMAID_DOCUMENT_FORMAT } from '@/lib/workflows/studio-workflow-mermaid'

export interface RuntimeToolManifestSemanticValidator {
  path: string
  kind: string
  args?: Record<string, unknown>
  description?: string
  message?: string
}

type DocumentSemanticSpec = {
  documentField: 'entityDocument'
  documentFormat: string
  documentLabel: string
  schema: Record<string, unknown>
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

const JSON_DOCUMENT_SPECS: DocumentSemanticSpec[] = [
  {
    documentField: 'entityDocument',
    documentFormat: SKILL_DOCUMENT_FORMAT,
    documentLabel: 'skill',
    schema: toJsonSchemaRecord(getEntityDocumentSchema('skill')),
  },
  {
    documentField: 'entityDocument',
    documentFormat: CUSTOM_TOOL_DOCUMENT_FORMAT,
    documentLabel: 'custom tool',
    schema: toJsonSchemaRecord(getEntityDocumentSchema('custom_tool')),
  },
  {
    documentField: 'entityDocument',
    documentFormat: INDICATOR_DOCUMENT_FORMAT,
    documentLabel: 'indicator',
    schema: toJsonSchemaRecord(getEntityDocumentSchema('indicator')),
  },
  {
    documentField: 'entityDocument',
    documentFormat: MCP_SERVER_DOCUMENT_FORMAT,
    documentLabel: 'MCP server',
    schema: toJsonSchemaRecord(getEntityDocumentSchema('mcp_server')),
  },
  {
    documentField: 'entityDocument',
    documentFormat: MONITOR_DOCUMENT_FORMAT,
    documentLabel: 'monitor',
    schema: toJsonSchemaRecord(MonitorDocumentSchema),
  },
]

const JSON_DOCUMENT_SPEC_BY_FORMAT = new Map(
  JSON_DOCUMENT_SPECS.map((spec) => [spec.documentFormat, spec] as const)
)

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

function buildWorkflowDocumentSemanticValidators(): RuntimeToolManifestSemanticValidator[] {
  return [
    {
      path: 'workflowDocument',
      kind: 'string_requires_real_newlines',
      description:
        '`workflowDocument` must be raw `tg-mermaid-v1` Mermaid text with real newline characters, not JSON-escaped `\\n` sequences.',
      message:
        'Expected raw Mermaid text with real newline characters, not JSON-escaped `\\n` sequences.',
    },
    {
      path: 'workflowDocument',
      kind: 'string_starts_with',
      args: { prefix: 'flowchart ' },
      description: '`workflowDocument` must start with a Mermaid `flowchart` declaration.',
      message: 'Expected raw Mermaid text that starts with a `flowchart` declaration.',
    },
    {
      path: 'workflowDocument',
      kind: 'string_requires_line_prefix',
      args: { prefix: '%% TG_WORKFLOW ', minMatches: 1 },
      description:
        '`workflowDocument` must contain a standalone `%% TG_WORKFLOW {...}` metadata line near the top of the document.',
      message:
        'Missing a standalone `%% TG_WORKFLOW {...}` metadata line. Keep it on its own line near the top of the document.',
    },
    {
      path: 'workflowDocument',
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
      description: '`TG_WORKFLOW` metadata must be valid JSON with `version: tg-mermaid-v1`.',
    },
    {
      path: 'workflowDocument',
      kind: 'string_requires_line_prefix',
      args: { prefix: '%% TG_BLOCK ', minMatches: 1 },
      description:
        '`workflowDocument` must contain standalone canonical `%% TG_BLOCK {...}` lines for every workflow block.',
      message:
        'Workflow document did not contain any standalone `%% TG_BLOCK {...}` block entries. Do not embed `TG_BLOCK` JSON inside node labels.',
    },
    {
      path: 'workflowDocument',
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
      description:
        'Each `TG_BLOCK` payload must be canonical workflow state with `id`, `type`, `name`, `position`, `subBlocks`, `outputs`, and `enabled`.',
    },
    {
      path: 'workflowDocument',
      kind: 'string_forbids_substring',
      args: { substring: '$$TG_BLOCK' },
      description: 'Do not embed `TG_BLOCK` JSON inside node labels.',
      message: 'Do not embed `TG_BLOCK` JSON inside node labels. Emit `%% TG_BLOCK {...}` on its own line.',
    },
    {
      path: 'workflowDocument',
      kind: 'string_forbids_substring',
      args: { substring: '"blockType":' },
      description:
        'Workflow documents use canonical `TG_BLOCK.type`, not metadata aliases like `blockType`.',
      message:
        'Workflow documents use canonical `TG_BLOCK.type`, not metadata aliases like `blockType`.',
    },
    {
      path: 'workflowDocument',
      kind: 'string_forbids_substring',
      args: { substring: '"blockName":' },
      description:
        'Workflow documents use canonical `TG_BLOCK.name`, not metadata aliases like `blockName`.',
      message:
        'Workflow documents use canonical `TG_BLOCK.name`, not metadata aliases like `blockName`.',
    },
    {
      path: 'workflowDocument',
      kind: 'string_mermaid_flowchart_edge_metadata_matches_canonical',
      args: {
        blockPrefix: '%% TG_BLOCK ',
        edgePrefix: '%% TG_EDGE ',
      },
      description:
        'Visible Mermaid connections and canonical `%% TG_EDGE {...}` payloads must describe the exact same workflow edge set, including loop and parallel container handles.',
    },
    {
      path: 'workflowDocument',
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
      description:
        'Each `TG_EDGE` payload must be a JSON object with string `source` and `target` fields.',
    },
  ]
}

function buildJsonDocumentSemanticValidators(
  spec: DocumentSemanticSpec
): RuntimeToolManifestSemanticValidator[] {
  return [
    {
      path: spec.documentField,
      kind: 'string_starts_with',
      args: { prefix: '{' },
      description: `\`${spec.documentField}\` must start with a JSON object.`,
      message: 'Expected raw JSON document text that starts with `{`.',
    },
    {
      path: spec.documentField,
      kind: 'string_json_schema',
      args: { schema: spec.schema },
      description: `\`${spec.documentField}\` must be valid \`${spec.documentFormat}\` JSON matching the canonical ${spec.documentLabel} document schema.`,
      message: `Expected valid \`${spec.documentFormat}\` JSON matching the canonical ${spec.documentLabel} document schema.`,
    },
  ]
}

export function buildAutomaticSemanticValidators(
  parameters: Record<string, unknown>
): RuntimeToolManifestSemanticValidator[] {
  const documentFormat = getConstStringValue(getObjectPropertySchema(parameters, 'documentFormat'))

  if (documentFormat === TG_MERMAID_DOCUMENT_FORMAT) {
    return buildWorkflowDocumentSemanticValidators()
  }

  const jsonDocumentSpec = documentFormat ? JSON_DOCUMENT_SPEC_BY_FORMAT.get(documentFormat) : null
  if (jsonDocumentSpec) {
    return buildJsonDocumentSemanticValidators(jsonDocumentSpec)
  }

  return []
}
