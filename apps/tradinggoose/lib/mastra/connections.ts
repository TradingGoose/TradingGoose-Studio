import {
  AzureOpenAIGateway,
  type AzureOpenAIGatewayConfig,
  type MastraModelGatewayInterface,
  ModelRouterLanguageModel,
  type OpenAICompatibleConfig,
  type ProviderConfig,
} from '@mastra/core/llm'

/** Server deployment configuration only; request bodies cannot supply connection URLs. */
export function getConfiguredProviders(): Record<string, ProviderConfig> {
  const providers: Record<string, ProviderConfig> = Object.create(null)
  const configured = JSON.parse(process.env.MASTRA_MODEL_PROVIDERS || '{}')
  for (const [id, value] of Object.entries(configured)) {
    const config = value as ProviderConfig
    if (
      !/^[a-z0-9][a-z0-9-]*$/.test(id) ||
      !config.name ||
      !Array.isArray(config.models) ||
      !config.models.every((model) => typeof model === 'string' && model.length > 0) ||
      !config.url ||
      !['http:', 'https:'].includes(new URL(config.url).protocol)
    ) {
      throw new Error(
        'Invalid MASTRA_MODEL_PROVIDERS configuration. Configure named providers with a base URL and exact model IDs.'
      )
    }
    providers[id] = {
      name: config.name,
      models: config.models,
      url: config.url,
      apiKeyEnvVar: config.apiKeyEnvVar || [],
      gateway: 'models.dev',
    }
  }
  const azure = getAzureConfig()
  if (azure)
    providers['azure-openai'] = {
      name: 'Azure OpenAI',
      models: azure.deployments!,
      apiKeyEnvVar: [],
      gateway: 'azure-openai',
    }
  return providers
}

function getAzureConfig(): AzureOpenAIGatewayConfig | undefined {
  if (!process.env.MASTRA_AZURE_OPENAI) return undefined
  const config = JSON.parse(process.env.MASTRA_AZURE_OPENAI) as AzureOpenAIGatewayConfig
  if (
    !config.resourceName ||
    !config.apiKey ||
    !Array.isArray(config.deployments) ||
    !config.deployments.length ||
    !config.deployments.every((id) => typeof id === 'string' && id.length > 0)
  ) {
    throw new Error(
      'Invalid MASTRA_AZURE_OPENAI configuration. Configure resourceName, apiKey and exact deployment IDs.'
    )
  }
  return config
}

export function getConfiguredGateways(): Record<string, MastraModelGatewayInterface> {
  const azure = getAzureConfig()
  // Next augments ProcessEnv with required NODE_ENV; native Azure buildUrl ignores envVars.
  return azure
    ? { 'azure-openai': new AzureOpenAIGateway(azure) as MastraModelGatewayInterface }
    : {}
}

/** Native configuration preserves the selected ID and request-local credential override. */
export function resolveConfiguredModel(model: string, apiKey?: string): OpenAICompatibleConfig {
  const config = getConfiguredProviders()[model.slice(0, model.indexOf('/'))]
  const envVars = config ? [config.apiKeyEnvVar].flat() : []
  return {
    ...(config?.url
      ? {
          providerId: model.slice(0, model.indexOf('/')),
          modelId: model.slice(model.indexOf('/') + 1),
          url: config.url,
        }
      : { id: model as `${string}/${string}` }),
    apiKey: apiKey || envVars.map((name) => process.env[name]).find(Boolean) || undefined,
  }
}

/** One request-owned public native model; final preparation preserves this exact selection. */
export function createConfiguredLanguageModel(model: string, apiKey?: string) {
  return new ModelRouterLanguageModel(
    resolveConfiguredModel(model, apiKey),
    Object.values(getConfiguredGateways())
  )
}
