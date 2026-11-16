import { ModelRouterLanguageModel, parseModelString } from '@mastra/core/llm'
import { getModelProviders } from '@/lib/mastra/providers'
import { getSystemServiceDefinition } from '@/lib/system-services/catalog'
import { resolveSystemServiceConfig } from '@/lib/system-services/service'

async function resolveManagedKey(provider: string): Promise<string | undefined> {
  const definition = await getSystemServiceDefinition(provider)
  const credential = definition?.credentialFields[0]
  if (!definition || !credential) return undefined
  const config = await resolveSystemServiceConfig(definition.id)
  const key = config[credential.key]
  return typeof key === 'string' ? key : undefined
}

/** Native provider identity with fresh DB credentials or an authorized request-local key. */
export async function resolveConfiguredModel(model: string, apiKey?: string) {
  const { provider, modelId } = parseModelString(model)
  if (!provider) throw new Error('Model must use provider/model format')
  if (!Object.hasOwn(getModelProviders(), provider))
    throw new Error(`The selected provider "${provider}" is not supported by Studio`)
  if (apiKey !== undefined && !apiKey.trim())
    throw new Error('A nonempty request-local API key is required')
  const key = apiKey?.trim() ?? (await resolveManagedKey(provider))
  if (!key)
    throw new Error(
      `The system API key for provider "${provider}" is not configured in System Services`
    )
  return { providerId: provider, modelId, apiKey: key }
}

/** Mastra owns routing, provider adapters and request formatting. */
export async function createConfiguredLanguageModel(model: string, apiKey?: string) {
  return new ModelRouterLanguageModel(await resolveConfiguredModel(model, apiKey))
}
