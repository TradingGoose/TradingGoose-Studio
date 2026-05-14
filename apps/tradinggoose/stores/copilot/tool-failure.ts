import {
  maybeHandleCopilotMarkCompleteContinuation,
  postCopilotMarkCompleteRequest,
} from '@/stores/copilot/mark-complete'

export async function reportClientManagedToolFailure(params: {
  id: string
  name?: string
  message: string
  instance?: { markToolComplete?: (status: number, message?: any, data?: any) => Promise<boolean> }
}): Promise<void> {
  const { id, name, message, instance } = params

  try {
    if (typeof instance?.markToolComplete === 'function') {
      await instance.markToolComplete(500, message)
      return
    }

    const response = await postCopilotMarkCompleteRequest({
      toolCallId: id,
      toolName: name || 'unknown_tool',
      status: 500,
      message,
    })

    if (response instanceof Response && response.ok) {
      await maybeHandleCopilotMarkCompleteContinuation({
        toolCallId: id,
        response,
      })
    }
  } catch {}
}
