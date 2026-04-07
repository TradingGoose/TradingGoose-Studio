import { formatCompletionModel, readCompletionMessageText } from '@/lib/copilot/completion'
import { getCopilotModel } from '@/lib/copilot/config'
import { TITLE_GENERATION_SYSTEM_PROMPT, TITLE_GENERATION_USER_PROMPT } from '@/lib/copilot/prompts'
import { resolveCopilotRuntimeProvider } from '@/lib/copilot/runtime-provider'
import { createLogger } from '@/lib/logs/console/logger'
import type { ProviderId } from '@/providers/ai/types'
import { proxyCopilotCompletionRequest } from '@/app/api/copilot/proxy'

const logger = createLogger('CopilotTitle')

/**
 * Generates a short title for a chat based on the first message
 * @returns A short title or null if the request fails
 */
export async function requestCopilotTitle({
  message,
  model,
  provider,
}: {
  message: string
  model?: string
  provider?: ProviderId
}): Promise<string | null> {
  try {
    const defaults = getCopilotModel('title')
    const resolvedModel = model || defaults.model
    const shouldUseRuntimeProvider = !!provider || !!model
    const resolvedProvider = shouldUseRuntimeProvider
      ? resolveCopilotRuntimeProvider(resolvedModel, provider)
      : defaults.provider
    const response = await proxyCopilotCompletionRequest({
      body: {
        stream: false,
        model: formatCompletionModel(resolvedModel, resolvedProvider),
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
