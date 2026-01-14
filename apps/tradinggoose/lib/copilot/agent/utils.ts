import { createLogger } from '@/lib/logs/console/logger'
import { proxyCopilotRequest } from '@/app/api/copilot/proxy'
import type { CopilotProviderConfig } from '@/lib/copilot/types'

const logger = createLogger('SimAgentUtils')

/**
 * Generates a short title for a chat based on the first message
 * @returns A short title or null if the request fails
 */
export async function requestCopilotTitle(params: {
  message: string
  workflowId: string
  userId: string
  conversationId?: string
  model?: string
  provider?: CopilotProviderConfig
}): Promise<string | null> {
  const { message, workflowId, userId, conversationId, model, provider } = params
  try {
    const response = await proxyCopilotRequest({
      endpoint: '/api/chat-completion-streaming',
      body: {
        message,
        workflowId,
        userId,
        stream: false,
        mode: 'title',
        ...(conversationId ? { conversationId } : {}),
        ...(model ? { model } : {}),
        ...(provider ? { provider } : {}),
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
    const title = typeof data?.content === 'string' ? data.content.trim() : ''
    return title.length > 0 ? title : null
  } catch (error) {
    logger.error('Error requesting copilot title:', error)
    return null
  }
}
