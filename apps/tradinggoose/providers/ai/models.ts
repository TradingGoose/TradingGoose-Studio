/** Canonical AI provider catalog, pricing, and runtime capabilities. */

import type React from 'react'
import {
  AnthropicIcon,
  AzureIcon,
  BedrockIcon,
  CerebrasIcon,
  DeepseekIcon,
  FireworksIcon,
  GeminiIcon,
  GroqIcon,
  MistralIcon,
  OllamaIcon,
  OpenAIIcon,
  OpenRouterIcon,
  VertexIcon,
  VllmIcon,
  xAIIcon,
} from '@/components/icons'
import type { ModelPricing, ProviderId } from '@/providers/ai/types'

export interface ModelCapabilities {
  temperature?: { min: number; max: number }
  toolUsageControl?: boolean
  forcedToolUse?: boolean
  maxOutputTokens?: number
  minOutputTokens?: number
  bedrockInferenceProfiles?: string[]
  reasoningEffort?: { values: string[] }
  verbosity?: { values: string[] }
  thinking?: {
    levels: string[]
    noneMode?: 'between_tools' | 'disabled'
    forcedToolUse?: boolean
  }
  deepResearch?: boolean
}

interface ModelDefinition {
  id: string
  pricing?: ModelPricing
  capabilities?: ModelCapabilities
}

interface ProviderDefinition {
  name: string
  models: ModelDefinition[]
  defaultModel: string
  icon?: React.ComponentType<{ className?: string }>
  capabilities?: ModelCapabilities
}

