import { completeCopilot } from '@/lib/copilot/native/completion'
import type { CompletionFailureResponse, CompletionResponse } from '@/lib/copilot/native/contract'
import { TITLE_GENERATION_SYSTEM_PROMPT, TITLE_GENERATION_USER_PROMPT } from '@/lib/copilot/prompts'
import type { CopilotRuntimeModel } from '@/lib/copilot/runtime-models'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CopilotTitle')
export type CopilotTitleOutcome = CompletionResponse | CompletionFailureResponse

/** A title is committed only by the caller after an explicit completed native outcome. */
export async function requestCopilotTitle({
  message,
  userId,
  workspaceId,
  model,
  signal,
  onOutcome,
}: {
  message: string
  userId: string
  workspaceId: string | null
  model: CopilotRuntimeModel
  signal?: AbortSignal
  onOutcome?: (outcome: CopilotTitleOutcome) => void
}): Promise<string | null> {
  const requestId = crypto.randomUUID()
  try {
    signal?.throwIfAborted()
    const outcome = await completeCopilot(
      {
        requestId,
        scope: { actorUserId: userId, workspaceId },
        purpose: 'title',
        stream: false,
        model,
        messages: [
          { role: 'system', content: TITLE_GENERATION_SYSTEM_PROMPT },
          { role: 'user', content: TITLE_GENERATION_USER_PROMPT(message) },
        ],
      },
      signal
    )
    // Active received acceptance remains visible independently of title publication.
    onOutcome?.(outcome)
    if (signal?.aborted || outcome.status !== 'completed') return null
    return outcome.text.trim() || null
  } catch (error) {
    logger.warn('Native Copilot title did not complete', {
      requestId,
      cancelled: signal?.aborted === true,
      message: error instanceof Error ? error.message : 'Title unavailable',
    })
    return null
  }
}
