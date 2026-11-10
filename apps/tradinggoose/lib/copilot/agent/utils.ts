import { fetchNativeCompletion } from '@/lib/copilot/native/client'
import {
  assertNativeCorrelation,
  COPILOT_NATIVE_REVISION,
  type CompletionFailureResponse,
  type CompletionResponse,
  parseNativeContract,
} from '@/lib/copilot/native/contract'
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
    const response = await fetchNativeCompletion(
      {
        protocolRevision: COPILOT_NATIVE_REVISION,
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
    const payload: unknown = await response.json()
    const completed =
      payload !== null &&
      typeof payload === 'object' &&
      'status' in payload &&
      payload.status === 'completed'
    const outcome = completed
      ? await parseNativeContract('CompletionResponse', payload)
      : await parseNativeContract('CompletionFailureResponse', payload)
    assertNativeCorrelation(outcome, requestId)
    // Active received acceptance remains visible independently of title publication.
    onOutcome?.(outcome)
    if (signal?.aborted || !response.ok || outcome.status !== 'completed') return null
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
