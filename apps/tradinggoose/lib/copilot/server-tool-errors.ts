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
      hint:
        'Match the payload exactly to the active tool manifest. Use only allowed top-level properties, include required fields, and respect enum/value constraints.',
      retryable: true,
      issues: formattedIssues,
    },
  }
}

function buildEditWorkflowError(message: string): CopilotServerToolErrorResponse | null {
  if (message === 'Missing TG_WORKFLOW metadata') {
    return {
      status: 422,
      body: {
        code: 'invalid_workflow_document_missing_metadata',
        error: 'Workflow document is missing a standalone `%% TG_WORKFLOW {...}` metadata line.',
        hint:
          'Send raw `tg-mermaid-v1` Mermaid text with real newlines, and keep `%% TG_WORKFLOW {...}` on its own line near the top of the document.',
        retryable: true,
      },
    }
  }

  if (message === 'Workflow document did not contain any TG_BLOCK entries') {
    return {
      status: 422,
      body: {
        code: 'invalid_workflow_document_missing_blocks',
        error: 'Workflow document did not contain any standalone `%% TG_BLOCK {...}` block entries.',
        hint:
          'Emit canonical `%% TG_BLOCK {...}` comment lines for each block. Do not embed `TG_BLOCK` JSON inside node labels or send simplified block metadata.',
        retryable: true,
      },
    }
  }

  if (message.startsWith('Invalid TG_BLOCK payload:')) {
    return {
      status: 422,
      body: {
        code: 'invalid_workflow_document_block_payload',
        error: message,
        hint:
          'Each `TG_BLOCK` payload must be canonical workflow state with `id`, `type`, `name`, `position`, `subBlocks`, `outputs`, and `enabled`.',
        retryable: true,
      },
    }
  }

  if (message.startsWith('Invalid TG_EDGE payload')) {
    return {
      status: 422,
      body: {
        code: 'invalid_workflow_document_edge_payload',
        error: message,
        hint:
          'Each `TG_EDGE` payload must be a standalone JSON object with string `source` and `target` fields that matches the visible Mermaid connection.',
        retryable: true,
      },
    }
  }

  if (
    message ===
    'Workflow document contains Mermaid connection lines but no TG_EDGE entries. Every visible workflow connection must have a matching TG_EDGE payload.'
  ) {
    return {
      status: 422,
      body: {
        code: 'invalid_workflow_document_missing_edge_metadata',
        error: message,
        hint:
          'When the diagram shows visible Mermaid connections, include matching standalone `%% TG_EDGE {...}` lines for each connection.',
        retryable: true,
      },
    }
  }

  if (message.startsWith('Workflow document edge metadata is inconsistent.')) {
    return {
      status: 422,
      body: {
        code: 'invalid_workflow_document_edge_mismatch',
        error: message,
        hint:
          'Keep the visible Mermaid connection lines and the canonical `%% TG_EDGE {...}` payloads in logical sync. Loop and parallel child blocks must stay inside their container subgraphs and cross container boundaries through the container handles, while condition blocks keep their diamond-and-branch structure.',
        retryable: true,
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
          path: embeddedPathMatch ? `workflowDocument.${embeddedPathMatch[1]}` : 'workflowDocument',
          message: embeddedPathMatch ? embeddedPathMatch[2] : trimmedIssue,
        }
      })

    const hint = details.includes('non-canonical sub-block')
      ? 'Use only the canonical sub-block ids from `get_blocks_metadata` for that block type. Keep the existing canonical ids and remove invented keys.'
      : details.includes('unknown block type')
        ? 'Use block types exactly as returned by `get_blocks_and_tools` or `get_blocks_metadata`. Keep `TG_BLOCK.type` unchanged unless you are intentionally replacing the block with another valid type.'
        : details.includes('Edge references non-existent')
          ? 'Every `TG_EDGE` source and target must match an existing `TG_BLOCK`, `TG_LOOP`, or `TG_PARALLEL` id in the same document.'
          : 'Return a complete canonical workflow document that validates as workflow state. Preserve required block fields, canonical ids, and valid edge references.'

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
