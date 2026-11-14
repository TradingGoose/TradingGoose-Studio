import {
  AzureOpenAIGateway,
  type AzureOpenAIGatewayConfig,
  defaultGateways,
  GatewayRegistry,
  type MastraModelGatewayInterface,
  ModelRouterLanguageModel,
  modelSupportsTemperature,
  type ProviderConfig,
  parseModelString,
} from '@mastra/core/llm'
import { z } from 'zod'
import { getSystemServiceDefinition } from '@/lib/system-services/catalog'
import {
  resolveSystemServiceConfig,
  resolveSystemServiceSettingsConfig,
} from '@/lib/system-services/service'

const PROVIDERS_SERVICE = 'mastra_model_providers'
const modelIds = z.array(z.string().min(1))
const providerSettings = z
  .object({
    name: z.string().min(1),
    url: z.url().refine((url) => ['http:', 'https:'].includes(new URL(url).protocol)),
    models: modelIds,
  })
  .strict()
const providerMap = z.record(z.string(), providerSettings)

function jsonSetting(value: unknown, empty: string): unknown {
  try {
    return JSON.parse(typeof value === 'string' && value.trim() ? value : empty)
  } catch {
    throw new Error('Model connection settings must contain valid JSON in System Services')
  }
}

async function getAzureSettings(): Promise<Omit<AzureOpenAIGatewayConfig, 'apiKey'> | undefined> {
  const settings = await resolveSystemServiceSettingsConfig('azure_openai')
  const deployments = modelIds.parse(jsonSetting(settings.deployments, '[]'))
  if (!settings.resourceName && !deployments.length) return undefined
  if (
    typeof settings.resourceName !== 'string' ||
    !settings.resourceName.trim() ||
    !deployments.length
  )
    throw new Error(
      'Configure Azure OpenAI resourceName and exact deployment IDs in System Services'
    )
  return {
    resourceName: settings.resourceName.trim(),
    deployments,
    ...(typeof settings.apiVersion === 'string' && settings.apiVersion.trim()
      ? { apiVersion: settings.apiVersion.trim() }
      : {}),
  }
}

/** Managed connection metadata uses settings-only reads; no credentials enter public registries. */
export async function getConfiguredProviders(): Promise<Record<string, ProviderConfig>> {
  const [settings, azure, ollama, vllm] = await Promise.all([
    resolveSystemServiceSettingsConfig(PROVIDERS_SERVICE),
    getAzureSettings(),
    resolveSystemServiceSettingsConfig('ollama'),
    resolveSystemServiceSettingsConfig('vllm'),
  ])
  const configured = providerMap.parse(jsonSetting(settings.providers, '{}'))
  const providers: Record<string, ProviderConfig> = Object.create(null)
  const nativeProviders = GatewayRegistry.getInstance().getProviders()
  for (const [id, config] of Object.entries(configured)) {
    if (defaultGateways.some((gateway) => gateway.id === id) || id === 'azure-openai')
      throw new Error(
        `Invalid managed provider "${id}": the ID is reserved by a native Mastra gateway. Choose a distinct provider ID.`
      )
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
      throw new Error('Managed provider IDs must use lowercase letters, digits and hyphens')
    if (id === 'ollama' || id === 'vllm')
      throw new Error(`Configure "${id}" through its own System Service`)
    if (getSystemServiceDefinition(id) && !Object.hasOwn(nativeProviders, id))
      throw new Error(
        `Managed provider ID "${id}" is reserved by a non-model System Service. Choose a distinct provider ID.`
      )
    providers[id] = { ...config, apiKeyEnvVar: [], gateway: 'models.dev' }
  }
  for (const [id, config] of [
    ['ollama', ollama],
    ['vllm', vllm],
  ] as const) {
    const models = modelIds.parse(jsonSetting(config.models, '[]'))
    if (!models.length) continue
    const provider = providerSettings.parse({ name: id, url: config.baseUrl, models })
    providers[id] = { ...provider, apiKeyEnvVar: [], gateway: 'models.dev' }
  }
  if (azure)
    providers['azure-openai'] = {
      name: 'Azure OpenAI',
      models: azure.deployments!,
      apiKeyEnvVar: [],
      gateway: 'azure-openai',
    }
  return providers
}

async function resolveManagedKey(provider: string): Promise<string | undefined> {
  const serviceId = provider === 'azure-openai' ? 'azure_openai' : provider
  const definition = getSystemServiceDefinition(serviceId)
  if (definition) {
    const credential = definition.credentialFields[0]
    if (!credential) return undefined
    const config = await resolveSystemServiceConfig(serviceId)
    const key = config[credential.key]
    return typeof key === 'string' && key.trim() ? key.trim() : undefined
  }
  const config = await resolveSystemServiceConfig(PROVIDERS_SERVICE)
  let keys: Record<string, string>
  try {
    keys = z.record(z.string(), z.string().min(1)).parse(jsonSetting(config.apiKeys, '{}'))
  } catch {
    throw new Error(
      'Managed model API keys must be a JSON object of provider IDs and keys in System Services'
    )
  }
  for (const id of Object.keys(keys))
    if (getSystemServiceDefinition(id) || id === 'azure-openai')
      throw new Error(`Configure credentials for "${id}" through its own System Service`)
  return Object.hasOwn(keys, provider) ? keys[provider].trim() || undefined : undefined
}

/** Native configuration preserves exact identity and authorized request-local BYOK precedence. */
export async function resolveConfiguredModel(model: string, apiKey?: string) {
  const { provider, modelId } = parseModelString(model)
  if (!provider) throw new Error('Model must use Mastra provider/model format')
  const configured = await getConfiguredProviders()
  if (
    !Object.hasOwn(configured, provider) &&
    !Object.hasOwn(GatewayRegistry.getInstance().getProviders(), provider)
  )
    throw new Error(`The selected provider "${provider}" is not configured`)
  const config = configured[provider]
  if (apiKey !== undefined && !apiKey.trim())
    throw new Error('A nonempty request-local API key is required')
  const key = apiKey?.trim() ?? (await resolveManagedKey(provider))
  if (!key && !config?.url)
    throw new Error(
      `The system API key for provider "${provider}" is not configured in System Services`
    )
  return { providerId: provider, modelId, url: config?.url, apiKey: key ?? '' }
}

/** Request-owned native models never rely on process environment credentials or stale gateway keys. */
export async function createConfiguredLanguageModel(model: string, apiKey?: string) {
  const config = await resolveConfiguredModel(model, apiKey)
  if (config.url && modelSupportsTemperature(model) === false)
    throw new Error(
      `Configured model "${model}" conflicts with native Mastra sampling capabilities. Choose a distinct managed provider ID.`
    )
  const azure = config.providerId === 'azure-openai' ? await getAzureSettings() : undefined
  return new ModelRouterLanguageModel(
    config,
    azure
      ? [new AzureOpenAIGateway({ ...azure, apiKey: config.apiKey }) as MastraModelGatewayInterface]
      : []
  )
}
