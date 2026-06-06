import { useProvidersStore } from '@/stores/providers/store'

/**
 * Get an API key for a specific provider.
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

  if (provider === 'hosted' || isOllamaModel) {
    return 'empty'
  }

  if (!hasUserKey) {
    throw new Error(`API key is required for ${provider} ${model}`)
  }

  return userProvidedKey!
}
