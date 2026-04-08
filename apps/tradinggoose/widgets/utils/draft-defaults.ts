import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'

/**
 * Default content builders for brand-new entity drafts.
 * Shared between list-widget openers and entity-session-host bootstrap.
 */

export function buildNewSkillDraft(): Record<string, any> {
  return {
    name: '',
    description: '',
    content: '',
  }
}

export function buildNewCustomToolDraft(): Record<string, any> {
  return {
    title: '',
    schemaText: JSON.stringify(
      {
        type: 'function',
        function: {
          name: '',
          description: '',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
      null,
      2
    ),
    codeText: '',
  }
}

export function buildNewIndicatorDraft(): Record<string, any> {
  return {
    name: '',
    color: '',
    pineCode: '',
    inputMeta: null,
  }
}

/**
 * Shared MCP server defaults used by both draft bootstrapping and form data
 * initialisation. The `transport` field differs by context:
 *   - Draft bootstrapping uses `'http'` (lightweight default for new drafts).
 *   - Form data initialisation uses `'streamable-http'` (matches UI editor).
 *
 * Call with an explicit transport override when the context requires it.
 */
export const MCP_SERVER_DEFAULTS = {
  name: '',
  description: '',
  url: '',
  headers: {} as Record<string, string>,
  command: '',
  args: [] as string[],
  env: {} as Record<string, string>,
  timeout: 30000,
  retries: 3,
  enabled: true,
} as const

export function buildNewMcpServerDraft(transport: string = 'http'): Record<string, any> {
  return {
    ...MCP_SERVER_DEFAULTS,
    transport,
    headers: {},
    args: [],
    env: {},
  }
}

export function buildDraftDefaults(entityKind: ReviewEntityKind): Record<string, any> {
  switch (entityKind) {
    case 'skill':
      return buildNewSkillDraft()
    case 'custom_tool':
      return buildNewCustomToolDraft()
    case 'indicator':
      return buildNewIndicatorDraft()
    case 'mcp_server':
      return buildNewMcpServerDraft()
    default:
      return {}
  }
}
