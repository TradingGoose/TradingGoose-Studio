type ContinuationHandler = (params: {
  toolCallId: string
  response: Response
}) => Promise<void>

let continuationHandler: ContinuationHandler | null = null

export function registerCopilotMarkCompleteContinuationHandler(
  handler: ContinuationHandler
): void {
  continuationHandler = handler
}

export async function maybeHandleCopilotMarkCompleteContinuation(params: {
  toolCallId: string
  response: Response | { headers?: { get?: (name: string) => string | null }; body?: unknown }
}): Promise<boolean> {
  const contentType = params.response.headers?.get?.('content-type') || ''
  if (!contentType.includes('text/event-stream') || !params.response.body || !continuationHandler) {
    return false
  }

  await continuationHandler(params as { toolCallId: string; response: Response })
  return true
}
