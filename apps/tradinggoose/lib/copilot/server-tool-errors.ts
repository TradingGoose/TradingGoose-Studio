import { z } from 'zod'

export interface CopilotServerToolErrorPayload {
  error: string
  code: string
  hint?: string
  retryable?: boolean
  issues?: Array<{
    path: string
    message: string
  }>
}

export interface CopilotServerToolErrorResponse {
  status: number
  body: CopilotServerToolErrorPayload
}

export class StructuredServerToolError extends Error {
  public readonly status: number
  public readonly code: string
  public readonly hint?: string
  public readonly retryable?: boolean
  public readonly issues?: Array<{
    path: string
    message: string
  }>

  constructor(input: CopilotServerToolErrorResponse) {
    super(input.body.error)
    this.name = 'StructuredServerToolError'
    this.status = input.status
    this.code = input.body.code
    this.hint = input.body.hint
    this.retryable = input.body.retryable
    this.issues = input.body.issues
  }
}

function formatZodIssuePath(issue: z.ZodIssue): string {
  if (!issue.path || issue.path.length === 0) {
    return '$'
  }

  return issue.path
    .map((segment, index) =>
      typeof segment === 'number' ? `[${segment}]` : index === 0 ? segment : `.${segment}`
    )
    .join('')
}

function buildInvalidToolPayloadError(
  toolName: string | undefined,
  error: z.ZodError
): CopilotServerToolErrorResponse {
  const formattedIssues = error.issues.map((issue) => ({
    path: formatZodIssuePath(issue),
    message: issue.message,
  }))
  const issueSummary = formattedIssues
    .slice(0, 3)
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join('; ')
  const displayName = toolName?.trim() || 'tool'

  return {
    status: 422,
    body: {
      code: 'invalid_tool_payload',
      error: `Invalid ${displayName} payload: ${issueSummary || 'Payload did not match the tool schema.'}`,
      hint: 'Match the payload exactly to the active tool manifest. Use only allowed top-level properties, include required fields, and respect enum/value constraints.',
      retryable: true,
      issues: formattedIssues,
    },
  }
}

function buildEditWorkflowError(message: string): CopilotServerToolErrorResponse | null {
  if (message.startsWith('Invalid container edge:')) {
    return {
      status: 422,
      body: {
        code: 'invalid_workflow_document_container_edge',
        error: message,
        hint: 'For loop and parallel containers, connect outer edges to the container node and internal edges to the generated start/end nodes.',
        retryable: true,
        issues: [{ path: 'entityDocument.edges', message }],
      },
    }
  }

  if (message.startsWith('Invalid edited workflow:')) {
    const details = message.replace(/^Invalid edited workflow:\s*/, '').trim()
    const detailIssues = details
      .split(/;\s+/)
      .filter(Boolean)
      .map((issue) => {
        const trimmedIssue = issue.trim().replace(/\.$/, '')
        const embeddedPathMatch = trimmedIssue.match(
          /^Document contract is inconsistent: invalid block sub-block values for ([^ ]+) \((.+)\)$/
        )

        return {
          path: embeddedPathMatch ? `entityDocument.${embeddedPathMatch[1]}` : 'entityDocument',
          message: embeddedPathMatch ? embeddedPathMatch[2] : trimmedIssue,
        }
      })

    const hint = details.includes('non-canonical sub-block')
      ? 'Use only the canonical sub-block ids from `get_blocks_metadata` for that block type. Keep the existing canonical ids and remove invented keys.'
      : details.includes('removedBlockIds')
        ? 'Keep every existing block id in the Mermaid graph unless the user explicitly asked to remove or replace it; list intentional removals in `removedBlockIds`.'
      : details.includes('unknown block type')
        ? 'Use block types exactly as returned by `get_available_blocks` or `get_blocks_metadata`.'
        : details.includes('Edge references non-existent')
          ? 'Every edge source and target must match a block id in the same document.'
          : 'Return a complete workflow graph that validates as workflow state. Preserve block ids and valid edge references.'

    return {
      status: 422,
      body: {
        code: 'invalid_workflow_state',
        error: message,
        hint,
        retryable: true,
        ...(detailIssues.length > 0 ? { issues: detailIssues } : {}),
      },
    }
  }

  return null
}

export function buildCopilotServerToolErrorResponse(
  toolName: string | undefined,
  error: unknown
): CopilotServerToolErrorResponse {
  if (error instanceof StructuredServerToolError) {
    return {
      status: error.status,
      body: {
        code: error.code,
        error: error.message,
        ...(typeof error.hint === 'string' ? { hint: error.hint } : {}),
        ...(typeof error.retryable === 'boolean' ? { retryable: error.retryable } : {}),
        ...(Array.isArray(error.issues) ? { issues: error.issues } : {}),
      },
    }
  }

  if (error instanceof z.ZodError) {
    return buildInvalidToolPayloadError(toolName, error)
  }

  const message = error instanceof Error ? error.message : 'Failed to execute server tool'

  if (toolName === 'edit_workflow') {
    const structuredError = buildEditWorkflowError(message)
    if (structuredError) {
      return structuredError
    }
  }

  return {
    status: 500,
    body: {
      code: 'server_tool_execution_failed',
      error: message,
      retryable: false,
    },
  }
}
