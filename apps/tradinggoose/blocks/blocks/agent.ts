import { AgentIcon } from '@/components/icons/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { modelApiKeyField, modelField } from '@/stores/model-registry'
import type { ToolResponse } from '@/tools/types'

interface AgentResponse extends ToolResponse {
  output: {
    content: string
    model: string
    cost?: import('@/lib/mastra/usage').NativeCost
    tokens?: {
      prompt?: number
      completion?: number
      total?: number
    }
  }
}

export const AgentBlock: BlockConfig<AgentResponse> = {
  type: 'agent',
  name: 'Agent',
  description: 'Build an agent',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Send system and user prompts to the selected model, optionally with integration tools, custom tools, skills, and conversation history. Available models come from the configured Mastra registry. Configure Tools and Skills directly. Use Additional Fields to configure memory, response format, output token and model step limits, and model-supported temperature and native Provider Options without switching block modes. Unset tuning controls use the provider’s defaults; unset Max Steps uses the shared default step budget. The final model step supplies the returned content; intermediate commentary and tool results remain in Mastra history. To retain conversation history across runs, save user and assistant messages with Memory Add, then pass the message array from Get Memory into this block’s Memories field. Workflow variables alone do not persist conversation history. Response Format must contain a JSON Schema in its schema property. Returned JSON fields become top-level outputs alongside response metadata; invalid configuration or malformed JSON fails the run. Without a Response Format, the block returns the standard outputs listed below.',
  bestPractices: `
  - Cannot use core blocks like API, Webhook, Function, Workflow, Memory as tools. Only integrations or custom tools. 
  - Check custom tools examples for YAML syntax. Only construct these if there isn't an existing integration for that purpose.
  - Response Format must be a JSON object containing a JSON Schema in its schema field. Returned fields can be accessed at root level by the following blocks: e.g. <agent1.field>. If response format is not present, the agent will return the standard outputs: content, model, tokens, cost. Detailed inputs, turns, and tool results are available in the workflow execution’s Mastra history.
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
    modelField,
    {
      id: 'temperature',
      title: 'Temperature',
      type: 'short-input',
      inputType: 'number',
      layout: 'half',
      placeholder: 'Use the provider default',
      additional: true,
      condition: { field: 'model', operator: 'modelCapability', value: 'temperature' },
    },
    {
      id: 'providerOptions',
      title: 'Provider Options',
      type: 'code',
      language: 'json',
      layout: 'full',
      additional: true,
      placeholder: 'Enter native provider options JSON...',
      description:
        'Mastra provider options JSON, keyed by provider namespace, including reasoning effort, thinking budgets, or toggles. Unset uses the provider default.',
    },
    {
      id: 'maxTokens',
      title: 'Max Output Tokens',
      type: 'short-input',
      inputType: 'number',
      layout: 'half',
      placeholder: 'Use the provider default',
      min: 1,
      integer: true,
      additional: true,
    },
    {
      id: 'maxSteps',
      title: 'Max Steps',
      type: 'short-input',
      inputType: 'number',
      layout: 'half',
      placeholder: 'Use the default step budget',
      description:
        'Maximum model-generation steps, including tool-call rounds and the final answer. The last step disables tools and answers from available results. Unset uses the shared default step budget. An unfinished response still fails.',
      min: 1,
      integer: true,
      additional: true,
    },
    modelApiKeyField,
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
      condition: { field: 'model', operator: 'modelCapability', value: 'structuredOutput' },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `You are an expert programmer specializing in creating JSON schemas according to a specific format.
Generate ONLY the JSON schema based on the user's request.
The output MUST be a single, valid JSON object, starting with { and ending with }.
The JSON object MUST have the following top-level properties: 'name' (string) and 'schema' (object).
The 'schema' object must define the structure and MUST contain 'type': 'object', 'properties': {...}, 'additionalProperties': false, and 'required': [...].
Inside 'properties', use standard JSON Schema properties (type, description, enum, items for arrays, etc.).

Current schema: {context}

Do not include any explanations, markdown formatting, or other text outside the JSON object.

Valid Schema Examples:

Example 1:
{
    "name": "reddit_post",
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
  tools: { access: ['llm_chat'], config: { tool: () => 'llm_chat' } },
  inputs: {
    systemPrompt: { type: 'string', description: 'Initial system instructions' },
    userPrompt: { type: 'string', description: 'User message or context' },
    memories: { type: 'json', description: 'Agent memory data' },
    model: { type: 'string', description: 'AI model to use' },
    apiKey: { type: 'string', description: 'Provider API key' },
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
        },
        required: ['schema'],
      },
    },
    temperature: { type: 'number', description: 'Response randomness level' },
    maxTokens: { type: 'number', description: 'Maximum output tokens' },
    maxSteps: {
      type: 'number',
      description: 'Maximum model-generation steps, including the final answer',
    },
    providerOptions: {
      type: 'json',
      description: 'Native provider options for the selected model',
    },
    tools: { type: 'json', description: 'Available tools configuration' },
    skills: { type: 'json', description: 'Selected skills configuration' },
  },
  outputs: {
    content: { type: 'string', description: 'Generated response content' },
    model: { type: 'string', description: 'Model used for generation' },
    tokens: { type: 'any', description: 'Token usage statistics' },
    cost: {
      type: 'object',
      description: 'Reported or estimated model cost in USD, with availability status',
    },
  },
}
