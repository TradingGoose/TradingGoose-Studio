type ContinuationHandler = (params: { toolCallId: string; response: Response }) => Promise<void>

export type CopilotMarkCompleteRequest = {
  toolCallId: string
  toolName: string
  status: number
  message?: unknown
  data?: unknown
}

let continuationHandler: ContinuationHandler | null = null

export function registerCopilotMarkCompleteContinuationHandler(handler: ContinuationHandler): void {
  continuationHandler = handler
}

export function postCopilotMarkCompleteRequest(
  params: CopilotMarkCompleteRequest,
  signal?: AbortSignal
): Promise<Response> {
  return fetch('/api/copilot/tools/mark-complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      id: params.toolCallId,
      name: params.toolName,
      status: params.status,
      message: params.message,
      data: params.data,
    }),
  })
}

export async function maybeHandleCopilotMarkCompleteContinuation(params: {
  toolCallId: string
  response: Response
}): Promise<boolean> {
  const contentType = params.response.headers.get('content-type') || ''
  if (!contentType.includes('text/event-stream') || !params.response.body || !continuationHandler) {
    return false
  }

  await continuationHandler(params)
  return true
}
