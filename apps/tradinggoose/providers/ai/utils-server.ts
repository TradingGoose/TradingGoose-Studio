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

  throw new Error(`API key is required for ${provider} ${model}`)
}
