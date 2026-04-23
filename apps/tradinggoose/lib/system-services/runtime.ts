import { resolveSystemServiceConfig, resolveSystemServiceSettingsConfig } from './service'

type ServiceConfigRecord = Record<string, unknown>
type ApiKeyConfig = { apiKey: string | null }
type ApiKeyAndBaseUrlConfig = { apiKey: string | null; baseUrl: string | null }

const ROTATION_KEY_FIELDS = ['rotationKey1', 'rotationKey2', 'rotationKey3'] as const

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asBoolean(value: unknown): boolean {
  return value === true
}

function createServiceResolver<T>(
  serviceId: string,
  mapper: (config: ServiceConfigRecord) => T
) {
  return async (): Promise<T> => mapper(await resolveSystemServiceConfig(serviceId))
}

function createServiceSettingsResolver<T>(
  serviceId: string,
  mapper: (config: ServiceConfigRecord) => T
) {
  return async (): Promise<T> => mapper(await resolveSystemServiceSettingsConfig(serviceId))
}

function readRotationKeys(config: ServiceConfigRecord) {
  return ROTATION_KEY_FIELDS.map((key) => asString(config[key])).filter(
    (value): value is string => value !== null
  )
}

function readApiKeyConfig(config: ServiceConfigRecord): ApiKeyConfig {
  return {
    apiKey: asString(config.apiKey),
  }
}

function readApiKeyAndBaseUrlConfig(config: ServiceConfigRecord): ApiKeyAndBaseUrlConfig {
  return {
    apiKey: asString(config.apiKey),
    baseUrl: asString(config.baseUrl),
  }
}

export const resolveAzureOpenAIServiceConfig = createServiceResolver('azure_openai', (config) => ({
  apiKey: asString(config.apiKey),
  endpoint: asString(config.endpoint),
  apiVersion: asString(config.apiVersion) ?? '2024-07-01-preview',
  embeddingModel: asString(config.embeddingModel),
}))

export const resolveOpenAIServiceConfig = createServiceResolver('openai', (config) => ({
  defaultApiKey: asString(config.defaultApiKey),
  rotationKeys: readRotationKeys(config),
}))

export const resolveAnthropicServiceConfig = createServiceResolver('anthropic', (config) => ({
  rotationKeys: readRotationKeys(config),
}))

export const resolveAzureMistralOcrServiceConfig = createServiceResolver(
  'azure_mistral_ocr',
  (config) => ({
    apiKey: asString(config.apiKey),
    endpoint: asString(config.endpoint),
    modelName: asString(config.modelName),
  })
)

export const resolveMistralServiceConfig = createServiceResolver('mistral', readApiKeyConfig)

export const resolveBrowserbaseServiceConfig = createServiceResolver('browserbase', (config) => ({
  apiKey: asString(config.apiKey),
  projectId: asString(config.projectId),
}))

export const resolveSerperServiceConfig = createServiceResolver('serper', readApiKeyConfig)

export const resolveExaServiceConfig = createServiceResolver('exa', readApiKeyConfig)

export const resolveResendServiceConfig = createServiceResolver('resend', (config) => ({
  apiKey: asString(config.apiKey),
  audienceId: asString(config.audienceId),
}))

export const resolveAzureCommunicationEmailServiceConfig = createServiceResolver(
  'azure_communication_email',
  (config) => ({
    connectionString: asString(config.connectionString),
  })
)

export const resolveCopilotApiServiceConfig = createServiceResolver(
  'copilot_api',
  readApiKeyAndBaseUrlConfig
)

export const resolveMarketApiServiceConfig = createServiceResolver(
  'market_api',
  readApiKeyAndBaseUrlConfig
)

export const resolveOllamaServiceConfig = createServiceResolver('ollama', (config) => ({
  baseUrl: asString(config.baseUrl) ?? 'http://localhost:11434',
}))

export const resolveVllmServiceConfig = createServiceResolver('vllm', readApiKeyAndBaseUrlConfig)

export const resolveFireworksServiceConfig = createServiceResolver(
  'fireworks',
  readApiKeyConfig
)

export const resolveElevenLabsServiceConfig = createServiceResolver(
  'elevenlabs',
  readApiKeyConfig
)

export const resolveGitHubServiceConfig = createServiceResolver('github', (config) => ({
  token: asString(config.token),
  blogRepository: asString(config.blogRepository),
  blogBranch: asString(config.blogBranch) ?? 'main',
}))

export const resolveGitHubBlogSourceConfig = createServiceSettingsResolver('github', (config) => ({
  blogRepository: asString(config.blogRepository),
  blogBranch: asString(config.blogBranch) ?? 'main',
}))

export const resolveE2BServiceConfig = createServiceResolver('e2b', (config) => ({
  enabled: asBoolean(config.enabled),
  apiKey: asString(config.apiKey),
  templateId: asString(config.templateId),
  keepWarmTargetMs: asNumber(config.keepWarmTargetMs),
  keepWarmCapMs: asNumber(config.keepWarmCapMs) ?? 60 * 60 * 1000,
  maxConcurrentWarmSandboxes: asNumber(config.maxConcurrentWarmSandboxes),
}))

export const resolveLocalExecutionServiceConfig = createServiceResolver(
  'local_execution',
  (config) => ({
    maxConcurrentExecutions: asNumber(config.maxConcurrentExecutions) ?? 200,
    maxActivePerOwner: asNumber(config.maxActivePerOwner),
  })
)
