import { zodToJsonSchema } from 'zod-to-json-schema'
import { ToolArgSchemas, type ToolId, ToolIds } from '@/lib/copilot/registry'
import {
  buildAutomaticSemanticValidators,
  type RuntimeToolManifestSemanticValidator,
} from '@/lib/copilot/runtime-tool-manifest-enrichment'
import { TOOL_PROMPT_METADATA } from '@/lib/copilot/tool-prompt-metadata'

export const COPILOT_RUNTIME_TOOL_MANIFEST_VERSION = 'v1' as const

export interface CopilotRuntimeToolManifestTool {
  name: string
  description: string
  parameters?: Record<string, unknown>
  semanticValidators?: RuntimeToolManifestSemanticValidator[]
  kind?: string
  entityKind?: string
  surfaceKind?: string
}

export interface CopilotRuntimeToolManifest {
  version: typeof COPILOT_RUNTIME_TOOL_MANIFEST_VERSION
  tools: CopilotRuntimeToolManifestTool[]
}

const buildToolParameterSchema = (toolId: ToolId): Record<string, unknown> => {
  const schema = zodToJsonSchema(ToolArgSchemas[toolId], {
    $refStrategy: 'none',
    target: 'jsonSchema7',
  })

  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return {
      type: 'object',
      properties: {},
      additionalProperties: true,
    }
  }

  const { $schema, definitions, ...parameters } = schema as Record<string, unknown>
  return parameters
}

const TOOL_NAMES = ToolIds.options
const WORKFLOW_GRAPH_VALIDATORS: RuntimeToolManifestSemanticValidator[] = [
  {
    path: 'entityDocument',
    kind: 'string_requires_real_newlines',
    message: 'Workflow graph Mermaid must be raw multi-line Mermaid text with real newlines.',
  },
  {
    path: 'entityDocument',
    kind: 'string_starts_with',
    args: { prefix: 'flowchart ' },
    message: 'Workflow graph Mermaid must start with `flowchart TD` or `flowchart LR`.',
  },
  {
    path: 'entityDocument',
    kind: 'string_forbids_substring',
    args: { substring: '%% TG_' },
    message: 'Workflow graph Mermaid must not include TG_* metadata comments.',
  },
]

function getSemanticValidators(
  toolName: ToolId,
  parameters: Record<string, unknown>
): RuntimeToolManifestSemanticValidator[] | undefined {
  const semanticValidators =
    toolName === 'edit_workflow'
      ? WORKFLOW_GRAPH_VALIDATORS
      : buildAutomaticSemanticValidators(parameters)

  if (semanticValidators.length === 0) {
    return undefined
  }

  return semanticValidators
}

export async function getCopilotRuntimeToolManifest(): Promise<CopilotRuntimeToolManifest> {
  return {
    version: COPILOT_RUNTIME_TOOL_MANIFEST_VERSION,
    tools: TOOL_NAMES.map((toolName) => {
      const parameters = buildToolParameterSchema(toolName)
      const semanticValidators = getSemanticValidators(toolName, parameters)

      return {
        name: toolName,
        ...TOOL_PROMPT_METADATA[toolName],
        ...(semanticValidators ? { semanticValidators } : {}),
        parameters,
      }
    }),
  }
}
