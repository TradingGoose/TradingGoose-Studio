import { readCompletionMessageText } from '@/lib/copilot/completion'
import { TITLE_GENERATION_SYSTEM_PROMPT, TITLE_GENERATION_USER_PROMPT } from '@/lib/copilot/prompts'
import type { CopilotRuntimeModel } from '@/lib/copilot/runtime-models'
import { createLogger } from '@/lib/logs/console/logger'
import { proxyCopilotCompletionRequest } from '@/app/api/copilot/proxy'

const logger = createLogger('CopilotTitle')

/**
 * Generates a short title for a chat based on the first message
 * @returns A short title or null if the request fails
 */
export async function requestCopilotTitle({
  message,
  userId,
  model,
}: {
  message: string
  userId: string
  model: CopilotRuntimeModel
}): Promise<string | null> {
  try {
    const response = await proxyCopilotCompletionRequest({
      body: {
        stream: false,
        model,
        messages: [
          {
            role: 'system',
            content: TITLE_GENERATION_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: TITLE_GENERATION_USER_PROMPT(message),
          },
        ],
      },
      headers: {
        'x-copilot-user-id': userId,
      },
    })
    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      logger.warn('Copilot title request failed', {
        status: response.status,
        error: errorText,
      })
      return null
    }
    const data = await response.json().catch(() => null)
    const title = readCompletionMessageText(data)
    return title.length > 0 ? title : null
  } catch (error) {
    logger.error('Error requesting copilot title:', error)
    return null
  }
}
