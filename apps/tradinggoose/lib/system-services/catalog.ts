import { GatewayRegistry } from '@mastra/core/llm'
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
    description: 'Default API key for system-owned OpenAI embeddings and Copilot.',
    credentialFields: [
      {
        key: 'defaultApiKey',
        label: 'Default API Key',
        description: 'Used for system-owned OpenAI embeddings and Copilot.',
      },
    ],
    settingFields: [],
  },
  {
    id: 'azure_openai',
    displayName: 'Azure OpenAI',
    description: 'Managed Azure OpenAI connection for native Mastra model requests.',
    credentialFields: [
      { key: 'apiKey', label: 'API Key', description: 'Azure OpenAI resource API key.' },
    ],
    settingFields: [
      {
        key: 'resourceName',
        label: 'Resource Name',
        description: 'Azure OpenAI resource name used by the native Mastra gateway.',
        type: 'text',
      },
      {
        key: 'apiVersion',
        label: 'API Version',
        description: 'Optional Azure API version; leave empty to use the native gateway default.',
        type: 'text',
        required: false,
      },
      {
        key: 'deployments',
        label: 'Deployments',
        description: 'JSON array of exact Azure deployment IDs, for example ["chat-deployment"].',
        type: 'text',
      },
    ],
  },
  {
    id: 'ollama',
    displayName: 'Ollama',
    description: 'Managed OpenAI-compatible Ollama connection for native Mastra model requests.',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        description: 'Optional bearer token for the configured Ollama endpoint.',
        required: false,
      },
    ],
    settingFields: [
      {
        key: 'baseUrl',
        label: 'Base URL',
        description: 'Full OpenAI-compatible API base URL, including /v1.',
        type: 'url',
        defaultValue: 'http://localhost:11434/v1',
      },
      {
        key: 'models',
        label: 'Models',
        description: 'JSON array of exact model IDs, for example ["llama3.2"].',
        type: 'text',
      },
    ],
  },
  {
    id: 'vllm',
    displayName: 'vLLM',
    description: 'Managed OpenAI-compatible vLLM connection for native Mastra model requests.',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        description: 'Optional bearer token for the configured vLLM endpoint.',
        required: false,
      },
    ],
    settingFields: [
      {
        key: 'baseUrl',
        label: 'Base URL',
        description: 'Full OpenAI-compatible API base URL, including /v1.',
        type: 'url',
      },
      {
        key: 'models',
        label: 'Models',
        description: 'JSON array of exact model IDs, for example ["org/exact:model"].',
        type: 'text',
      },
    ],
  },
  {
    id: 'mastra_model_providers',
    displayName: 'Mastra Model Providers',
    description: 'Additional managed OpenAI-compatible providers for native Mastra routing.',
    credentialFields: [
      {
        key: 'apiKeys',
        label: 'Provider API Keys',
        description:
          'Encrypted JSON object mapping custom provider IDs to API keys. Providers with their own system service use that service credential.',
        required: false,
      },
    ],
    settingFields: [
      {
        key: 'providers',
        label: 'Providers',
        description:
          'JSON object keyed by provider ID, with name, url and exact models. Credentials belong in Provider API Keys, never in this setting.',
        type: 'text',
        required: false,
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
    description: 'Transactional email provider and verified-user audience configuration.',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        description: 'Used for system-owned transactional email and audience contact requests.',
      },
    ],
    settingFields: [
      {
        key: 'audienceId',
        label: 'Audience ID',
        description: 'Optional Resend audience id used when adding verified registered users.',
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
    displayName: 'Mistral',
    description: 'API key for Mistral OCR document processing and Copilot.',
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        description: 'Used for Mistral OCR document parsing and Copilot.',
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

export function getSystemServiceDefinitions(): SystemServiceDefinition[] {
  return [
    ...SYSTEM_SERVICE_DEFINITIONS,
    ...Object.entries(GatewayRegistry.getInstance().getProviders())
      .map(([id, { name }]) => ({ id, name }))
      .filter(({ id }) => id !== 'azure-openai' && !SYSTEM_SERVICE_DEFINITIONS_BY_ID.has(id))
      .map(({ id, name }) => ({
        id,
        displayName: name,
        description: `API key for system-owned ${name} Copilot access.`,
        credentialFields: [
          {
            key: 'apiKey',
            label: 'API Key',
            description: `Used for system-owned ${name} Copilot requests.`,
          },
        ],
        settingFields: [],
      })),
  ]
}

export function getSystemServiceDefinition(serviceId: string) {
  return getSystemServiceDefinitions().find(({ id }) => id === serviceId) ?? null
}

export function isSystemServiceCredentialKey(serviceId: string, key: string) {
  return (
    getSystemServiceDefinition(serviceId)?.credentialFields.some((field) => field.key === key) ??
    false
  )
}

export function isSystemServiceSettingKey(serviceId: string, key: string) {
  return (
    getSystemServiceDefinition(serviceId)?.settingFields.some((field) => field.key === key) ?? false
  )
}
