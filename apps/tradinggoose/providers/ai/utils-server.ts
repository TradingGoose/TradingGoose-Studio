import { isHosted } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { useProvidersStore } from '@/stores/providers/store'

const logger = createLogger('ProvidersUtilsServer')

/**
 * Providers whose key can be supplied centrally from admin services, so a request
 * can reach them without carrying its own key. Unlike the hosted path below, this
 * works on any deployment.
 */
const SYSTEM_SERVICE_KEY_PROVIDERS = new Set([
  'openai',
  'anthropic',
  'deepseek',
  'openrouter',
  'nvidia',
])

type SystemServiceKeys = { rotationKeys: string[]; apiKey: string | null }

async function readSystemServiceKeys(provider: string): Promise<SystemServiceKeys> {
  const {
    resolveAnthropicServiceConfig,
    resolveDeepseekServiceConfig,
    resolveNvidiaServiceConfig,
    resolveOpenAIServiceConfig,
    resolveOpenRouterServiceConfig,
  } = await import('@/lib/system-services/runtime')

  switch (provider) {
    // OpenAI's Default API Key stays reserved for embeddings, so only its
    // rotation slots feed completions. Anthropic has no single-key field.
    case 'openai':
      return { rotationKeys: (await resolveOpenAIServiceConfig()).rotationKeys, apiKey: null }
    case 'anthropic':
      return { rotationKeys: (await resolveAnthropicServiceConfig()).rotationKeys, apiKey: null }
    case 'deepseek':
      return await resolveDeepseekServiceConfig()
    case 'openrouter':
      return await resolveOpenRouterServiceConfig()
    default:
      return await resolveNvidiaServiceConfig()
  }
}

async function getSystemServiceApiKey(provider: string): Promise<string | null> {
  if (!SYSTEM_SERVICE_KEY_PROVIDERS.has(provider)) {
    return null
  }

  try {
    const [{ rotationKeys, apiKey }, { pickRotatingKey }] = await Promise.all([
      readSystemServiceKeys(provider),
      import('@/lib/utils-server'),
    ])

    return pickRotatingKey(rotationKeys) ?? apiKey
  } catch (error) {
    logger.warn('Failed to resolve system service API key', {
      provider,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return null
  }
}

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

  if (hasUserKey) {
    return userProvidedKey!
  }

  const systemServiceKey = await getSystemServiceApiKey(provider)
  if (systemServiceKey) {
    return systemServiceKey
  }

  throw new Error(`API key is required for ${provider} ${model}`)
}
