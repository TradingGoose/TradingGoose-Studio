import { COPILOT_API_URL_DEFAULT } from '@/lib/copilot/agent/constants'
import { MARKET_API_URL_DEFAULT } from '@/lib/market/client/constants'

export type SystemServiceSettingFieldType = 'text' | 'url' | 'number' | 'boolean'

export interface SystemServiceCredentialFieldDefinition {
  key: string
  label: string
  description: string
  required?: boolean
}

export interface SystemServiceSettingFieldDefinition {
  key: string
  label: string
  description: string
  type: SystemServiceSettingFieldType
  defaultValue?: string | number | boolean
  required?: boolean
}

export interface SystemServiceDefinition {
  id: string
  displayName: string
  description: string
  credentialFields: SystemServiceCredentialFieldDefinition[]
  settingFields: SystemServiceSettingFieldDefinition[]
}

export const SYSTEM_SERVICE_DEFINITIONS: SystemServiceDefinition[] = [
  {
    id: 'openai',
    displayName: 'OpenAI',
    description: 'Default embeddings key and hosted OpenAI server keys for platform requests.',
    credentialFields: [
      {
        key: 'defaultApiKey',
        label: 'Default API Key',
        description: 'Used for embeddings and other system-owned OpenAI requests.',
      },
      {
        key: 'rotationKey1',
        label: 'Rotation Key 1',
        description: 'Hosted OpenAI server key slot 1.',
      },
      {
        key: 'rotationKey2',
        label: 'Rotation Key 2',
        description: 'Hosted OpenAI server key slot 2.',
      },
      {
        key: 'rotationKey3',
        label: 'Rotation Key 3',
        description: 'Hosted OpenAI server key slot 3.',
      },
    ],
    settingFields: [],
  },
  {
    id: 'anthropic',
    displayName: 'Anthropic',
    description: 'Hosted Anthropic server keys for platform requests.',
    credentialFields: [
      {
        key: 'rotationKey1',
        label: 'Rotation Key 1',
        description: 'Hosted Anthropic server key slot 1.',
      },
      {
        key: 'rotationKey2',
        label: 'Rotation Key 2',
        description: 'Hosted Anthropic server key slot 2.',
      },
      {
        key: 'rotationKey3',
        label: 'Rotation Key 3',
        description: 'Hosted Anthropic server key slot 3.',
      },
    ],
    settingFields: [],
  },
  {
    id: 'azure_openai',
    displayName: 'Azure OpenAI',
    description: 'Shared Azure OpenAI configuration for embeddings and Azure-hosted model calls.',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        description: 'Used for platform-managed Azure OpenAI requests.',
      },
    ],
    settingFields: [
      {
        key: 'endpoint',
        label: 'Endpoint',
        description: 'Base Azure OpenAI endpoint.',
        type: 'url',
      },
      {
        key: 'apiVersion',
        label: 'API Version',
        description: 'Azure OpenAI API version.',
        type: 'text',
        defaultValue: '2024-07-01-preview',
      },
      {
        key: 'embeddingModel',
        label: 'Embedding Model',
        description: 'Azure deployment name used for knowledge embeddings.',
        type: 'text',
      },
    ],
  },
  {
    id: 'serper',
    displayName: 'Serper',
    description: 'Primary web search provider for generic online search.',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        description: 'Used for web, news, images, and places search.',
      },
    ],
    settingFields: [],
  },
  {
    id: 'exa',
    displayName: 'Exa',
    description: 'Fallback provider for plain web search.',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        description: 'Used for plain web search fallback results.',
      },
    ],
    settingFields: [],
  },
  {
    id: 'resend',
    displayName: 'Resend',
    description: 'Transactional email provider and newsletter audience configuration.',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        description: 'Used for system-owned transactional and newsletter email requests.',
      },
    ],
    settingFields: [
      {
        key: 'audienceId',
        label: 'Audience ID',
        description: 'Newsletter audience id used when subscribing contacts.',
        type: 'text',
      },
    ],
  },
  {
    id: 'azure_communication_email',
    displayName: 'Azure Communication Email',
    description: 'Fallback email transport for Azure Communication Services email delivery.',
    credentialFields: [
      {
        key: 'connectionString',
        label: 'Connection String',
        description: 'Azure Communication Services email connection string.',
      },
    ],
    settingFields: [],
  },
  {
    id: 'mistral',
    displayName: 'Mistral OCR',
    description: 'API key for Mistral OCR document processing.',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        description: 'Used for Mistral OCR document parsing.',
      },
    ],
    settingFields: [],
  },
  {
    id: 'azure_mistral_ocr',
    displayName: 'Azure Mistral OCR',
    description: 'Azure-hosted Mistral OCR configuration for document processing.',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        description: 'Used for Azure-hosted Mistral OCR requests.',
      },
    ],
    settingFields: [
      {
        key: 'endpoint',
        label: 'Endpoint',
        description: 'Azure OCR endpoint URL.',
        type: 'url',
      },
      {
        key: 'modelName',
        label: 'Model Name',
        description: 'Azure OCR model name.',
        type: 'text',
      },
    ],
  },
  {
    id: 'browserbase',
    displayName: 'Browserbase',
    description: 'Browserbase credentials for Stagehand browser automation.',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        description: 'Used for Browserbase-backed browser sessions.',
      },
    ],
    settingFields: [
      {
        key: 'projectId',
        label: 'Project ID',
        description: 'Browserbase project id used for Stagehand sessions.',
        type: 'text',
      },
    ],
  },
  {
    id: 'copilot_api',
    displayName: 'Copilot API',
    description: 'Remote Copilot service endpoint and service authentication.',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        description: 'Used for TradingGoose-Copilot service authentication.',
      },
    ],
    settingFields: [
      {
        key: 'baseUrl',
        label: 'Base URL',
        description: 'Base URL for the remote Copilot service.',
        type: 'url',
        defaultValue: COPILOT_API_URL_DEFAULT,
      },
    ],
  },
  {
    id: 'market_api',
    displayName: 'Market API',
    description: 'Remote market data service endpoint and authentication.',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        description: 'Used for TradingGoose-Market service authentication.',
        required: false,
      },
    ],
    settingFields: [
      {
        key: 'baseUrl',
        label: 'Base URL',
        description: 'Base URL for the remote market service.',
        type: 'url',
        defaultValue: MARKET_API_URL_DEFAULT,
      },
    ],
  },
  {
    id: 'ollama',
    displayName: 'Ollama',
    description: 'Base URL for the local or remote Ollama service.',
    credentialFields: [],
    settingFields: [
      {
        key: 'baseUrl',
        label: 'Base URL',
        description: 'OpenAI-compatible Ollama host URL.',
        type: 'url',
        defaultValue: 'http://localhost:11434',
      },
    ],
  },
  {
    id: 'vllm',
    displayName: 'vLLM',
    description: 'Base URL and optional bearer token for the OpenAI-compatible vLLM service.',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        description: 'Optional bearer token for the vLLM endpoint.',
        required: false,
      },
    ],
    settingFields: [
      {
        key: 'baseUrl',
        label: 'Base URL',
        description: 'Base URL for the OpenAI-compatible vLLM host.',
        type: 'url',
        required: false,
      },
    ],
  },
  {
    id: 'fireworks',
    displayName: 'Fireworks',
    description: 'API key for Fireworks model discovery in the provider picker.',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        description: 'Used to fetch available Fireworks models.',
        required: false,
      },
    ],
    settingFields: [],
  },
  {
    id: 'elevenlabs',
    displayName: 'ElevenLabs',
    description: 'API key for system-owned text-to-speech requests.',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        description: 'Used for ElevenLabs text-to-speech requests.',
      },
    ],
    settingFields: [],
  },
  {
    id: 'github',
    displayName: 'GitHub',
    description: 'GitHub token and landing blog source settings for server-side GitHub requests.',
    credentialFields: [
      {
        key: 'token',
        label: 'Token',
        description: 'Used for GitHub API requests when rate limits matter.',
      },
    ],
    settingFields: [
      {
        key: 'blogRepository',
        label: 'Blog Repository',
        description:
          'Public owner/repo used for landing blog content. Defaults to TradingGoose/TradingGoose-Blog.',
        type: 'text',
        defaultValue: 'TradingGoose/TradingGoose-Blog',
        required: false,
      },
      {
        key: 'blogBranch',
        label: 'Blog Branch',
        description: 'Branch used when loading landing blog content from the GitHub repository.',
        type: 'text',
        defaultValue: 'main',
        required: false,
      },
    ],
  },
  {
    id: 'e2b',
    displayName: 'E2B',
    description: 'Remote code execution service configuration for sandboxed execution.',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        description: 'Used for creating and managing E2B sandboxes.',
      },
    ],
    settingFields: [
      {
        key: 'enabled',
        label: 'Enabled',
        description: 'Enable E2B execution instead of local execution.',
        type: 'boolean',
        defaultValue: false,
      },
      {
        key: 'templateId',
        label: 'Template ID',
        description: 'E2B template id for indicator and function sandboxes.',
        type: 'text',
      },
      {
        key: 'keepWarmTargetMs',
        label: 'Keep Warm Target (ms)',
        description: 'Requested keep-warm duration in milliseconds.',
        type: 'number',
        defaultValue: 300000,
      },
      {
        key: 'keepWarmCapMs',
        label: 'Keep Warm Cap (ms)',
        description: 'Hard cap for E2B keep-warm duration in milliseconds.',
        type: 'number',
        defaultValue: 3600000,
      },
      {
        key: 'maxConcurrentWarmSandboxes',
        label: 'Max Warm Sandboxes',
        description: 'Maximum process-local warm sandboxes before refusing new warm pools.',
        type: 'number',
      },
    ],
  },
  {
    id: 'local_execution',
    displayName: 'Local Execution',
    description: 'Local execution engine concurrency limits.',
    credentialFields: [],
    settingFields: [
      {
        key: 'maxConcurrentExecutions',
        label: 'Max Concurrent Executions',
        description: 'Maximum concurrent local VM executions per process.',
        type: 'number',
        defaultValue: 200,
      },
      {
        key: 'maxActivePerOwner',
        label: 'Max Active Per Owner',
        description: 'Maximum concurrent local VM executions per owner key.',
        type: 'number',
        required: false,
      },
    ],
  },
]

