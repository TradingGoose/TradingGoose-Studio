import type { CopilotAccessLevel } from '@/lib/copilot/access-policy'
import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import { ExecuteResponseSuccessSchema } from '@/lib/copilot/tools/shared/schemas'

export interface CopilotServerToolErrorLike {
  error?: string
  code?: string
  hint?: string
  retryable?: boolean
  issues?: Array<{
    path: string
    message: string
  }>
}

type CopilotServerToolError = Error & {
  status?: number
  payload?: CopilotServerToolErrorLike
}

export interface CopilotServerToolErrorDetails {
  hint?: string
  issues?: Array<{ path: string; message: string }>
}

function normalizeCopilotServerToolErrorDetails(
  payload: CopilotServerToolErrorLike | undefined
): CopilotServerToolErrorDetails | undefined {
  const hint = typeof payload?.hint === 'string' ? payload.hint.trim() : ''
  const issues = Array.isArray(payload?.issues)
    ? payload.issues
        .filter(
          (issue) =>
            typeof issue?.path === 'string' &&
            issue.path.trim().length > 0 &&
            typeof issue.message === 'string' &&
            issue.message.trim().length > 0
        )
        .slice(0, 3)
        .map((issue) => ({ path: issue.path.trim(), message: issue.message.trim() }))
    : []

  if (!hint && issues.length === 0) return undefined
  return {
    ...(hint ? { hint } : {}),
    ...(issues.length > 0 ? { issues } : {}),
  }
}

function createCopilotServerToolError(
  status: number,
  message: string,
  payload?: CopilotServerToolErrorLike
): CopilotServerToolError {
  const error = new Error(message) as CopilotServerToolError
  error.status = status
  error.payload = payload
  return error
}

export async function buildCopilotServerToolError(response: Response): Promise<Error> {
  const fallbackMessage = `Server error (${response.status})`
  const text = await response.text().catch(() => '')

  if (!text) {
    return createCopilotServerToolError(response.status, fallbackMessage)
  }

  try {
    const payload = JSON.parse(text) as CopilotServerToolErrorLike
    const details = normalizeCopilotServerToolErrorDetails(payload)
    const issueSummary =
      details?.issues && details.issues.length > 0
        ? `Issues: ${details.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`
        : undefined
    const messageParts = [
      payload.error,
      details?.hint ? `Hint: ${details.hint}` : undefined,
      issueSummary,
    ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0)

    return createCopilotServerToolError(
      response.status,
      messageParts.join(' ') || fallbackMessage,
      payload
    )
  } catch {
    return createCopilotServerToolError(response.status, text || fallbackMessage)
  }
}

export function getCopilotServerToolErrorDetails(
  error: unknown
): CopilotServerToolErrorDetails | undefined {
  return normalizeCopilotServerToolErrorDetails(
    (error as CopilotServerToolError | undefined)?.payload
  )
}

export function getCopilotServerToolErrorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | undefined)?.status
  return typeof status === 'number' ? status : undefined
}

export async function executeCopilotServerTool<TResult = unknown>(input: {
  toolName: string
  payload?: unknown
  accessLevel?: CopilotAccessLevel
  context?: {
    contextEntityKind?: ReviewEntityKind
    contextEntityId?: string
    workspaceId?: string
  }
  signal?: AbortSignal
}): Promise<TResult> {
  const context = input.context && Object.keys(input.context).length > 0 ? input.context : undefined
  const response = await fetch('/api/copilot/execute-copilot-server-tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: input.signal,
    body: JSON.stringify({
      toolName: input.toolName,
      payload: input.payload ?? {},
      ...(input.accessLevel === 'full' ? { accessLevel: input.accessLevel } : {}),
      ...(context ? { context } : {}),
    }),
  })

  if (!response.ok) {
    throw await buildCopilotServerToolError(response)
  }

  const json = await response.json()
  const parsed = ExecuteResponseSuccessSchema.parse(json)
  return parsed.result as TResult
}

export function isCopilotServerToolReviewResult(result: unknown): result is {
  requiresReview: true
  reviewToken: string
} {
  return (
    !!result &&
    typeof result === 'object' &&
    (result as { requiresReview?: unknown }).requiresReview === true &&
    typeof (result as { reviewToken?: unknown }).reviewToken === 'string'
  )
}

export async function acceptCopilotServerToolReview<TResult = unknown>(input: {
  toolName: string
  reviewToken: string
  context?: {
    contextEntityKind?: ReviewEntityKind
    contextEntityId?: string
    workspaceId?: string
  }
  signal?: AbortSignal
}): Promise<TResult> {
  const context = input.context && Object.keys(input.context).length > 0 ? input.context : undefined
  const response = await fetch('/api/copilot/execute-copilot-server-tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: input.signal,
    body: JSON.stringify({
      toolName: input.toolName,
      reviewAction: 'accept',
      reviewToken: input.reviewToken,
      ...(context ? { context } : {}),
    }),
  })

  if (!response.ok) {
    throw await buildCopilotServerToolError(response)
  }

  const json = await response.json()
  const parsed = ExecuteResponseSuccessSchema.parse(json)
  return parsed.result as TResult
}
