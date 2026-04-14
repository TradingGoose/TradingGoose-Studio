import { ExecuteResponseSuccessSchema } from '@/lib/copilot/tools/shared/schemas'

export interface CopilotServerToolErrorLike {
  error?: string
  code?: string
  hint?: string
  retryable?: boolean
}

type CopilotServerToolError = Error & {
  status?: number
  payload?: CopilotServerToolErrorLike
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
    const messageParts = [payload.error, payload.hint ? `Hint: ${payload.hint}` : undefined]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)

    return createCopilotServerToolError(
      response.status,
      messageParts.join(' ') || fallbackMessage,
      payload
    )
  } catch {
    return createCopilotServerToolError(response.status, text || fallbackMessage)
  }
}

export function getCopilotServerToolErrorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | undefined)?.status
  return typeof status === 'number' ? status : undefined
}

export async function executeCopilotServerTool<TResult = unknown>(input: {
  toolName: string
  payload?: unknown
}): Promise<TResult> {
  const response = await fetch('/api/copilot/execute-copilot-server-tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      toolName: input.toolName,
      payload: input.payload ?? {},
    }),
  })

  if (!response.ok) {
    throw await buildCopilotServerToolError(response)
  }

  const json = await response.json()
  const parsed = ExecuteResponseSuccessSchema.parse(json)
  return parsed.result as TResult
}
