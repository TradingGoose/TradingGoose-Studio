import { z } from 'zod'
import { type CopilotAccessLevel, shouldRequireToolApproval } from '@/lib/copilot/access-policy'
import { parseNativeContract, type ToolManifest } from '@/lib/copilot/native/contract'
import { ToolArgSchemas, type ToolId, ToolIds } from '@/lib/copilot/registry'
import {
  buildAutomaticSemanticValidators,
  type RuntimeToolManifestSemanticValidator,
} from '@/lib/copilot/runtime-tool-manifest-enrichment'
import { getCopilotToolPolicy } from '@/lib/copilot/tool-policy'
import { TOOL_PROMPT_METADATA } from '@/lib/copilot/tool-prompt-metadata'

// Must match TOOL_MANIFEST_VERSION in the Copilot service, which validates this
// field as a strict literal and rejects the whole chat request on a mismatch.
export const COPILOT_RUNTIME_TOOL_MANIFEST_VERSION = 'v1' as const

export type CopilotRuntimeToolManifestTool = ToolManifest['tools'][number]
export type CopilotRuntimeToolManifest = ToolManifest

const buildToolParameterSchema = (toolId: ToolId): Record<string, unknown> => {
  // zod-to-json-schema only understands Zod 3 internals, so Zod 4 schemas are
  // converted with Zod's own emitter. `reused: 'inline'` reproduces the old
  // `$refStrategy: 'none'`, keeping every tool's parameters self-contained.
  const schema = z.toJSONSchema(ToolArgSchemas[toolId], {
    target: 'draft-7',
    io: 'input',
    reused: 'inline',
    unrepresentable: 'any',
  })

  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error(`Canonical business schema is unavailable for ${toolId}`)
  }

  const { $schema, definitions, $defs, ...parameters } = schema as Record<string, unknown>
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

export async function getCopilotRuntimeToolManifest(
  accessLevel: CopilotAccessLevel = 'limited'
): Promise<CopilotRuntimeToolManifest> {
  return parseNativeContract('ToolManifest', {
    version: COPILOT_RUNTIME_TOOL_MANIFEST_VERSION,
    tools: TOOL_NAMES.map((toolName) => {
      const parameters = buildToolParameterSchema(toolName)
      const semanticValidators = getSemanticValidators(toolName, parameters)

      return {
        name: toolName,
        ...TOOL_PROMPT_METADATA[toolName],
        approvalRequired: shouldRequireToolApproval(
          accessLevel,
          getCopilotToolPolicy(toolName).gated
        ),
        ...(semanticValidators ? { semanticValidators } : {}),
        parameters,
      }
    }),
  })
}
