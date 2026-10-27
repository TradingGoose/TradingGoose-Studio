import { isHosted } from '@/lib/environment'

export async function getApiKey(
  provider: string,
  model: string,
  userProvidedKey?: string
): Promise<string> {
  if (provider === 'ollama') {
    return 'empty'
  }

  if (userProvidedKey) {
    return userProvidedKey
  }

  if (isHosted && (provider === 'openai' || provider === 'anthropic')) {
    const { getRotatingApiKey } = await import('@/lib/utils-server')
    return getRotatingApiKey(provider)
  }

  throw new Error(`API key is required for ${provider} ${model}`)
}
