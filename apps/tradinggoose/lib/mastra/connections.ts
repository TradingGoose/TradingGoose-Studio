import { GatewayRegistry, ModelRouterLanguageModel, parseModelString } from '@mastra/core/llm'
import { getSystemServiceDefinition } from '@/lib/system-services/catalog'
import { resolveSystemServiceConfig } from '@/lib/system-services/service'

async function resolveManagedKey(provider: string): Promise<string | undefined> {
  const definition = getSystemServiceDefinition(provider)
  const credential = definition?.credentialFields[0]
  if (!definition || !credential) return undefined
  const config = await resolveSystemServiceConfig(definition.id)
  const key = config[credential.key]
  return typeof key === 'string' && key.trim() ? key.trim() : undefined
}

/** Native provider identity with fresh DB credentials or an authorized request-local key. */
export async function resolveConfiguredModel(model: string, apiKey?: string) {
  const { provider, modelId } = parseModelString(model)
  if (!provider) throw new Error('Model must use Mastra provider/model format')
  if (!Object.hasOwn(GatewayRegistry.getInstance().getProviders(), provider))
    throw new Error(`The selected provider "${provider}" is not available in Mastra`)
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
