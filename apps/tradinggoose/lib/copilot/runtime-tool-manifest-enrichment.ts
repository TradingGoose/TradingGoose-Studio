import type { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import {
  CUSTOM_TOOL_DOCUMENT_FORMAT,
  getEntityDocumentSchema,
  INDICATOR_DOCUMENT_FORMAT,
  MCP_SERVER_DOCUMENT_FORMAT,
  SKILL_DOCUMENT_FORMAT,
  WATCHLIST_DOCUMENT_FORMAT,
} from '@/lib/copilot/entity-documents'
import {
  MONITOR_DOCUMENT_FORMAT,
  MonitorDocumentSchema,
} from '@/lib/copilot/monitor/monitor-documents'
import type { RuntimeToolManifestSemanticValidator } from '@/lib/copilot/workflow-subblock-semantic-contracts'
import {
  DASHBOARD_LAYOUT_DOCUMENT_FORMAT,
  DashboardLayoutDocumentSchema,
} from '@/widgets/layout-document'

export type { RuntimeToolManifestSemanticValidator } from '@/lib/copilot/workflow-subblock-semantic-contracts'

type DocumentSemanticSpecDefinition = {
  documentFormat: string
  preferredDocumentField: string
  buildSemanticValidators: (documentField: string) => RuntimeToolManifestSemanticValidator[]
}

function toJsonSchemaRecord(schema: z.ZodTypeAny): Record<string, unknown> {
  const jsonSchema = zodToJsonSchema(schema, {
    target: 'jsonSchema7',
  })

  if (!jsonSchema || typeof jsonSchema !== 'object' || Array.isArray(jsonSchema)) {
    return {
      type: 'object',
      properties: {},
      additionalProperties: true,
    }
  }

  const { $schema, ...parameters } = jsonSchema as Record<string, unknown>
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
    documentFormat: WATCHLIST_DOCUMENT_FORMAT,
    documentLabel: 'watchlist',
    schema: toJsonSchemaRecord(getEntityDocumentSchema('watchlist')),
  },
  {
    documentFormat: MONITOR_DOCUMENT_FORMAT,
    documentLabel: 'monitor',
    schema: toJsonSchemaRecord(MonitorDocumentSchema),
  },
  {
    documentFormat: DASHBOARD_LAYOUT_DOCUMENT_FORMAT,
    documentLabel: 'dashboard layout',
    schema: toJsonSchemaRecord(DashboardLayoutDocumentSchema),
  },
]

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
