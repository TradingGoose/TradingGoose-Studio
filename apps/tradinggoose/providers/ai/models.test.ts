import { afterEach, describe, expect, it } from 'vitest'
import {
  normalizeFireworksCatalogModel,
  resolveFireworksWireModel,
} from '@/providers/ai/fireworks/utils'
import {
  getProviderFromModel,
  getProviderModels,
  PROVIDER_DEFINITIONS,
  updateFireworksModels,
} from '@/providers/ai/models'

const EXPECTED_MODEL_COUNTS = {
  fireworks: 2,
  openrouter: 0,
  vllm: 0,
  openai: 19,
  anthropic: 10,
  'azure-openai': 16,
  'azure-anthropic': 4,
  google: 10,
  vertex: 8,
  deepseek: 4,
  xai: 6,
  cerebras: 3,
  groq: 6,
  mistral: 21,
  ollama: 0,
  bedrock: 19,
}

const ADDED_MODELS = [
  'fireworks/glm-5.2',
  'fireworks/kimi-k3',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5-pro',
  'gpt-5.5',
  'claude-fable-5',
  'claude-sonnet-5',
  'claude-opus-5',
  'claude-opus-4-8',
  'azure/gpt-5-chat',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'vertex/gemini-3.5-flash',
  'vertex/gemini-3.1-flash-lite',
  'deepseek-chat',
  'deepseek-reasoner',
  'grok-4.6',
  'grok-4.5',
  'grok-4.3',
  'cerebras/gemma-4-31b',
  'groq/qwen/qwen3.6-27b',
  'mistral-medium-2604',
]

const REMOVED_MODELS = [
  'gpt-4.1-nano',
  'gpt-5-chat-latest',
  'o4-mini',
  'o3',
  'o3-mini',
  'o1',
  'gpt-4o',
  'claude-opus-4-1',
  'claude-opus-4-0',
  'claude-sonnet-4-0',
  'claude-3-haiku-20240307',
  'azure/gpt-4o',
  'azure/gpt-5-chat-latest',
  'azure-anthropic/claude-opus-4-1',
  'gemini-3.1-flash-lite-preview',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'vertex/gemini-3.1-flash-lite-preview',
  'vertex/gemini-3-pro-preview',
  'vertex/gemini-2.0-flash',
  'vertex/gemini-2.0-flash-lite',
  'grok-4-latest',
  'grok-4-0709',
  'grok-4-1-fast-reasoning',
  'grok-4-1-fast-non-reasoning',
  'grok-4-fast-reasoning',
  'grok-4-fast-non-reasoning',
  'grok-code-fast-1',
  'grok-3-latest',
  'grok-3-fast-latest',
  'cerebras/llama3.1-8b',
  'cerebras/qwen-3-235b-a22b-instruct-2507',
  'groq/qwen/qwen3-32b',
  'groq/meta-llama/llama-4-scout-17b-16e-instruct',
  'groq/moonshotai/kimi-k2-instruct-0905',
  'mistral-large-2411',
  'magistral-small-latest',
  'magistral-small-2509',
  'mistral-small-2506',
  'devstral-small-latest',
  'devstral-small-2507',
  'devstral-medium-2507',
  'bedrock/anthropic.claude-opus-4-1-20250805-v1:0',
  'bedrock/amazon.nova-2-pro-v1:0',
  'bedrock/amazon.nova-premier-v1:0',
  'bedrock/meta.llama3-2-90b-instruct-v1:0',
  'bedrock/meta.llama3-2-11b-instruct-v1:0',
  'bedrock/meta.llama3-2-3b-instruct-v1:0',
  'bedrock/meta.llama3-2-1b-instruct-v1:0',
  'bedrock/meta.llama3-1-405b-instruct-v1:0',
  'bedrock/mistral.mistral-large-2411-v1:0',
  'bedrock/mistral.mistral-large-2407-v1:0',
  'bedrock/amazon.titan-text-premier-v1:0',
  'bedrock/cohere.command-r-plus-v1:0',
  'bedrock/cohere.command-r-v1:0',
]

describe('AI model catalog', () => {
  afterEach(() => updateFireworksModels([]))

  it('contains the active sibling catalog for every existing provider', () => {
    const counts = Object.fromEntries(
      Object.entries(PROVIDER_DEFINITIONS).map(([providerId, provider]) => [
        providerId,
        provider.models.length,
      ])
    )
    const modelIds = Object.values(PROVIDER_DEFINITIONS).flatMap((provider) =>
      provider.models.map((model) => model.id)
    )

    expect(counts).toEqual(EXPECTED_MODEL_COUNTS)
    expect(modelIds).toHaveLength(128)
    expect(new Set(modelIds).size).toBe(modelIds.length)
    expect(modelIds).toEqual(expect.arrayContaining(ADDED_MODELS))
    REMOVED_MODELS.forEach((model) => expect(modelIds).not.toContain(model))
    expect({
      anthropic: PROVIDER_DEFINITIONS.anthropic.defaultModel,
      azureOpenAI: PROVIDER_DEFINITIONS['azure-openai'].defaultModel,
      xai: PROVIDER_DEFINITIONS.xai.defaultModel,
    }).toEqual({
      anthropic: 'claude-sonnet-5',
      azureOpenAI: 'azure/gpt-5.4',
      xai: 'grok-4.6',
    })
  })

  it('keeps static defaults inside their provider catalog and routes every model', () => {
    Object.entries(PROVIDER_DEFINITIONS).forEach(([providerId, provider]) => {
      if (provider.models.length > 0 && provider.defaultModel) {
        expect(provider.models.map((model) => model.id)).toContain(provider.defaultModel)
      }
      provider.models.forEach((model) => expect(getProviderFromModel(model.id)).toBe(providerId))
    })
  })

  it('preserves static Fireworks models when dynamic models refresh', () => {
    updateFireworksModels(['fireworks/kimi-k3', 'fireworks/custom-model'])

    expect(getProviderModels('fireworks')).toEqual([
      'fireworks/glm-5.2',
      'fireworks/kimi-k3',
      'fireworks/custom-model',
    ])
  })

  it('maps Fireworks catalog IDs to their API resource names', () => {
    expect(resolveFireworksWireModel('fireworks/glm-5.2')).toBe('accounts/fireworks/models/glm-5p2')
    expect(resolveFireworksWireModel('fireworks/kimi-k3')).toBe('accounts/fireworks/models/kimi-k3')
    expect(resolveFireworksWireModel('fireworks/custom-model')).toBe(
      'accounts/fireworks/models/custom-model'
    )
    expect(resolveFireworksWireModel('fireworks/accounts/acme/models/custom')).toBe(
      'accounts/acme/models/custom'
    )
    expect(resolveFireworksWireModel('accounts/acme/models/custom')).toBe(
      'accounts/acme/models/custom'
    )
    expect(resolveFireworksWireModel('custom-model')).toBe('custom-model')
    expect(normalizeFireworksCatalogModel('accounts/fireworks/models/glm-5p2')).toBe('glm-5.2')
    expect(normalizeFireworksCatalogModel('accounts/fireworks/models/kimi-k3')).toBe('kimi-k3')
  })
})
