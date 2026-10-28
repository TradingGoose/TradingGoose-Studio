import { AgentIcon } from '@/components/icons/icons'
import { isHosted } from '@/lib/environment'
import type {
  BlockConfig,
  SubBlockConfig,
  SubBlockOption,
  SubBlockOptionGroup,
} from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import {
  getAllModelProviders,
  getMaxTemperature,
  getProviderDefaultModel,
  getProviderFromModel,
  getProviderModels,
  MODEL_CONTROL_GETTERS,
  type ModelControl,
  PROVIDER_DEFINITIONS,
} from '@/providers/ai/models'
import { useProvidersStore } from '@/stores/providers/store'
import type { ToolResponse } from '@/tools/types'

const DEFAULT_MODEL = getProviderDefaultModel('openai')

const modelControl = (id: ModelControl, title: string): SubBlockConfig => ({
  id,
  title,
  description: 'Available levels depend on the model. Unset or Auto uses the provider default.',
  type: 'dropdown',
  layout: 'half',
  placeholder: 'Auto (provider default)',
  additional: true,
  autoSelectFirstOption: false,
  dependsOn: ['model'],
  condition: { field: 'model', operator: 'modelCapability', value: id },
  options: (params) => [
    { label: 'Auto (provider default)', id: 'auto' },
    ...(MODEL_CONTROL_GETTERS[id](params?.model ?? '') ?? []).map((value) => ({
      label: value,
      id: value,
    })),
  ],
})

const getAvailableModels = () => {
  const providersState = useProvidersStore.getState()
  const baseModels = providersState.providers.base.models
  const ollamaModels = providersState.providers.ollama.models
  const openrouterModels = providersState.providers.openrouter.models
  return Array.from(new Set([...baseModels, ...ollamaModels, ...openrouterModels]))
}

const getAvailableModelOptions = (): SubBlockOption[] => {
  return getAvailableModels().map((model) => {
    const providerId = getProviderFromModel(model)
    const provider = PROVIDER_DEFINITIONS[providerId]

    return {
      label: model,
      id: model,
      group: providerId,
      searchLabel: `${model} ${provider.name}`,
      ...(provider.icon && { icon: provider.icon }),
    }
  })
}

const getAvailableModelGroups = (): SubBlockOptionGroup[] => {
  const seenProviderIds = new Set<string>()
  const groups: SubBlockOptionGroup[] = []

  for (const model of getAvailableModels()) {
    const providerId = getProviderFromModel(model)
    if (seenProviderIds.has(providerId)) continue

    const provider = PROVIDER_DEFINITIONS[providerId]
    seenProviderIds.add(providerId)
    groups.push({
      id: providerId,
      label: provider.name,
      ...(provider.icon && { icon: provider.icon }),
    })
  }

  return groups
}

interface AgentResponse extends ToolResponse {
  output: {
    content: string
    model: string
    tokens?: {
      prompt?: number
      completion?: number
      total?: number
    }
    toolResults?: any[]
    toolCalls?: {
      list: Array<{
        name: string
        arguments: Record<string, any>
      }>
      count: number
    }
  }
}