export const PROVIDER_DEFINITIONS: Record<string, ProviderDefinition> = {
  fireworks: {
    name: 'Fireworks',
    defaultModel: '',
    icon: FireworksIcon,
    capabilities: {
      temperature: { min: 0, max: 2 },
      toolUsageControl: true,
    },
    models: [
      {
        id: 'fireworks/accounts/fireworks/models/glm-5p3',
        pricing: {
          input: 1.4,
          cachedInput: 0.26,
          output: 4.4,
        },
        capabilities: {
          maxOutputTokens: 1040000,
        },
      },
      {
        id: 'fireworks/accounts/fireworks/models/glm-5p2',
        pricing: {
          input: 1.4,
          cachedInput: 0.14,
          output: 4.4,
        },
        capabilities: {
          maxOutputTokens: 131072,
        },
      },
      {
        id: 'fireworks/accounts/fireworks/models/kimi-k3',
        pricing: {
          input: 3.0,
          cachedInput: 0.3,
          output: 15.0,
        },
        capabilities: {
          maxOutputTokens: 1048576,
        },
      },
    ],
  },
  openrouter: {
    name: 'OpenRouter',
    defaultModel: '',
    icon: OpenRouterIcon,
    capabilities: {
      temperature: { min: 0, max: 2 },
      toolUsageControl: true,
    },
    models: [],
  },
  vllm: {
    name: 'vLLM',
    icon: VllmIcon,
    defaultModel: 'vllm/generic',
    capabilities: {
      temperature: { min: 0, max: 2 },
      toolUsageControl: true,
    },
    models: [],
  },
  openai: {
    name: 'OpenAI',
    defaultModel: 'gpt-4.1',
    icon: OpenAIIcon,
    capabilities: {
      toolUsageControl: true,
      minOutputTokens: 16,
    },
    models: [
      {
        id: 'gpt-6-astra',
        pricing: {
          input: 10.0,
          cachedInput: 1.0,
          output: 50.0,
          tiers: [
            {
              aboveInputTokens: 272000,
              input: 20.0,
              cachedInput: 2.0,
              output: 75.0,
            },
          ],
        },
        capabilities: {
          reasoningEffort: {
            values: ['low', 'medium', 'high', 'xhigh', 'max'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'gpt-6.1-sol',
        pricing: {
          input: 2.0,
          cachedInput: 0.1,
          output: 10.0,
          tiers: [
            {
              aboveInputTokens: 272000,
              input: 4.0,
              cachedInput: 0.2,
              output: 15.0,
            },
          ],
        },
        capabilities: {
          reasoningEffort: {
            values: ['low', 'medium', 'high', 'xhigh', 'max'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'gpt-6.1-terra',
        pricing: {
          input: 1.0,
          cachedInput: 0.05,
          output: 5.0,
          tiers: [
            {
              aboveInputTokens: 272000,
              input: 2.0,
              cachedInput: 0.1,
              output: 7.5,
            },
          ],
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'gpt-6-sol',
        pricing: {
          input: 2.0,
          cachedInput: 0.2,
          output: 10.0,
          tiers: [
            {
              aboveInputTokens: 272000,
              input: 4.0,
              cachedInput: 0.4,
              output: 15.0,
            },
          ],
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'gpt-6-luna',
        pricing: {
          input: 0.1,
          cachedInput: 0.01,
          output: 0.5,
          tiers: [
            {
              aboveInputTokens: 272000,
              input: 0.2,
              cachedInput: 0.02,
              output: 0.75,
            },
          ],
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'gpt-4.1',
        pricing: {
          input: 2.0,
          cachedInput: 0.5,
          output: 8.0,
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          maxOutputTokens: 32768,
        },
      },
      {
        id: 'gpt-4.1-mini',
        pricing: {
          input: 0.4,
          cachedInput: 0.1,
          output: 1.6,
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          maxOutputTokens: 32768,
        },
      },
      {
        id: 'gpt-5.6-sol',
        pricing: {
          input: 4.0,
          cachedInput: 0.4,
          output: 20.0,
          tiers: [
            {
              aboveInputTokens: 272000,
              input: 8.0,
              cachedInput: 0.8,
              output: 30.0,
            },
          ],
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'gpt-5.6-terra',
        pricing: {
          input: 2.0,
          cachedInput: 0.2,
          output: 12.0,
          tiers: [
            {
              aboveInputTokens: 272000,
              input: 4.0,
              cachedInput: 0.4,
              output: 18.0,
            },
          ],
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'gpt-5.6-luna',
        pricing: {
          input: 0.2,
          cachedInput: 0.02,
          output: 1.2,
          tiers: [
            {
              aboveInputTokens: 272000,
              input: 0.4,
              cachedInput: 0.04,
              output: 1.8,
            },
          ],
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'gpt-5.5-pro',
        pricing: {
          input: 30.0,
          output: 180.0,
          tiers: [
            {
              aboveInputTokens: 272000,
              input: 60.0,
              output: 270.0,
            },
          ],
        },
        capabilities: {
          reasoningEffort: {
            values: ['medium', 'high', 'xhigh'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'gpt-5.5',
        pricing: {
          input: 5.0,
          cachedInput: 0.5,
          output: 30.0,
          tiers: [
            {
              aboveInputTokens: 272000,
              input: 10.0,
              cachedInput: 1.0,
              output: 45.0,
            },
          ],
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high', 'xhigh'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'gpt-5.4-pro',
        pricing: {
          input: 30.0,
          output: 180.0,
          tiers: [
            {
              aboveInputTokens: 272000,
              input: 60.0,
              output: 270.0,
            },
          ],
        },
        capabilities: {
          reasoningEffort: {
            values: ['medium', 'high', 'xhigh'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'gpt-5.4',
        pricing: {
          input: 2.5,
          cachedInput: 0.25,
          output: 15.0,
          tiers: [
            {
              aboveInputTokens: 272000,
              input: 5.0,
              cachedInput: 0.5,
              output: 22.5,
            },
          ],
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high', 'xhigh'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'gpt-5.4-mini',
        pricing: {
          input: 0.75,
          cachedInput: 0.075,
          output: 4.5,
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high', 'xhigh'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'gpt-5.4-nano',
        pricing: {
          input: 0.2,
          cachedInput: 0.02,
          output: 1.25,
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high', 'xhigh'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'gpt-5.3-codex',
        pricing: {
          input: 1.75,
          cachedInput: 0.175,
          output: 14.0,
        },
        capabilities: {
          reasoningEffort: {
            values: ['low', 'medium', 'high', 'xhigh'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'gpt-5.2-pro',
        pricing: {
          input: 21.0,
          output: 168.0,
        },
        capabilities: {
          reasoningEffort: {
            values: ['medium', 'high', 'xhigh'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'gpt-5.2',
        pricing: {
          input: 1.75,
          cachedInput: 0.175,
          output: 14.0,
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high', 'xhigh'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'gpt-5.1',
        pricing: {
          input: 1.25,
          cachedInput: 0.125,
          output: 10.0,
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'gpt-5-pro',
        pricing: {
          input: 15.0,
          output: 120.0,
        },
        capabilities: {
          reasoningEffort: {
            values: ['high'],
          },
          maxOutputTokens: 272000,
        },
      },
      {
        id: 'gpt-5',
        pricing: {
          input: 1.25,
          cachedInput: 0.125,
          output: 10.0,
        },
        capabilities: {
          reasoningEffort: {
            values: ['minimal', 'low', 'medium', 'high'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'gpt-5-mini',
        pricing: {
          input: 0.25,
          cachedInput: 0.025,
          output: 2.0,
        },
        capabilities: {
          reasoningEffort: {
            values: ['minimal', 'low', 'medium', 'high'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'gpt-5-nano',
        pricing: {
          input: 0.05,
          cachedInput: 0.005,
          output: 0.4,
        },
        capabilities: {
          reasoningEffort: {
            values: ['minimal', 'low', 'medium', 'high'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'chat-latest',
        pricing: {
          input: 5.0,
          cachedInput: 0.5,
          output: 30.0,
        },
        capabilities: {
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'o3-pro',
        pricing: {
          input: 20.0,
          output: 80.0,
        },
        capabilities: {
          maxOutputTokens: 100000,
        },
      },
    ],
  },
  anthropic: {
    name: 'Anthropic',
    defaultModel: 'claude-sonnet-5-5',
    icon: AnthropicIcon,
    capabilities: {
      toolUsageControl: true,
    },
    models: [
      {
        id: 'claude-fable-5-1',
        pricing: {
          input: 10.0,
          cachedInput: 0.25,
          output: 50.0,
        },
        capabilities: {
          forcedToolUse: false,
          maxOutputTokens: 128000,
          thinking: {
            levels: ['low', 'medium', 'high', 'xhigh', 'max'],
          },
        },
      },
      {
        id: 'claude-sonnet-5-5',
        pricing: {
          input: 2.0,
          cachedInput: 0.1,
          output: 10.0,
        },
        capabilities: {
          forcedToolUse: false,
          maxOutputTokens: 128000,
          thinking: {
            levels: ['low', 'medium', 'high', 'xhigh', 'max'],
            noneMode: 'between_tools',
          },
        },
      },
      {
        id: 'claude-opus-5-5',
        pricing: {
          input: 4.0,
          cachedInput: 0.2,
          output: 20.0,
        },
        capabilities: {
          forcedToolUse: false,
          maxOutputTokens: 128000,
          thinking: {
            levels: ['low', 'medium', 'high', 'xhigh', 'max'],
          },
        },
      },
      {
        id: 'claude-haiku-5-5',
        pricing: {
          input: 0.1,
          cachedInput: 0.01,
          output: 0.5,
          tiers: [{ aboveInputTokens: 100000, input: 0.5, cachedInput: 0.05, output: 2.5 }],
        },
        capabilities: {
          maxOutputTokens: 128000,
          thinking: {
            levels: ['low', 'medium', 'high', 'xhigh', 'max'],
            noneMode: 'disabled',
            forcedToolUse: true,
          },
        },
      },
      {
        id: 'claude-haiku-4-5',
        pricing: {
          input: 1.0,
          cachedInput: 0.1,
          output: 5.0,
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 64000,
          thinking: {
            levels: ['low', 'medium', 'high'],
          },
        },
      },
    ],
  },
  'azure-openai': {
    name: 'Azure OpenAI',
    defaultModel: 'azure/gpt-5.4',
    capabilities: {
      toolUsageControl: true,
      minOutputTokens: 16,
    },
    icon: AzureIcon,
    models: [
      {
        id: 'azure/gpt-6.1-sol',
        pricing: {
          input: 2.0,
          cachedInput: 0.1,
          output: 10.0,
          tiers: [
            {
              aboveInputTokens: 272000,
              input: 4.0,
              cachedInput: 0.2,
              output: 15.0,
            },
          ],
        },
        capabilities: {
          reasoningEffort: {
            values: ['low', 'medium', 'high', 'xhigh', 'max'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'azure/gpt-6-sol',
        pricing: {
          input: 2.0,
          cachedInput: 0.2,
          output: 10.0,
          tiers: [
            {
              aboveInputTokens: 272000,
              input: 4.0,
              cachedInput: 0.4,
              output: 15.0,
            },
          ],
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'azure/gpt-6-luna',
        pricing: {
          input: 0.1,
          cachedInput: 0.01,
          output: 0.5,
          tiers: [
            {
              aboveInputTokens: 272000,
              input: 0.2,
              cachedInput: 0.02,
              output: 0.75,
            },
          ],
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'azure/gpt-6-astra',
        pricing: {
          input: 10,
          cachedInput: 1,
          output: 50,
        },
        capabilities: {
          reasoningEffort: {
            values: ['low', 'medium', 'high', 'xhigh', 'max'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'azure/gpt-5.6-sol',
        pricing: {
          input: 4,
          cachedInput: 0.5,
          output: 20,
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'azure/gpt-5.6-terra',
        pricing: {
          input: 2,
          cachedInput: 0.2,
          output: 12,
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'azure/gpt-5.6-luna',
        pricing: {
          input: 0.2,
          cachedInput: 0.02,
          output: 1.2,
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'azure/gpt-5.5',
        pricing: {
          input: 5,
          cachedInput: 0.5,
          output: 30,
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high', 'xhigh'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'azure/gpt-5.4-pro',
        pricing: {
          input: 30,
          output: 180,
          tiers: [
            {
              aboveInputTokens: 272000,
              input: 60,
              output: 270,
            },
          ],
        },
        capabilities: {
          reasoningEffort: {
            values: ['medium', 'high', 'xhigh'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'azure/gpt-5.4',
        pricing: {
          input: 2.5,
          cachedInput: 0.25,
          output: 15.0,
        },
        capabilities: {
          reasoningEffort: {
            values: ['low', 'medium', 'high'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'azure/gpt-5.4-mini',
        pricing: {
          input: 0.75,
          cachedInput: 0.075,
          output: 4.5,
        },
        capabilities: {
          reasoningEffort: {
            values: ['low', 'medium', 'high'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'azure/gpt-5.4-nano',
        pricing: {
          input: 0.2,
          cachedInput: 0.02,
          output: 1.25,
        },
        capabilities: {
          reasoningEffort: {
            values: ['low', 'medium', 'high'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'azure/gpt-5.2',
        pricing: {
          input: 1.75,
          cachedInput: 0.175,
          output: 14.0,
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'azure/gpt-5.1',
        pricing: {
          input: 1.25,
          cachedInput: 0.125,
          output: 10.0,
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'azure/gpt-5.1-codex',
        pricing: {
          input: 1.25,
          cachedInput: 0.125,
          output: 10.0,
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'azure/gpt-5',
        pricing: {
          input: 1.25,
          cachedInput: 0.125,
          output: 10.0,
        },
        capabilities: {
          reasoningEffort: {
            values: ['minimal', 'low', 'medium', 'high'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'azure/gpt-5-mini',
        pricing: {
          input: 0.25,
          cachedInput: 0.025,
          output: 2.0,
        },
        capabilities: {
          reasoningEffort: {
            values: ['minimal', 'low', 'medium', 'high'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'azure/gpt-5-nano',
        pricing: {
          input: 0.05,
          cachedInput: 0.005,
          output: 0.4,
        },
        capabilities: {
          reasoningEffort: {
            values: ['minimal', 'low', 'medium', 'high'],
          },
          verbosity: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'azure/gpt-5-chat',
        pricing: {
          input: 1.25,
          cachedInput: 0.125,
          output: 10.0,
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          maxOutputTokens: 16384,
        },
      },
      {
        id: 'azure/o3',
        pricing: {
          input: 2,
          cachedInput: 0.5,
          output: 8,
        },
        capabilities: {
          reasoningEffort: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 100000,
        },
      },
      {
        id: 'azure/o4-mini',
        pricing: {
          input: 1.1,
          cachedInput: 0.275,
          output: 4.4,
        },
        capabilities: {
          reasoningEffort: {
            values: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 100000,
        },
      },
      {
        id: 'azure/gpt-4.1',
        pricing: {
          input: 2.0,
          cachedInput: 0.5,
          output: 8.0,
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          maxOutputTokens: 32768,
        },
      },
      {
        id: 'azure/gpt-4.1-mini',
        pricing: {
          input: 0.4,
          cachedInput: 0.1,
          output: 1.6,
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          maxOutputTokens: 32768,
        },
      },
      {
        id: 'azure/gpt-4.1-nano',
        pricing: {
          input: 0.1,
          cachedInput: 0.025,
          output: 0.4,
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          maxOutputTokens: 32768,
        },
      },
      {
        id: 'azure/model-router',
        pricing: {
          input: 2.0,
          cachedInput: 0.5,
          output: 8.0,
        },
      },
    ],
  },
  'azure-anthropic': {
    name: 'Azure Anthropic',
    defaultModel: 'azure-anthropic/claude-sonnet-4-5',
    icon: AzureIcon,
    capabilities: {
      toolUsageControl: true,
    },
    models: [
      {
        id: 'azure-anthropic/claude-fable-5-1',
        pricing: {
          input: 10,
          cachedInput: 0.25,
          output: 50,
        },
        capabilities: {
          forcedToolUse: false,
          maxOutputTokens: 128000,
          thinking: {
            levels: ['low', 'medium', 'high', 'xhigh'],
          },
        },
      },
      {
        id: 'azure-anthropic/claude-opus-5-5',
        pricing: {
          input: 4.0,
          cachedInput: 0.2,
          output: 20.0,
        },
        capabilities: {
          forcedToolUse: false,
          maxOutputTokens: 128000,
          thinking: {
            levels: ['low', 'medium', 'high', 'xhigh', 'max'],
          },
        },
      },
      {
        id: 'azure-anthropic/claude-sonnet-5-5',
        pricing: {
          input: 2.0,
          cachedInput: 0.1,
          output: 10.0,
        },
        capabilities: {
          forcedToolUse: false,
          maxOutputTokens: 128000,
          thinking: {
            levels: ['low', 'medium', 'high', 'xhigh', 'max'],
            noneMode: 'between_tools',
          },
        },
      },
      {
        id: 'azure-anthropic/claude-haiku-5-5',
        pricing: {
          input: 0.1,
          cachedInput: 0.01,
          output: 0.5,
          tiers: [{ aboveInputTokens: 100000, input: 0.5, cachedInput: 0.05, output: 2.5 }],
        },
        capabilities: {
          maxOutputTokens: 128000,
          thinking: {
            levels: ['low', 'medium', 'high', 'xhigh', 'max'],
            noneMode: 'disabled',
            forcedToolUse: true,
          },
        },
      },
      {
        id: 'azure-anthropic/claude-opus-5',
        pricing: {
          input: 5,
          cachedInput: 0.5,
          output: 25,
        },
        capabilities: {
          maxOutputTokens: 128000,
          thinking: {
            levels: ['low', 'medium', 'high', 'xhigh', 'max'],
            forcedToolUse: true,
          },
        },
      },
      {
        id: 'azure-anthropic/claude-opus-4-8',
        pricing: {
          input: 5,
          cachedInput: 0.5,
          output: 25,
        },
        capabilities: {
          maxOutputTokens: 128000,
          thinking: {
            levels: ['low', 'medium', 'high', 'xhigh', 'max'],
          },
        },
      },
      {
        id: 'azure-anthropic/claude-opus-4-7',
        pricing: {
          input: 5,
          cachedInput: 0.5,
          output: 25,
        },
        capabilities: {
          maxOutputTokens: 128000,
          thinking: {
            levels: ['low', 'medium', 'high', 'xhigh', 'max'],
          },
        },
      },
      {
        id: 'azure-anthropic/claude-opus-4-6',
        pricing: {
          input: 5.0,
          cachedInput: 0.5,
          output: 25.0,
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 128000,
          thinking: {
            levels: ['low', 'medium', 'high', 'max'],
          },
        },
      },
      {
        id: 'azure-anthropic/claude-opus-4-5',
        pricing: {
          input: 5.0,
          cachedInput: 0.5,
          output: 25.0,
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 64000,
          thinking: {
            levels: ['low', 'medium', 'high'],
          },
        },
      },
      {
        id: 'azure-anthropic/claude-sonnet-5',
        pricing: {
          input: 2,
          cachedInput: 0.2,
          output: 10,
        },
        capabilities: {
          maxOutputTokens: 128000,
          thinking: {
            levels: ['low', 'medium', 'high', 'xhigh', 'max'],
          },
        },
      },
      {
        id: 'azure-anthropic/claude-sonnet-4-6',
        pricing: {
          input: 3,
          cachedInput: 0.3,
          output: 15,
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 128000,
          thinking: {
            levels: ['low', 'medium', 'high', 'max'],
          },
        },
      },
      {
        id: 'azure-anthropic/claude-sonnet-4-5',
        pricing: {
          input: 3.0,
          cachedInput: 0.3,
          output: 15.0,
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 64000,
          thinking: {
            levels: ['low', 'medium', 'high'],
          },
        },
      },
      {
        id: 'azure-anthropic/claude-haiku-4-5',
        pricing: {
          input: 1.0,
          cachedInput: 0.1,
          output: 5.0,
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 64000,
          thinking: {
            levels: ['low', 'medium', 'high'],
          },
        },
      },
    ],
  },
  google: {
    name: 'Google',
    defaultModel: 'gemini-2.5-pro',
    capabilities: {
      toolUsageControl: true,
      maxOutputTokens: 65536,
    },
    icon: GeminiIcon,
    models: [
      {
        id: 'gemini-4-argon',
        pricing: {
          input: 2,
          cachedInput: 0.1,
          output: 10,
        },
        capabilities: {
          thinking: {
            levels: ['low', 'medium', 'high'],
          },
        },
      },
      {
        id: 'gemini-3.8-flash',
        pricing: {
          input: 0.75,
          cachedInput: 0.075,
          output: 3.75,
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          thinking: {
            levels: ['low', 'medium', 'high'],
          },
        },
      },
      {
        id: 'gemini-3.7-flash',
        pricing: {
          input: 0.75,
          cachedInput: 0.075,
          output: 3.75,
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          thinking: {
            levels: ['low', 'medium', 'high'],
          },
        },
      },
      {
        id: 'gemini-3.6-flash',
        pricing: {
          input: 0.75,
          cachedInput: 0.075,
          output: 3.75,
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          thinking: {
            levels: ['minimal', 'low', 'medium', 'high'],
          },
        },
      },
      {
        id: 'gemini-3.5-flash-lite',
        pricing: {
          input: 0.3,
          cachedInput: 0.03,
          output: 2.5,
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          thinking: {
            levels: ['minimal', 'low', 'medium', 'high'],
          },
        },
      },
      {
        id: 'gemini-3.5-flash',
        pricing: {
          input: 1.5,
          cachedInput: 0.15,
          output: 9.0,
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          thinking: {
            levels: ['minimal', 'low', 'medium', 'high'],
          },
        },
      },
      {
        id: 'gemini-3.1-pro-preview',
        pricing: {
          input: 2.0,
          cachedInput: 0.2,
          output: 12.0,
          tiers: [
            {
              aboveInputTokens: 200000,
              input: 4.0,
              cachedInput: 0.4,
              output: 18.0,
            },
          ],
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          thinking: {
            levels: ['low', 'medium', 'high'],
          },
        },
      },
      {
        id: 'gemini-3.1-flash-lite',
        pricing: {
          input: 0.25,
          cachedInput: 0.025,
          output: 1.5,
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          thinking: {
            levels: ['minimal', 'low', 'medium', 'high'],
          },
        },
      },
      {
        id: 'gemini-3-flash-preview',
        pricing: {
          input: 0.5,
          cachedInput: 0.05,
          output: 3.0,
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          thinking: {
            levels: ['minimal', 'low', 'medium', 'high'],
          },
        },
      },
      {
        id: 'gemini-2.5-pro',
        pricing: {
          input: 1.25,
          cachedInput: 0.125,
          output: 10.0,
          tiers: [
            {
              aboveInputTokens: 200000,
              input: 2.5,
              cachedInput: 0.25,
              output: 15.0,
            },
          ],
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          thinking: {
            levels: ['low', 'medium', 'high'],
          },
        },
      },
      {
        id: 'gemini-2.5-flash',
        pricing: {
          input: 0.3,
          cachedInput: 0.03,
          output: 2.5,
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          thinking: {
            levels: ['none', 'low', 'medium', 'high'],
          },
        },
      },
      {
        id: 'gemini-2.5-flash-lite',
        pricing: {
          input: 0.1,
          cachedInput: 0.01,
          output: 0.4,
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          thinking: {
            levels: ['none', 'low', 'medium', 'high'],
          },
        },
      },
      {
        id: 'deep-research-pro-preview-12-2025',
        pricing: {
          input: 2.0,
          cachedInput: 0.2,
          output: 12.0,
        },
        capabilities: {
          deepResearch: true,
        },
      },
    ],
  },
  vertex: {
    name: 'Vertex AI',
    defaultModel: 'vertex/gemini-2.5-pro',
    icon: VertexIcon,
    capabilities: {
      toolUsageControl: true,
    },
    models: [
      {
        id: 'vertex/gemini-3.8-flash',
        pricing: {
          input: 0.75,
          cachedInput: 0.075,
          output: 3.75,
        },
        capabilities: {
          thinking: {
            levels: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 65536,
        },
      },
      {
        id: 'vertex/gemini-3.7-flash',
        pricing: {
          input: 0.75,
          cachedInput: 0.075,
          output: 3.75,
        },
        capabilities: {
          thinking: {
            levels: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 65536,
        },
      },
      {
        id: 'vertex/gemini-3.6-flash',
        pricing: {
          input: 0.75,
          cachedInput: 0.075,
          output: 3.75,
        },
        capabilities: {
          thinking: {
            levels: ['minimal', 'low', 'medium', 'high'],
          },
          maxOutputTokens: 65536,
        },
      },
      {
        id: 'vertex/gemini-3.5-flash-lite',
        pricing: {
          input: 0.3,
          cachedInput: 0.03,
          output: 2.5,
        },
        capabilities: {
          thinking: {
            levels: ['minimal', 'low', 'medium', 'high'],
          },
          maxOutputTokens: 65536,
        },
      },
      {
        id: 'vertex/gemini-3.5-flash',
        pricing: {
          input: 1.5,
          cachedInput: 0.15,
          output: 9.0,
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          thinking: {
            levels: ['minimal', 'low', 'medium', 'high'],
          },
          maxOutputTokens: 65536,
        },
      },
      {
        id: 'vertex/gemini-3.1-pro-preview',
        pricing: {
          input: 2.0,
          cachedInput: 0.2,
          output: 12.0,
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          thinking: {
            levels: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 65536,
        },
      },
      {
        id: 'vertex/gemini-3.1-flash-lite',
        pricing: {
          input: 0.25,
          cachedInput: 0.025,
          output: 1.5,
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          thinking: {
            levels: ['minimal', 'low', 'medium', 'high'],
          },
          maxOutputTokens: 65536,
        },
      },
      {
        id: 'vertex/gemini-3-flash-preview',
        pricing: {
          input: 0.5,
          cachedInput: 0.05,
          output: 3.0,
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          thinking: {
            levels: ['minimal', 'low', 'medium', 'high'],
          },
          maxOutputTokens: 65536,
        },
      },
      {
        id: 'vertex/gemini-2.5-pro',
        pricing: {
          input: 1.25,
          cachedInput: 0.125,
          output: 10.0,
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          thinking: {
            levels: ['low', 'medium', 'high'],
          },
          maxOutputTokens: 65535,
        },
      },
      {
        id: 'vertex/gemini-2.5-flash',
        pricing: {
          input: 0.3,
          cachedInput: 0.03,
          output: 2.5,
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          thinking: {
            levels: ['none', 'low', 'medium', 'high'],
          },
          maxOutputTokens: 65535,
        },
      },
      {
        id: 'vertex/gemini-2.5-flash-lite',
        pricing: {
          input: 0.1,
          cachedInput: 0.01,
          output: 0.4,
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
          thinking: {
            levels: ['none', 'low', 'medium', 'high'],
          },
          maxOutputTokens: 65535,
        },
      },
      {
        id: 'vertex/deep-research-pro-preview-12-2025',
        pricing: {
          input: 2.0,
          cachedInput: 0.2,
          output: 12.0,
        },
        capabilities: {
          deepResearch: true,
          maxOutputTokens: 65536,
        },
      },
    ],
  },
  deepseek: {
    name: 'DeepSeek',
    defaultModel: 'deepseek-flash',
    icon: DeepseekIcon,
    capabilities: {
      toolUsageControl: true,
      reasoningEffort: {
        values: ['low', 'high', 'max'],
      },
      thinking: {
        levels: ['none', 'enabled'],
      },
      maxOutputTokens: 384000,
    },
    models: [
      {
        id: 'deepseek-v4-pro',
        pricing: {
          /** Peak rates; off-peak API requests cost half these rates. */
          input: 1.32,
          cachedInput: 0.044,
          output: 3.96,
        },
      },
      {
        id: 'deepseek-flash',
        pricing: {
          /** Peak rates; off-peak API requests cost half these rates. */
          input: 0.3,
          cachedInput: 0.006,
          output: 1.2,
        },
        capabilities: {
          temperature: { min: 0, max: 2 },
        },
      },
    ],
  },
  xai: {
    name: 'xAI',
    defaultModel: 'grok-4.6',
    icon: xAIIcon,
    capabilities: {
      toolUsageControl: true,
      temperature: {
        min: 0,
        max: 2,
      },
    },
    models: [
      {
        id: 'grok-4.7',
        pricing: {
          input: 2.0,
          cachedInput: 0.5,
          output: 6.0,
          tiers: [
            {
              aboveInputTokens: 199999,
              input: 4.0,
              cachedInput: 1.0,
              output: 12.0,
            },
          ],
        },
        capabilities: {
          reasoningEffort: {
            values: ['low', 'medium', 'high', 'xhigh'],
          },
        },
      },
      {
        id: 'grok-4.6',
        pricing: {
          input: 2.0,
          cachedInput: 0.5,
          output: 6.0,
          tiers: [
            {
              aboveInputTokens: 200000,
              input: 4.0,
              cachedInput: 1.0,
              output: 12.0,
            },
          ],
        },
        capabilities: {
          reasoningEffort: {
            values: ['low', 'medium', 'high', 'xhigh'],
          },
        },
      },
      {
        id: 'grok-4.5',
        pricing: {
          input: 2.0,
          cachedInput: 0.3,
          output: 6.0,
        },
        capabilities: {
          reasoningEffort: {
            values: ['low', 'medium', 'high', 'xhigh'],
          },
        },
      },
      {
        id: 'grok-4.3',
        pricing: {
          input: 1.25,
          cachedInput: 0.2,
          output: 2.5,
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high', 'xhigh'],
          },
        },
      },
      {
        id: 'grok-4.20-0309-reasoning',
        pricing: {
          input: 1.25,
          cachedInput: 0.2,
          output: 2.5,
        },
      },
      {
        id: 'grok-4.20-0309-non-reasoning',
        pricing: {
          input: 1.25,
          cachedInput: 0.2,
          output: 2.5,
        },
      },
      {
        id: 'grok-4.20-multi-agent-0309',
        pricing: {
          input: 1.25,
          cachedInput: 0.2,
          output: 2.5,
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high', 'xhigh'],
          },
        },
      },
    ],
  },
  cerebras: {
    name: 'Cerebras',
    defaultModel: 'cerebras/gpt-oss-120b',
    icon: CerebrasIcon,
    capabilities: {
      toolUsageControl: true,
      temperature: {
        min: 0,
        max: 2,
      },
    },
    models: [
      {
        id: 'cerebras/qwen-3.8-27b',
        pricing: {
          input: 0.99,
          output: 1.49,
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high'],
          },
          maxOutputTokens: 40960,
        },
      },
      {
        id: 'cerebras/gpt-oss-120b',
        pricing: {
          input: 0.35,
          output: 0.75,
        },
        capabilities: {
          maxOutputTokens: 40000,
        },
      },
      {
        id: 'cerebras/zai-glm-4.7',
        pricing: {
          input: 2.25,
          output: 2.75,
        },
        capabilities: {
          maxOutputTokens: 40000,
        },
      },
      {
        id: 'cerebras/gemma-4-31b',
        pricing: {
          input: 0.99,
          output: 1.49,
        },
        capabilities: {
          maxOutputTokens: 40000,
        },
      },
    ],
  },
  groq: {
    name: 'Groq',
    defaultModel: 'groq/llama-3.3-70b-versatile',
    icon: GroqIcon,
    capabilities: {
      temperature: { min: 0, max: 2 },
      toolUsageControl: true,
    },
    models: [
      {
        id: 'groq/openai/gpt-oss-120b',
        pricing: {
          input: 0.15,
          cachedInput: 0.075,
          output: 0.6,
        },
        capabilities: {
          maxOutputTokens: 65536,
          reasoningEffort: {
            values: ['low', 'medium', 'high'],
          },
        },
      },
      {
        id: 'groq/openai/gpt-oss-20b',
        pricing: {
          input: 0.075,
          cachedInput: 0.0375,
          output: 0.3,
        },
        capabilities: {
          maxOutputTokens: 65536,
          reasoningEffort: {
            values: ['low', 'medium', 'high'],
          },
        },
      },
      {
        id: 'groq/openai/gpt-oss-safeguard-20b',
        pricing: {
          input: 0.075,
          cachedInput: 0.0375,
          output: 0.3,
        },
        capabilities: {
          maxOutputTokens: 65536,
          reasoningEffort: {
            values: ['low', 'medium', 'high'],
          },
        },
      },
      {
        id: 'groq/qwen/qwen3.8-27b',
        pricing: {
          input: 0.8,
          output: 4.0,
        },
        capabilities: {
          reasoningEffort: {
            values: ['none', 'low', 'medium', 'high'],
          },
          maxOutputTokens: 16384,
        },
      },
      {
        id: 'groq/qwen/qwen3.6-27b',
        pricing: {
          input: 0.6,
          output: 3.0,
        },
        capabilities: {
          maxOutputTokens: 16384,
          thinking: {
            levels: ['enabled'],
          },
        },
      },
      {
        id: 'groq/llama-3.1-8b-instant',
        pricing: {
          input: 0.05,
          output: 0.08,
        },
        capabilities: {
          maxOutputTokens: 131072,
        },
      },
      {
        id: 'groq/llama-3.3-70b-versatile',
        pricing: {
          input: 0.59,
          output: 0.79,
        },
        capabilities: {
          maxOutputTokens: 32768,
        },
      },
    ],
  },
  mistral: {
    name: 'Mistral AI',
    defaultModel: 'mistral-large-latest',
    icon: MistralIcon,
    capabilities: {
      toolUsageControl: true,
      temperature: {
        min: 0,
        max: 1.5,
      },
    },
    models: [
      {
        id: 'mistral-large-4',
        pricing: {
          input: 0.68,
          cachedInput: 0.07,
          output: 2.09,
        },
      },
      {
        id: 'mistral-medium-3-5',
        pricing: {
          input: 1.5,
          cachedInput: 0.15,
          output: 7.5,
        },
      },
      {
        id: 'mistral-medium-3',
        pricing: {
          input: 1.5,
          cachedInput: 0.15,
          output: 7.5,
        },
      },
      {
        id: 'zai-glm-5-3',
        pricing: {
          input: 1.4,
          cachedInput: 0.14,
          output: 4.4,
        },
        capabilities: {
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'zai-glm-5-2',
        pricing: {
          input: 1.4,
          cachedInput: 0.14,
          output: 4.4,
        },
        capabilities: {
          maxOutputTokens: 128000,
        },
      },
      {
        /** Free preview retires September 30, 2026: https://docs.mistral.ai/resources/changelogs */
        id: 'labs-leanstral-1-5',
        pricing: {
          input: 0,
          cachedInput: 0,
          output: 0,
        },
        capabilities: {
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'mistral-large-latest',
        pricing: {
          input: 0.5,
          output: 1.5,
        },
      },
      {
        id: 'mistral-large-2512',
        pricing: {
          input: 0.5,
          output: 1.5,
        },
      },
      {
        id: 'mistral-small-2603',
        pricing: {
          input: 0.15,
          output: 0.6,
        },
      },
      {
        id: 'devstral-2512',
        pricing: {
          input: 0.4,
          output: 2.0,
        },
      },
      {
        id: 'magistral-medium-latest',
        pricing: {
          input: 2.0,
          output: 5.0,
        },
      },
      {
        id: 'magistral-medium-2509',
        pricing: {
          input: 2.0,
          output: 5.0,
        },
      },
      {
        id: 'mistral-medium-latest',
        pricing: {
          input: 1.5,
          cachedInput: 0.15,
          output: 7.5,
        },
      },
      {
        id: 'mistral-medium-2604',
        pricing: {
          input: 1.5,
          output: 7.5,
        },
      },
      {
        id: 'mistral-medium-2508',
        pricing: {
          input: 0.4,
          output: 2.0,
        },
      },
      {
        id: 'mistral-medium-2505',
        pricing: {
          input: 0.4,
          output: 2.0,
        },
      },
      {
        id: 'mistral-small-latest',
        pricing: {
          input: 0.15,
          output: 0.6,
        },
      },
      {
        id: 'open-mistral-nemo',
        pricing: {
          input: 0.15,
          output: 0.15,
        },
      },
      {
        id: 'codestral-latest',
        pricing: {
          input: 0.3,
          output: 0.9,
        },
      },
      {
        id: 'codestral-2508',
        pricing: {
          input: 0.3,
          output: 0.9,
        },
      },
      {
        id: 'devstral-latest',
        pricing: {
          input: 0.4,
          output: 2.0,
        },
      },
      {
        id: 'ministral-14b-latest',
        pricing: {
          input: 0.2,
          output: 0.2,
        },
      },
      {
        id: 'ministral-14b-2512',
        pricing: {
          input: 0.2,
          output: 0.2,
        },
      },
      {
        id: 'ministral-8b-latest',
        pricing: {
          input: 0.15,
          output: 0.15,
        },
      },
      {
        id: 'ministral-8b-2512',
        pricing: {
          input: 0.15,
          output: 0.15,
        },
      },
      {
        id: 'ministral-3b-latest',
        pricing: {
          input: 0.1,
          output: 0.1,
        },
      },
      {
        id: 'ministral-3b-2512',
        pricing: {
          input: 0.1,
          output: 0.1,
        },
      },
    ],
  },
  ollama: {
    name: 'Ollama',
    defaultModel: '',
    icon: OllamaIcon,
    capabilities: {
      toolUsageControl: false, // Ollama does not support tool_choice parameter
    },
    models: [], // Populated dynamically
  },
  bedrock: {
    name: 'AWS Bedrock',
    defaultModel: 'bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0',
    icon: BedrockIcon,
    capabilities: {
      toolUsageControl: true,
      bedrockInferenceProfiles: ['us-gov', 'us', 'eu', 'apac'],
    },
    models: [
      {
        id: 'bedrock/openai.gpt-6.1-sol',
        pricing: {
          input: 2.2,
          cachedInput: 0.11,
          output: 11,
          tiers: [{ aboveInputTokens: 272000, input: 4.4, cachedInput: 0.22, output: 16.5 }],
        },
        capabilities: {
          forcedToolUse: false,
          maxOutputTokens: 131072,
        },
      },
      {
        id: 'bedrock/anthropic.claude-opus-5',
        pricing: {
          input: 5.5,
          cachedInput: 0.55,
          output: 27.5,
        },
        capabilities: {
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'bedrock/anthropic.claude-sonnet-5',
        pricing: {
          input: 2.2,
          cachedInput: 0.22,
          output: 11,
        },
        capabilities: {
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'bedrock/anthropic.claude-fable-5',
        pricing: {
          input: 11,
          cachedInput: 1.1,
          output: 55,
        },
        capabilities: {
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'bedrock/anthropic.claude-opus-4-8',
        pricing: {
          input: 5.5,
          cachedInput: 0.55,
          output: 27.5,
        },
        capabilities: {
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'bedrock/anthropic.claude-opus-4-7',
        pricing: {
          input: 5.5,
          cachedInput: 0.55,
          output: 27.5,
        },
        capabilities: {
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'bedrock/anthropic.claude-sonnet-4-6',
        pricing: {
          input: 3.3,
          cachedInput: 0.33,
          output: 16.5,
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 64000,
        },
      },
      {
        id: 'bedrock/anthropic.claude-opus-4-6-v1',
        pricing: {
          input: 5.5,
          cachedInput: 0.55,
          output: 27.5,
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'bedrock/anthropic.claude-opus-4-5-20251101-v1:0',
        pricing: {
          input: 5.0,
          cachedInput: 0.5,
          output: 25.0,
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 64000,
        },
      },
      {
        id: 'bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0',
        pricing: {
          input: 3.0,
          cachedInput: 0.3,
          output: 15.0,
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 64000,
        },
      },
      {
        id: 'bedrock/anthropic.claude-haiku-4-5-20251001-v1:0',
        pricing: {
          input: 1.0,
          cachedInput: 0.1,
          output: 5.0,
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 64000,
        },
      },
      {
        id: 'bedrock/openai.gpt-6-astra',
        pricing: {
          input: 11,
          output: 55,
          tiers: [{ aboveInputTokens: 272000, input: 22, output: 82.5 }],
        },
        capabilities: {
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'bedrock/openai.gpt-5.6-sol',
        pricing: {
          input: 4.4,
          output: 22,
          tiers: [{ aboveInputTokens: 272000, input: 8.8, output: 33 }],
        },
      },
      {
        id: 'bedrock/openai.gpt-5.6-terra',
        pricing: {
          input: 2.2,
          output: 13.2,
          tiers: [{ aboveInputTokens: 272000, input: 4.4, output: 19.8 }],
        },
      },
      {
        id: 'bedrock/openai.gpt-5.6-luna',
        pricing: {
          input: 0.22,
          output: 1.32,
          tiers: [{ aboveInputTokens: 272000, input: 0.44, output: 1.98 }],
        },
      },
      {
        id: 'bedrock/openai.gpt-oss-120b-1:0',
        pricing: {
          input: 0.15,
          output: 0.6,
        },
        capabilities: {
          bedrockInferenceProfiles: ['us-gov'],
          maxOutputTokens: 16000,
        },
      },
      {
        id: 'bedrock/openai.gpt-oss-20b-1:0',
        pricing: {
          input: 0.07,
          output: 0.3,
        },
        capabilities: {
          bedrockInferenceProfiles: ['us-gov'],
          maxOutputTokens: 16000,
        },
      },
      {
        id: 'bedrock/minimax.minimax-m2.5',
        pricing: {
          input: 0.3,
          output: 1.2,
        },
        capabilities: {
          bedrockInferenceProfiles: [],
          maxOutputTokens: 8000,
        },
      },
      {
        id: 'bedrock/zai.glm-5',
        pricing: {
          input: 1,
          output: 3.2,
        },
        capabilities: {
          bedrockInferenceProfiles: [],
          maxOutputTokens: 128000,
        },
      },
      {
        id: 'bedrock/moonshotai.kimi-k2.5',
        pricing: {
          input: 0.6,
          output: 3,
        },
        capabilities: {
          bedrockInferenceProfiles: [],
          maxOutputTokens: 16000,
        },
      },
      {
        id: 'bedrock/deepseek.v3.2',
        pricing: {
          input: 0.62,
          output: 1.85,
        },
        capabilities: {
          bedrockInferenceProfiles: [],
          maxOutputTokens: 8000,
        },
      },
      {
        id: 'bedrock/amazon.nova-2-lite-v1:0',
        pricing: {
          input: 0.33,
          cachedInput: 0.0825,
          output: 2.75,
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 64000,
        },
      },
      {
        id: 'bedrock/amazon.nova-pro-v1:0',
        pricing: {
          input: 0.8,
          cachedInput: 0.2,
          output: 3.2,
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 5120,
        },
      },
      {
        id: 'bedrock/amazon.nova-lite-v1:0',
        pricing: {
          input: 0.06,
          cachedInput: 0.015,
          output: 0.24,
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 5120,
        },
      },
      {
        id: 'bedrock/amazon.nova-micro-v1:0',
        pricing: {
          input: 0.035,
          cachedInput: 0.00875,
          output: 0.14,
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 5120,
        },
      },
      {
        id: 'bedrock/meta.llama4-maverick-17b-instruct-v1:0',
        pricing: {
          input: 0.24,
          output: 0.97,
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 8192,
        },
      },
      {
        id: 'bedrock/meta.llama4-scout-17b-instruct-v1:0',
        pricing: {
          input: 0.17,
          output: 0.66,
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 8192,
        },
      },
      {
        id: 'bedrock/meta.llama3-3-70b-instruct-v1:0',
        pricing: {
          input: 0.72,
          output: 0.72,
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 4096,
        },
      },
      {
        id: 'bedrock/meta.llama3-1-70b-instruct-v1:0',
        pricing: {
          input: 0.72,
          output: 0.72,
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 4096,
        },
      },
      {
        id: 'bedrock/meta.llama3-1-8b-instruct-v1:0',
        pricing: {
          input: 0.22,
          output: 0.22,
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 4096,
        },
      },
      {
        id: 'bedrock/mistral.mistral-large-3-675b-instruct',
        pricing: {
          input: 0.5,
          output: 1.5,
        },
        capabilities: {
          bedrockInferenceProfiles: [],
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 32768,
        },
      },
      {
        id: 'bedrock/mistral.pixtral-large-2502-v1:0',
        pricing: {
          input: 2.0,
          output: 6.0,
        },
        capabilities: {
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 16384,
        },
      },
      {
        id: 'bedrock/mistral.magistral-small-2509',
        pricing: {
          input: 0.5,
          output: 1.5,
        },
        capabilities: {
          bedrockInferenceProfiles: [],
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 40000,
        },
      },
      {
        id: 'bedrock/mistral.ministral-3-14b-instruct',
        pricing: {
          input: 0.2,
          output: 0.2,
        },
        capabilities: {
          bedrockInferenceProfiles: [],
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 8192,
        },
      },
      {
        id: 'bedrock/mistral.ministral-3-8b-instruct',
        pricing: {
          input: 0.15,
          output: 0.15,
        },
        capabilities: {
          bedrockInferenceProfiles: [],
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 8192,
        },
      },
      {
        id: 'bedrock/mistral.ministral-3-3b-instruct',
        pricing: {
          input: 0.1,
          output: 0.1,
        },
        capabilities: {
          bedrockInferenceProfiles: [],
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 8192,
        },
      },
      {
        id: 'bedrock/mistral.mixtral-8x7b-instruct-v0:1',
        pricing: {
          input: 0.45,
          output: 0.7,
        },
        capabilities: {
          bedrockInferenceProfiles: [],
          temperature: { min: 0, max: 1 },
          maxOutputTokens: 4096,
        },
      },
    ],
  },
}

export const DYNAMIC_MODEL_PROVIDERS = ['ollama', 'vllm', 'openrouter', 'fireworks'] as const

function getProviderDefinition(providerId: string): ProviderDefinition {
  const provider = PROVIDER_DEFINITIONS[providerId]
  if (!provider) throw new Error(`Unknown AI provider: ${providerId}`)
  return provider
}

function getModelEntry(modelId: string):
  | {
      providerId: ProviderId
      provider: ProviderDefinition
      model?: ModelDefinition
    }
  | undefined {
  for (const [providerId, provider] of Object.entries(PROVIDER_DEFINITIONS)) {
    const model = provider.models.find((model) => model.id === modelId)
    if (model) return { providerId: providerId as ProviderId, provider, model }
  }
  const providerId = DYNAMIC_MODEL_PROVIDERS.find(
    (id) => modelId.startsWith(`${id}/`) && modelId.length > id.length + 1
  )
  if (providerId) return { providerId, provider: PROVIDER_DEFINITIONS[providerId] }
}

export function getProviderModels(providerId: string): string[] {
  return getProviderDefinition(providerId).models.map((model) => model.id)
}

export function getAllModelProviders(): Record<string, ProviderId> {
  return Object.fromEntries(
    Object.entries(PROVIDER_DEFINITIONS).flatMap(([providerId, provider]) =>
      provider.models.map((model) => [model.id, providerId as ProviderId])
    )
  )
}

export function getBaseModelProviders(): Record<string, ProviderId> {
  return Object.fromEntries(
    Object.entries(getAllModelProviders()).filter(
      ([, providerId]) => !(DYNAMIC_MODEL_PROVIDERS as readonly string[]).includes(providerId)
    )
  )
}

export function getProviderFromModel(model: string): ProviderId {
  const entry = getModelEntry(model)
  if (!entry) throw new Error(`Unknown AI model: ${model}`)
  return entry.providerId
}

export function getProviderIcon(model: string): React.ComponentType<{ className?: string }> | null {
  return getModelEntry(model)?.provider.icon ?? null
}

export function getProviderDefaultModel(providerId: string): string {
  return getProviderDefinition(providerId).defaultModel
}

export function getModelPricing(modelId: string): ModelPricing | null {
  if (modelId.startsWith('text-embedding-')) return EMBEDDING_MODEL_PRICING[modelId] ?? null
  return getModelEntry(modelId)?.model?.pricing ?? null
}

export function getModelCapabilities(modelId: string): ModelCapabilities | null {
  const entry = getModelEntry(modelId)
  return entry ? { ...entry.provider.capabilities, ...entry.model?.capabilities } : null
}

export function supportsTemperature(modelId: string): boolean {
  return !!getModelCapabilities(modelId)?.temperature
}

export function getMaxTemperature(modelId: string): number | undefined {
  return getModelCapabilities(modelId)?.temperature?.max
}

export function updateOllamaModels(models: string[]): void {
  PROVIDER_DEFINITIONS.ollama.models = models.map((id) => ({
    id,
    pricing: { input: 0, output: 0 },
  }))
}

export function updateVLLMModels(models: string[]): void {
  PROVIDER_DEFINITIONS.vllm.models = models.map((id) => ({
    id,
    pricing: { input: 0, output: 0 },
  }))
}

const STATIC_FIREWORKS_MODELS = PROVIDER_DEFINITIONS.fireworks.models

export function updateFireworksModels(models: string[]): void {
  const staticIds = new Set(STATIC_FIREWORKS_MODELS.map((model) => model.id))
  PROVIDER_DEFINITIONS.fireworks.models = [
    ...STATIC_FIREWORKS_MODELS,
    ...models.filter((id) => !staticIds.has(id)).map((id) => ({ id })),
  ]
}

export function updateOpenRouterModels(
  models: string[],
  pricing?: Record<string, ModelPricing>
): void {
  PROVIDER_DEFINITIONS.openrouter.models = models.map((id) => ({ id, pricing: pricing?.[id] }))
}

const EMBEDDING_MODEL_PRICING: Record<string, ModelPricing> = {
  'text-embedding-3-small': {
    input: 0.02, // $0.02 per 1M tokens
    output: 0.0,
  },
  'text-embedding-3-large': {
    input: 0.13, // $0.13 per 1M tokens
    output: 0.0,
  },
  'text-embedding-ada-002': {
    input: 0.1, // $0.1 per 1M tokens
    output: 0.0,
  },
}

export function getReasoningEffortValuesForModel(modelId: string): string[] | null {
  return getModelCapabilities(modelId)?.reasoningEffort?.values ?? null
}

export function getVerbosityValuesForModel(modelId: string): string[] | null {
  return getModelCapabilities(modelId)?.verbosity?.values ?? null
}

export function getThinkingCapability(
  modelId: string
): NonNullable<ModelCapabilities['thinking']> | null {
  return getModelCapabilities(modelId)?.thinking ?? null
}

export function getThinkingLevelsForModel(modelId: string): string[] | null {
  const capability = getThinkingCapability(modelId)
  return capability?.noneMode ? ['none', ...capability.levels] : (capability?.levels ?? null)
}

export const MODEL_CONTROL_GETTERS = {
  reasoningEffort: getReasoningEffortValuesForModel,
  verbosity: getVerbosityValuesForModel,
  thinkingLevel: getThinkingLevelsForModel,
}

export type ModelControl = keyof typeof MODEL_CONTROL_GETTERS

export function getMinOutputTokensForModel(modelId: string): number {
  return getModelCapabilities(modelId)?.minOutputTokens ?? 1
}

export function getMaxOutputTokensForModel(modelId: string): number {
  const maxTokens = getModelCapabilities(modelId)?.maxOutputTokens
  if (maxTokens === undefined)
    throw new Error(`No output token limit defined for model: ${modelId}`)
  return maxTokens
}
