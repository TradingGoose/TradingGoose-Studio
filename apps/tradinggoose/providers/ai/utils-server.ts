import { isHosted } from '@/lib/environment'
import { useProvidersStore } from '@/stores/providers/store'

/**
 * Get an API key for a specific provider, handling rotation and fallbacks.
 * Server-only helper.
 */
export async function getApiKey(
  provider: string,
  model: string,
  userProvidedKey?: string
): Promise<string> {
  const hasUserKey = !!userProvidedKey
  const isOllamaModel =
    provider === 'ollama' || useProvidersStore.getState().providers.ollama.models.includes(model)

  if (isOllamaModel) {
    return 'empty'
  }

  const isOpenAIModel = provider === 'openai'
  const isClaudeModel = provider === 'anthropic'

  if (isHosted && (isOpenAIModel || isClaudeModel)) {
    try {
      const { getRotatingApiKey } = require('@/lib/utils-server')
      return await getRotatingApiKey(provider)
    } catch (_error) {
      if (hasUserKey) {
        return userProvidedKey!
      }

      throw new Error(`No API key available for ${provider} ${model}`)
    }
  }

  if (!hasUserKey) {
    throw new Error(`API key is required for ${provider} ${model}`)
  }

  return userProvidedKey!
}
