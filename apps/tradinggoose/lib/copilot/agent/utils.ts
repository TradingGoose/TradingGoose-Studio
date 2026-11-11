import { completeCopilot } from '@/lib/copilot/native/completion'
import { TITLE_GENERATION_SYSTEM_PROMPT, TITLE_GENERATION_USER_PROMPT } from '@/lib/copilot/prompts'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CopilotTitle')

/** A title is committed only by the caller after an explicit completed native outcome. */
export async function requestCopilotTitle({
  message,
  userId,
  workspaceId,
  model,
  signal,
}: {
  message: string
  userId: string
  workspaceId: string | null
  model: string
  signal?: AbortSignal
}): Promise<string | null> {
  try {
    signal?.throwIfAborted()
    const outcome = await completeCopilot(
      {
        scope: { actorUserId: userId, workspaceId },
        purpose: 'title',
        model,
        messages: [
          { role: 'system', content: TITLE_GENERATION_SYSTEM_PROMPT },
          { role: 'user', content: TITLE_GENERATION_USER_PROMPT(message) },
        ],
      },
      signal
    )
    if (signal?.aborted || outcome.status !== 'completed') return null
    return outcome.text.trim() || null
  } catch (error) {
    logger.warn('Native Copilot title did not complete', {
      cancelled: signal?.aborted === true,
      message: error instanceof Error ? error.message : 'Title unavailable',
    })
    return null
  }
}