export const AgentBlock: BlockConfig<AgentResponse> = {
  type: 'agent',
  name: 'Agent',
  description: 'Build an agent',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Send system and user prompts to the selected model, optionally with integration tools, custom tools, skills, and conversation history. Available models come from the deployment catalog and configured provider connections. Configure Tools and Skills directly. Use Additional Fields to configure memory, response format, output token limits, and model-supported temperature, reasoning effort, verbosity, or thinking levels without switching block modes. Unset tuning controls or Auto use the provider’s defaults. To retain conversation history across runs, save user and assistant messages with Memory Add, then pass the message array from Get Memory into this block’s Memories field. Workflow variables alone do not persist conversation history. Response Format must contain a JSON Schema in its schema property. Returned JSON fields become top-level outputs alongside response metadata; invalid configuration or malformed JSON fails the run. Without a Response Format, the block returns the standard outputs listed below.',
  bestPractices: `
  - Cannot use core blocks like API, Webhook, Function, Workflow, Memory as tools. Only integrations or custom tools. 
  - Check custom tools examples for YAML syntax. Only construct these if there isn't an existing integration for that purpose.
  - Response Format must be a JSON object containing a JSON Schema in its schema field. Returned fields can be accessed at root level by the following blocks: e.g. <agent1.field>. If response format is not present, the agent will return the standard outputs: content, model, tokens, toolCalls.
  `,
  docsLink: 'https://docs.tradinggoose.ai/blocks/agent',
  category: 'blocks',
  bgColor: '#2873f6',
  icon: AgentIcon,
  subBlocks: [
    {
      id: 'systemPrompt',
      title: 'System Prompt',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter system prompt...',
      rows: 5,
      wandConfig: {
        enabled: true,
        maintainHistory: true, // Enable conversation history for iterative improvements
        prompt: `You are an expert system prompt engineer. Create a system prompt based on the user's request.

### CONTEXT
{context}

### INSTRUCTIONS
Write a system prompt following best practices. Match the complexity level the user requests.

### CORE PRINCIPLES
1. **Role Definition**: Start with "You are..." to establish identity and function
2. **Direct Commands**: Use action verbs like "Analyze", "Generate", "Classify"
3. **Be Specific**: Include output format, quality standards, behaviors, target audience
4. **Clear Boundaries**: Define focus areas and priorities
5. **Examples**: Add concrete examples when helpful

### STRUCTURE
- **Primary Role**: Clear identity statement
- **Core Capabilities**: Main functions and expertise
- **Behavioral Guidelines**: Task approach and interaction style
- **Output Requirements**: Format, style, quality expectations
- **Tool Integration**: Specific tool usage instructions

### TOOL INTEGRATION
When users mention tools, include explicit instructions:
- **Web Search**: "Use Exa to gather current information from authoritative sources"
- **Communication**: "Send messages via Slack/Discord/Teams with appropriate tone"
- **Email**: "Compose emails through Gmail with professional formatting"
- **Data**: "Query databases, analyze spreadsheets, call APIs as needed"

### EXAMPLES

**Simple**: "Create a customer service agent"
→ You are a professional customer service representative. Respond to inquiries about orders, returns, and products with empathy and efficiency. Maintain a helpful tone while providing accurate information and clear next steps.

**Detailed**: "Build a research assistant for market analysis"
→ You are an expert market research analyst specializing in competitive intelligence and industry trends. Conduct thorough market analysis using systematic methodologies.

Use Exa to gather information from industry sources, financial reports, and market research firms. Cross-reference findings across multiple credible sources.

For each request, follow this structure:
1. Define research scope and key questions
2. Identify market segments and competitors
3. Gather quantitative data (market size, growth rates)
4. Collect qualitative insights (trends, consumer behavior)
5. Synthesize findings into actionable recommendations

Present findings in executive-ready formats with source citations, highlight key insights, and provide specific recommendations with rationale.

### FINAL INSTRUCTION
Create a system prompt appropriately detailed for the request, using clear language and relevant tool instructions.`,
        placeholder: 'Describe the AI agent you want to create...',
        generationType: 'system-prompt',
      },
    },
    {
      id: 'userPrompt',
      title: 'User Prompt',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter context or user message...',
      rows: 3,
    },
    {
      id: 'memories',
      title: 'Memories',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Connect memory block output...',
      additional: true,
    },
    {
      id: 'model',
      title: 'Model',
      type: 'combobox',
      layout: 'half',
      placeholder: 'Type or select a model...',
      required: true,
      dropdownMode: 'sidebar',
      optionGroups: getAvailableModelGroups,
      value: () => {
        const allModels = getAvailableModels()
        if (allModels.includes(DEFAULT_MODEL)) return DEFAULT_MODEL
        return allModels[0]
      },
      options: getAvailableModelOptions,
    },
    ...[1, 1.5, 2].map(
      (max): SubBlockConfig => ({
        id: 'temperature',
        title: 'Temperature',
        type: 'slider',
        layout: 'half',
        placeholder: 'Use the provider default',
        clearable: true,
        min: 0,
        max,
        step: 0.1,
        additional: true,
        condition: () => ({
          field: 'model',
          value: Object.keys(getAllModelProviders()).filter(
            (model) => getMaxTemperature(model) === max
          ),
        }),
      })
    ),
    modelControl('reasoningEffort', 'Reasoning Effort'),
    modelControl('verbosity', 'Verbosity'),
    modelControl('thinkingLevel', 'Thinking Level'),
    {
      id: 'maxTokens',
      title: 'Max Output Tokens',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Use the provider default',
      inputType: 'number',
      min: 1,
      integer: true,
      additional: true,
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your API key',
      password: true,
      connectionDroppable: false,
      required: true,
      condition: isHosted
        ? undefined
        : () => ({
            field: 'model',
            value: useProvidersStore.getState().providers.ollama.models,
            not: true, // Show for all models EXCEPT Ollama models
          }),
    },
    {
      id: 'azureEndpoint',
      title: 'Azure OpenAI Endpoint',
      type: 'short-input',
      layout: 'full',
      password: true,
      placeholder: 'https://your-resource.openai.azure.com',
      connectionDroppable: false,
      condition: {
        field: 'model',
        value: getProviderModels('azure-openai'),
      },
    },
    {
      id: 'azureApiVersion',
      title: 'Azure API Version',
      type: 'short-input',
      layout: 'full',
      placeholder: '2024-07-01-preview',
      connectionDroppable: false,
      condition: {
        field: 'model',
        value: getProviderModels('azure-openai'),
      },
    },
    {
      id: 'tools',
      title: 'Tools',
      type: 'tool-input',
      layout: 'full',
      defaultValue: [],
    },
    {
      id: 'skills',
      title: 'Skills',
      type: 'skill-input',
      layout: 'full',
      defaultValue: [],
    },
    {
      id: 'responseFormat',
      title: 'Response Format',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter response format JSON...',
      description: 'JSON object containing a JSON Schema in its schema field.',
      language: 'json',
      additional: true,
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert programmer specializing in creating JSON schemas according to a specific format.
Generate ONLY the JSON schema based on the user's request.
The output MUST be a single, valid JSON object, starting with { and ending with }.
The JSON object MUST have the following top-level properties: 'name' (string), 'description' (string), 'strict' (boolean, usually true), and 'schema' (object).
The 'schema' object must define the structure and MUST contain 'type': 'object', 'properties': {...}, 'additionalProperties': false, and 'required': [...].
Inside 'properties', use standard JSON Schema properties (type, description, enum, items for arrays, etc.).

Current schema: {context}

Do not include any explanations, markdown formatting, or other text outside the JSON object.

Valid Schema Examples:

Example 1:
{
    "name": "reddit_post",
    "description": "Fetches the reddit posts in the given subreddit",
    "strict": true,
    "schema": {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "The title of the post"
            },
            "content": {
                "type": "string",
                "description": "The content of the post"
            }
        },
        "additionalProperties": false,
        "required": [ "title", "content" ]
    }
}

Example 2:
{
    "name": "get_weather",
    "description": "Fetches the current weather for a specific location.",
    "strict": true,
    "schema": {
        "type": "object",
        "properties": {
            "location": {
                "type": "string",
                "description": "The city and state, e.g., San Francisco, CA"
            },
            "unit": {
                "type": "string",
                "description": "Temperature unit",
                "enum": ["celsius", "fahrenheit"]
            }
        },
        "additionalProperties": false,
        "required": ["location", "unit"]
    }
}

Example 3 (Array Input):
{
    "name": "process_items",
    "description": "Processes a list of items with specific IDs.",
    "strict": true,
    "schema": {
        "type": "object",
        "properties": {
            "item_ids": {
                "type": "array",
                "description": "A list of unique item identifiers to process.",
                "items": {
                    "type": "string",
                    "description": "An item ID"
                }
            },
            "processing_mode": {
                "type": "string",
                "description": "The mode for processing",
                "enum": ["fast", "thorough"]
            }
        },
        "additionalProperties": false,
        "required": ["item_ids", "processing_mode"]
    }
}
`,
        placeholder: 'Describe the JSON schema structure you need...',
        generationType: 'json-schema',
      },
    },
  ],
  tools: {
    access: [
      'openai_chat',
      'anthropic_chat',
      'google_chat',
      'xai_chat',
      'deepseek_chat',
      'deepseek_reasoner',
    ],
    config: {
      tool: (params: Record<string, any>) => {
        const model = params.model
        if (!model) {
          throw new Error('No model selected')
        }
        return getProviderFromModel(model)
      },
    },
  },
  inputs: {
    systemPrompt: { type: 'string', description: 'Initial system instructions' },
    userPrompt: { type: 'string', description: 'User message or context' },
    memories: { type: 'json', description: 'Agent memory data' },
    model: { type: 'string', description: 'AI model to use' },
    apiKey: { type: 'string', description: 'Provider API key' },
    azureEndpoint: { type: 'string', description: 'Azure OpenAI endpoint URL' },
    azureApiVersion: { type: 'string', description: 'Azure API version' },
    responseFormat: {
      type: 'json',
      description: 'JSON object containing a JSON Schema in its schema field',
      schema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'A name for your schema (optional)',
          },
          schema: {
            type: 'object',
            description: 'The JSON Schema definition',
            properties: {
              type: {
                type: 'string',
                enum: ['object'],
                description: 'Must be "object" for a valid JSON Schema',
              },
              properties: {
                type: 'object',
                description: 'Object containing property definitions',
              },
              required: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of required property names',
              },
              additionalProperties: {
                type: 'boolean',
                description: 'Whether additional properties are allowed',
              },
            },
            required: ['type', 'properties'],
          },
          strict: {
            type: 'boolean',
            description: 'Whether to enforce strict schema validation',
            default: true,
          },
        },
        required: ['schema'],
      },
    },
    temperature: { type: 'number', description: 'Response randomness level' },
    maxTokens: { type: 'number', description: 'Maximum output tokens' },
    reasoningEffort: { type: 'string', description: 'Model-supported reasoning effort, or auto' },
    verbosity: { type: 'string', description: 'Model-supported response verbosity, or auto' },
    thinkingLevel: { type: 'string', description: 'Model-supported thinking level, or auto' },
    tools: { type: 'json', description: 'Available tools configuration' },
    skills: { type: 'json', description: 'Selected skills configuration' },
  },
  outputs: {
    content: { type: 'string', description: 'Generated response content' },
    model: { type: 'string', description: 'Model used for generation' },
    tokens: { type: 'any', description: 'Token usage statistics' },
    toolCalls: { type: 'any', description: 'Tool calls made' },
    toolResults: { type: 'any', description: 'Tool results returned by the provider' },
  },
}