const SYSTEM_SERVICE_DEFINITIONS_BY_ID = new Map(
  SYSTEM_SERVICE_DEFINITIONS.map((definition) => [definition.id, definition])
)

const SYSTEM_SERVICE_CREDENTIAL_KEYS = new Map(
  SYSTEM_SERVICE_DEFINITIONS.map((definition) => [
    definition.id,
    new Set(definition.credentialFields.map((field) => field.key)),
  ])
)

const SYSTEM_SERVICE_SETTING_KEYS = new Map(
  SYSTEM_SERVICE_DEFINITIONS.map((definition) => [
    definition.id,
    new Set(definition.settingFields.map((field) => field.key)),
  ])
)

export function getSystemServiceDefinitions() {
  return SYSTEM_SERVICE_DEFINITIONS
}

export function getSystemServiceDefinition(serviceId: string) {
  return SYSTEM_SERVICE_DEFINITIONS_BY_ID.get(serviceId) ?? null
}

export function isSystemServiceCredentialKey(serviceId: string, key: string) {
  return SYSTEM_SERVICE_CREDENTIAL_KEYS.get(serviceId)?.has(key) ?? false
}

export function isSystemServiceSettingKey(serviceId: string, key: string) {
  return SYSTEM_SERVICE_SETTING_KEYS.get(serviceId)?.has(key) ?? false
}
