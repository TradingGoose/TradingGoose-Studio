import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as environmentModule from '@/lib/environment'
import {
  getBaseModelProviders,
  getHostedModels,
  getMaxTemperature,
  getProviderFromModel,
  getProviderModels,
  supportsTemperature,
  supportsToolUsageControl,
  updateOllamaModels,
} from '@/providers/ai/models'
import {
  calculateCost,
  extractAndParseJSON,
  formatCost,
  getAllModelProviders,
  getCustomTools,
  getProvider,
  MODELS_TEMP_RANGE_0_1,
  MODELS_TEMP_RANGE_0_2,
  MODELS_WITH_REASONING_EFFORT,
  MODELS_WITH_TEMPERATURE_SUPPORT,
  MODELS_WITH_VERBOSITY,
  PROVIDERS_WITH_TOOL_USAGE_CONTROL,
  prepareToolExecution,
  prepareToolsWithUsageControl,
  transformCustomTool,
} from '@/providers/ai/utils'
import { getApiKey } from '@/providers/ai/utils-server'

const isHostedSpy = vi.spyOn(environmentModule, 'isHosted', 'get')
const { mockGetRotatingApiKey } = vi.hoisted(() => ({ mockGetRotatingApiKey: vi.fn() }))
vi.mock('@/lib/utils-server', () => ({ getRotatingApiKey: mockGetRotatingApiKey }))

describe('getApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isHostedSpy.mockReturnValue(false)
    mockGetRotatingApiKey.mockResolvedValue('rotating-server-key')
  })

  it.each(['openai', 'anthropic'])('uses the self-hosted %s user key', async (provider) => {
    await expect(getApiKey(provider, 'model', 'user-key')).resolves.toBe('user-key')
    await expect(getApiKey(provider, 'model')).rejects.toThrow('API key is required')
  })

  it.each(['openai', 'anthropic'])('uses the hosted %s platform key', async (provider) => {
    isHostedSpy.mockReturnValue(true)
    await expect(getApiKey(provider, 'model')).resolves.toBe('rotating-server-key')
    expect(mockGetRotatingApiKey).toHaveBeenCalledWith(provider)
  })

  it.each(['openai', 'anthropic'])(
    'uses a supplied hosted %s key without loading platform keys',
    async (provider) => {
      isHostedSpy.mockReturnValue(true)
      mockGetRotatingApiKey.mockRejectedValue(new Error('Rotation failed'))
      await expect(getApiKey(provider, 'model', 'user-key')).resolves.toBe('user-key')
      expect(mockGetRotatingApiKey).not.toHaveBeenCalled()
    }
  )

  it.each(['openai', 'anthropic'])(
    'propagates hosted %s rotation failures when no user key is supplied',
    async (provider) => {
      isHostedSpy.mockReturnValue(true)
      mockGetRotatingApiKey.mockRejectedValue(new Error('Rotation failed'))
      await expect(getApiKey(provider, 'model')).rejects.toThrow('Rotation failed')
    }
  )

  it('requires user keys for other hosted providers', async () => {
    isHostedSpy.mockReturnValue(true)
    await expect(getApiKey('other-provider', 'model', 'user-key')).resolves.toBe('user-key')
    await expect(getApiKey('other-provider', 'model')).rejects.toThrow('API key is required')
  })

  it('does not require an Ollama API key', async () => {
    await expect(getApiKey('ollama', 'ollama/llama3.2')).resolves.toBe('empty')
  })
})

describe('Model Capabilities', () => {
  describe('supportsTemperature', () => {
    it.concurrent('should return true for models that support temperature', () => {
      const supportedModels = [
        'gpt-4.1',
        'gpt-4.1-mini',
        'gemini-2.5-flash',
        'claude-sonnet-4-6',
        'claude-haiku-4-5',
        'grok-4.6',
        'grok-4.5',
        'deepseek-v4-flash',
        'cerebras/gpt-oss-120b',
        'groq/llama-3.3-70b-versatile',
      ]

      for (const model of supportedModels) {
        expect(supportsTemperature(model)).toBe(true)
      }
    })

    it.concurrent('should return false for models that do not support temperature', () => {
      const unsupportedModels = [
        'unsupported-model',
        'deepseek-v4-pro',
        'o3-pro',
        'azure/o3',
        'azure/o4-mini',
        'azure/model-router',
        // Reasoning GPT-5 models don't support temperature
        'gpt-5',
        'gpt-5-mini',
        'gpt-5-nano',
        'azure/gpt-5',
        'azure/gpt-5-mini',
        'azure/gpt-5-nano',
      ]

      for (const model of unsupportedModels) {
        expect(supportsTemperature(model)).toBe(false)
      }
    })

    it.concurrent('should be case insensitive', () => {
      expect(supportsTemperature('GPT-4.1')).toBe(true)
      expect(supportsTemperature('CLAUDE-SONNET-4-6')).toBe(true)
    })

    it.concurrent(
      'should inherit temperature support from provider for dynamically fetched models',
      () => {
        // OpenRouter models should inherit temperature support from provider capabilities
        expect(supportsTemperature('openrouter/anthropic/claude-3.5-sonnet')).toBe(true)
        expect(supportsTemperature('openrouter/openai/gpt-4')).toBe(true)
      }
    )
  })

  describe('getMaxTemperature', () => {
    it.concurrent('should return 2 for models with temperature range 0-2', () => {
      const modelsRange02 = [
        'gpt-4.1',
        'azure/gpt-4.1',
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        'deepseek-v4-flash',
        'grok-4.6',
        'cerebras/gpt-oss-120b',
      ]

      for (const model of modelsRange02) {
        expect(getMaxTemperature(model)).toBe(2)
      }
    })

    it.concurrent('should return 1 for models with temperature range 0-1', () => {
      const modelsRange01 = [
        'claude-sonnet-4-6',
        'claude-haiku-4-5',
        'bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0',
      ]

      for (const model of modelsRange01) {
        expect(getMaxTemperature(model)).toBe(1)
      }
    })

    it.concurrent('should return undefined for models that do not support temperature', () => {
      expect(getMaxTemperature('unsupported-model')).toBeUndefined()
      expect(getMaxTemperature('deepseek-v4-pro')).toBeUndefined()
      expect(getMaxTemperature('o3-pro')).toBeUndefined()
      expect(getMaxTemperature('azure/o3')).toBeUndefined()
      expect(getMaxTemperature('azure/o4-mini')).toBeUndefined()
      // GPT-5 models don't support temperature
      expect(getMaxTemperature('gpt-5')).toBeUndefined()
      expect(getMaxTemperature('gpt-5-mini')).toBeUndefined()
      expect(getMaxTemperature('gpt-5-nano')).toBeUndefined()
      expect(getMaxTemperature('azure/gpt-5')).toBeUndefined()
      expect(getMaxTemperature('azure/gpt-5-mini')).toBeUndefined()
      expect(getMaxTemperature('azure/gpt-5-nano')).toBeUndefined()
      expect(getMaxTemperature('azure/gpt-5-chat')).toBe(2)
    })

    it.concurrent('should be case insensitive', () => {
      expect(getMaxTemperature('GPT-4.1')).toBe(2)
      expect(getMaxTemperature('CLAUDE-SONNET-4-6')).toBe(1)
    })

    it.concurrent(
      'should inherit max temperature from provider for dynamically fetched models',
      () => {
        expect(getMaxTemperature('openrouter/anthropic/claude-3.5-sonnet')).toBe(2)
        expect(getMaxTemperature('openrouter/openai/gpt-4')).toBe(2)
      }
    )
  })

  describe('supportsToolUsageControl', () => {
    it.concurrent('should return true for providers that support tool usage control', () => {
      const supportedProviders = [
        'openai',
        'azure-openai',
        'mistral',
        'anthropic',
        'deepseek',
        'xai',
        'google',
      ]

      for (const provider of supportedProviders) {
        expect(supportsToolUsageControl(provider)).toBe(true)
      }
    })

    it.concurrent(
      'should return false for providers that do not support tool usage control',
      () => {
        const unsupportedProviders = ['ollama', 'non-existent-provider']

        for (const provider of unsupportedProviders) {
          expect(supportsToolUsageControl(provider)).toBe(false)
        }
      }
    )
  })

  describe('Model Constants', () => {
    it.concurrent('should have correct models in MODELS_TEMP_RANGE_0_2', () => {
      expect(MODELS_TEMP_RANGE_0_2).toContain('gpt-4.1')
      expect(MODELS_TEMP_RANGE_0_2).toContain('gemini-2.5-flash')
      expect(MODELS_TEMP_RANGE_0_2).toContain('deepseek-v4-flash')
      expect(MODELS_TEMP_RANGE_0_2).toContain('grok-4.6')
      expect(MODELS_TEMP_RANGE_0_2).not.toContain('claude-sonnet-4-6')
    })

    it.concurrent('should have correct models in MODELS_TEMP_RANGE_0_1', () => {
      expect(MODELS_TEMP_RANGE_0_1).toContain('claude-sonnet-4-6')
      expect(MODELS_TEMP_RANGE_0_1).toContain('claude-haiku-4-5')
      expect(MODELS_TEMP_RANGE_0_1).not.toContain('gpt-4.1')
    })

    it.concurrent('should have correct providers in PROVIDERS_WITH_TOOL_USAGE_CONTROL', () => {
      expect(PROVIDERS_WITH_TOOL_USAGE_CONTROL).toContain('openai')
      expect(PROVIDERS_WITH_TOOL_USAGE_CONTROL).toContain('anthropic')
      expect(PROVIDERS_WITH_TOOL_USAGE_CONTROL).toContain('deepseek')
      expect(PROVIDERS_WITH_TOOL_USAGE_CONTROL).toContain('google')
      expect(PROVIDERS_WITH_TOOL_USAGE_CONTROL).not.toContain('ollama')
    })

    it.concurrent('should include every supported temperature range', () => {
      expect(MODELS_WITH_TEMPERATURE_SUPPORT).toEqual(
        expect.arrayContaining([...MODELS_TEMP_RANGE_0_2, ...MODELS_TEMP_RANGE_0_1])
      )
      expect(MODELS_WITH_TEMPERATURE_SUPPORT).toContain('mistral-large-latest')
      expect(getMaxTemperature('mistral-large-latest')).toBe(1.5)
    })

    it.concurrent('should have correct models in MODELS_WITH_REASONING_EFFORT', () => {
      // Should contain GPT-5 models that support reasoning effort
      expect(MODELS_WITH_REASONING_EFFORT).toContain('gpt-5')
      expect(MODELS_WITH_REASONING_EFFORT).toContain('gpt-5-mini')
      expect(MODELS_WITH_REASONING_EFFORT).toContain('gpt-5-nano')
      expect(MODELS_WITH_REASONING_EFFORT).toContain('azure/gpt-5')
      expect(MODELS_WITH_REASONING_EFFORT).toContain('azure/gpt-5-mini')
      expect(MODELS_WITH_REASONING_EFFORT).toContain('azure/gpt-5-nano')

      // Should NOT contain non-reasoning GPT-5 models
      expect(MODELS_WITH_REASONING_EFFORT).not.toContain('azure/gpt-5-chat')

      // Should NOT contain non-reasoning models
      expect(MODELS_WITH_REASONING_EFFORT).not.toContain('gpt-4.1')
      expect(MODELS_WITH_REASONING_EFFORT).not.toContain('gpt-4.1-mini')
    })

    it.concurrent('should have correct models in MODELS_WITH_VERBOSITY', () => {
      // Should contain GPT-5 models that support verbosity
      expect(MODELS_WITH_VERBOSITY).toContain('gpt-5')
      expect(MODELS_WITH_VERBOSITY).toContain('gpt-5-mini')
      expect(MODELS_WITH_VERBOSITY).toContain('gpt-5-nano')
      expect(MODELS_WITH_VERBOSITY).toContain('azure/gpt-5')
      expect(MODELS_WITH_VERBOSITY).toContain('azure/gpt-5-mini')
      expect(MODELS_WITH_VERBOSITY).toContain('azure/gpt-5-nano')

      // Should NOT contain non-reasoning GPT-5 models
      expect(MODELS_WITH_VERBOSITY).not.toContain('azure/gpt-5-chat')

      // Should NOT contain models without verbosity support
      expect(MODELS_WITH_VERBOSITY).not.toContain('gpt-4.1')
      expect(MODELS_WITH_VERBOSITY).not.toContain('claude-sonnet-4-6')
      expect(MODELS_WITH_VERBOSITY).not.toContain('o3-pro')
    })

    it.concurrent('should keep verbosity as a strict subset of reasoning-capable models', () => {
      MODELS_WITH_VERBOSITY.forEach((model) => {
        expect(MODELS_WITH_REASONING_EFFORT).toContain(model)
      })
      expect(MODELS_WITH_REASONING_EFFORT).toContain('deepseek-v4-pro')
      expect(MODELS_WITH_VERBOSITY).not.toContain('deepseek-v4-pro')
    })
  })
})

describe('Cost Calculation', () => {
  describe('calculateCost', () => {
    it.concurrent('prices canonical OpenRouter Claude tokens', () => {
      expect(
        calculateCost('openrouter/anthropic/claude-sonnet-4.6', 1_000_000, 1_000_000).total
      ).toBe(18)
    })

    it.concurrent.each([false, true])('prices OpenRouter tokens (cached=%s)', (cached) => {
      expect(calculateCost('openrouter/openai/gpt-4.1', 1000, 500, cached).total).toBe(
        cached ? 0.0045 : 0.006
      )
    })

    it.concurrent('should calculate cost correctly for known models', () => {
      const result = calculateCost('gpt-4.1', 1000, 500, false)

      expect(result.input).toBeGreaterThan(0)
      expect(result.output).toBeGreaterThan(0)
      expect(result.total).toBeCloseTo(result.input + result.output, 6)
      expect(result.pricing).toBeDefined()
      expect(result.pricing.input).toBe(2) // GPT-4.1 pricing
    })

    it.concurrent('should handle cached input pricing when enabled', () => {
      const regularCost = calculateCost('gpt-4.1', 1000, 500, false)
      const cachedCost = calculateCost('gpt-4.1', 1000, 500, true)

      expect(cachedCost.input).toBeLessThan(regularCost.input)
      expect(cachedCost.output).toBe(regularCost.output) // Output cost should be same
    })

    it.concurrent('should return default pricing for unknown models', () => {
      const result = calculateCost('unknown-model', 1000, 500, false)

      expect(result.input).toBe(0)
      expect(result.output).toBe(0)
      expect(result.total).toBe(0)
      expect(result.pricing.input).toBe(1.0) // Default pricing
    })

    it.concurrent('should handle zero tokens', () => {
      const result = calculateCost('gpt-4.1', 0, 0, false)

      expect(result.input).toBe(0)
      expect(result.output).toBe(0)
      expect(result.total).toBe(0)
    })
  })

  describe('formatCost', () => {
    it.concurrent('should format costs >= $1 with two decimal places', () => {
      expect(formatCost(1.234)).toBe('$1.23')
      expect(formatCost(10.567)).toBe('$10.57')
    })

    it.concurrent('should format costs between 1¢ and $1 with three decimal places', () => {
      expect(formatCost(0.0234)).toBe('$0.023')
      expect(formatCost(0.1567)).toBe('$0.157')
    })

    it.concurrent('should format costs between 0.1¢ and 1¢ with four decimal places', () => {
      expect(formatCost(0.00234)).toBe('$0.0023')
      expect(formatCost(0.00567)).toBe('$0.0057')
    })

    it.concurrent('should format very small costs with appropriate precision', () => {
      expect(formatCost(0.000234)).toContain('$0.000234')
    })

    it.concurrent('should handle zero cost', () => {
      expect(formatCost(0)).toBe('$0')
    })

    it.concurrent('should handle undefined/null costs', () => {
      expect(formatCost(undefined as any)).toBe('—')
      expect(formatCost(null as any)).toBe('—')
    })
  })
})

describe('getHostedModels', () => {
  it.concurrent('should allow no platform-hosted models', () => {
    const hostedModels = getHostedModels()

    expect(hostedModels).toEqual([])
  })

  it.concurrent('should return an array of strings', () => {
    const hostedModels = getHostedModels()

    expect(Array.isArray(hostedModels)).toBe(true)
    hostedModels.forEach((model) => {
      expect(typeof model).toBe('string')
    })
  })
})

describe('Provider Management', () => {
  describe('getProviderFromModel', () => {
    it.concurrent('should return correct provider for known models', () => {
      expect(getProviderFromModel('gpt-4.1')).toBe('openai')
      expect(getProviderFromModel('claude-sonnet-5')).toBe('anthropic')
      expect(getProviderFromModel('gemini-2.5-pro')).toBe('google')
      expect(getProviderFromModel('azure/gpt-5.4')).toBe('azure-openai')
    })

    it.concurrent('should use model patterns for pattern matching', () => {
      expect(getProviderFromModel('gpt-5-custom')).toBe('openai') // Matches /^gpt/ pattern
      expect(getProviderFromModel('claude-custom-model')).toBe('anthropic') // Matches /^claude/ pattern
    })

    it.concurrent('rejects unknown models and recognizes canonical Ollama IDs', () => {
      expect(() => getProviderFromModel('unknown-model')).toThrow('Unknown model: unknown-model')
      expect(getProviderFromModel('ollama/llama3.2')).toBe('ollama')
    })

    it.concurrent('should be case insensitive', () => {
      expect(getProviderFromModel('GPT-4.1')).toBe('openai')
      expect(getProviderFromModel('CLAUDE-SONNET-5')).toBe('anthropic')
    })
  })

  describe('getProvider', () => {
    it.concurrent('should return provider config for valid provider IDs', () => {
      const openaiProvider = getProvider('openai')
      expect(openaiProvider).toBeDefined()
      expect(openaiProvider?.id).toBe('openai')
      expect(openaiProvider?.name).toBe('OpenAI')

      const anthropicProvider = getProvider('anthropic')
      expect(anthropicProvider).toBeDefined()
      expect(anthropicProvider?.id).toBe('anthropic')
    })

    it.concurrent('rejects provider/service aliases', () => {
      expect(getProvider('openai/chat')).toBeUndefined()
    })

    it.concurrent('should return undefined for invalid provider IDs', () => {
      expect(getProvider('nonexistent')).toBeUndefined()
    })
  })

  describe('getProviderModels', () => {
    it.concurrent('should return models for specific providers', () => {
      const openaiModels = getProviderModels('openai')
      expect(Array.isArray(openaiModels)).toBe(true)
      expect(openaiModels).toContain('gpt-4.1')
      expect(openaiModels).toContain('gpt-5.6-sol')
      expect(openaiModels).not.toContain('gpt-4o')

      const anthropicModels = getProviderModels('anthropic')
      expect(anthropicModels).toContain('claude-sonnet-5')
      expect(anthropicModels).toContain('claude-opus-5')
      expect(anthropicModels).not.toContain('claude-sonnet-4-0')
    })

    it.concurrent('should return empty array for unknown providers', () => {
      const unknownModels = getProviderModels('unknown' as any)
      expect(unknownModels).toEqual([])
    })
  })

  describe('getBaseModelProviders and getAllModelProviders', () => {
    it.concurrent('should return model to provider mapping', () => {
      const allProviders = getAllModelProviders()
      expect(typeof allProviders).toBe('object')
      expect(allProviders['gpt-4.1']).toBe('openai')
      expect(allProviders['claude-sonnet-5']).toBe('anthropic')

      const baseProviders = getBaseModelProviders()
      expect(typeof baseProviders).toBe('object')
      // Should exclude ollama models
    })
  })

  describe('updateOllamaModels', () => {
    it.concurrent('should update ollama models', () => {
      const mockModels = ['ollama/llama2', 'ollama/codellama', 'ollama/mistral']

      // This should not throw
      expect(() => updateOllamaModels(mockModels)).not.toThrow()

      // Verify the models were updated
      const ollamaModels = getProviderModels('ollama')
      expect(ollamaModels).toEqual(mockModels)
    })
  })
})

describe('JSON and Structured Output', () => {
  describe('extractAndParseJSON', () => {
    it.concurrent('should extract and parse valid JSON', () => {
      const content = 'Some text before ```json\n{"key": "value"}\n``` some text after'
      const result = extractAndParseJSON(content)
      expect(result).toEqual({ key: 'value' })
    })

    it.concurrent('should extract JSON without code blocks', () => {
      const content = 'Text before {"name": "test", "value": 42} text after'
      const result = extractAndParseJSON(content)
      expect(result).toEqual({ name: 'test', value: 42 })
    })

    it.concurrent('should handle nested objects', () => {
      const content = '{"user": {"name": "John", "age": 30}, "active": true}'
      const result = extractAndParseJSON(content)
      expect(result).toEqual({
        user: { name: 'John', age: 30 },
        active: true,
      })
    })

    it.concurrent('should clean up common JSON issues', () => {
      const content = '{\n  "key": "value",\n  "number": 42,\n}' // Trailing comma
      const result = extractAndParseJSON(content)
      expect(result).toEqual({ key: 'value', number: 42 })
    })

    it.concurrent('should throw error for content without JSON', () => {
      expect(() => extractAndParseJSON('No JSON here')).toThrow('No JSON object found in content')
    })

    it.concurrent('should throw error for invalid JSON', () => {
      const invalidJson = '{"key": invalid, "broken": }'
      expect(() => extractAndParseJSON(invalidJson)).toThrow('Failed to parse JSON after cleanup')
    })
  })
})

describe('Tool Management', () => {
  describe('transformCustomTool', () => {
    it.concurrent('should transform valid custom tool schema', () => {
      const customTool = {
        id: 'test-tool',
        title: 'Test Tool',
        schema: {
          function: {
            description: 'A test function',
            parameters: {
              type: 'object',
              properties: {
                input: { type: 'string', description: 'Input parameter' },
              },
              required: ['input'],
            },
          },
        },
      }

      const result = transformCustomTool(customTool)

      expect(result.id).toBe('custom_test-tool')
      expect(result.name).toBe('Test Tool')
      expect(result.description).toBe('Custom tool title: Test Tool. A test function')
      expect(result.parameters.type).toBe('object')
      expect(result.parameters.properties).toBeDefined()
      expect(result.parameters.required).toEqual(['input'])
    })

    it.concurrent('should preserve entity IDs that already start with the runtime prefix', () => {
      const result = transformCustomTool({
        id: 'custom_test-tool',
        title: 'Test Tool',
        schema: {
          function: {
            parameters: {
              type: 'object',
              properties: {},
            },
          },
        },
      })

      expect(result.id).toBe('custom_custom_test-tool')
      expect(result.name).toBe('Test Tool')
    })

    it.concurrent('should throw error for invalid schema', () => {
      const invalidTool = { id: 'test', schema: null }
      expect(() => transformCustomTool(invalidTool)).toThrow('Invalid custom tool schema')

      const noFunction = { id: 'test', schema: {} }
      expect(() => transformCustomTool(noFunction)).toThrow('Invalid custom tool schema')
    })
  })

  describe('getCustomTools', () => {
    it.concurrent('should return array of transformed custom tools', () => {
      const result = getCustomTools()
      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('prepareToolExecution', () => {
    it.concurrent('should preserve workspace-only execution context', () => {
      const { toolParams, executionParams } = prepareToolExecution(
        {
          params: {
            llmOnly: 'overridden',
            toolOnly: 'tool-value',
          },
        },
        {
          llmOnly: 'llm-value',
          argOnly: 'arg-value',
        },
        {
          workspaceId: 'workspace-1',
          chatId: 'chat-1',
          userId: 'user-1',
        }
      )

      expect(toolParams).toEqual({
        llmOnly: 'overridden',
        toolOnly: 'tool-value',
        argOnly: 'arg-value',
      })
      expect(executionParams).toMatchObject({
        llmOnly: 'overridden',
        toolOnly: 'tool-value',
        argOnly: 'arg-value',
        _context: {
          workspaceId: 'workspace-1',
          chatId: 'chat-1',
          userId: 'user-1',
          isDeployedContext: true,
        },
      })
      expect(executionParams._context).not.toHaveProperty('workflowId')
    })

    it.concurrent('should include workflow and execution metadata when available', () => {
      const { executionParams } = prepareToolExecution(
        { params: {} },
        {},
        {
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          workflowLogId: 'workflow-log-1',
          submissionSource: 'workflow',
          chatId: 'chat-1',
          userId: 'user-1',
          environmentVariables: { API_KEY: 'secret' },
          workflowVariables: { symbol: 'AAPL' },
          blockData: { blockA: { output: 1 } },
          blockNameMapping: { source: 'blockA' },
          isDeployedContext: false,
        }
      )

      expect(executionParams).toEqual({
        _context: {
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          workflowLogId: 'workflow-log-1',
          submissionSource: 'workflow',
          chatId: 'chat-1',
          userId: 'user-1',
          isDeployedContext: false,
        },
        envVars: { API_KEY: 'secret' },
        workflowVariables: { symbol: 'AAPL' },
        blockData: { blockA: { output: 1 } },
        blockNameMapping: { source: 'blockA' },
      })
    })
  })

  describe('prepareToolsWithUsageControl', () => {
    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    beforeEach(() => {
      mockLogger.info.mockClear()
    })

    it.concurrent('should return early for no tools', () => {
      const result = prepareToolsWithUsageControl(undefined, undefined, mockLogger)

      expect(result.tools).toBeUndefined()
      expect(result.toolChoice).toBeUndefined()
      expect(result.hasFilteredTools).toBe(false)
      expect(result.forcedTools).toEqual([])
    })

    it.concurrent('should filter out tools with usageControl="none"', () => {
      const tools = [
        { function: { name: 'tool1' } },
        { function: { name: 'tool2' } },
        { function: { name: 'tool3' } },
      ]
      const providerTools = [
        { id: 'tool1', usageControl: 'auto' },
        { id: 'tool2', usageControl: 'none' },
        { id: 'tool3', usageControl: 'force' },
      ]

      const result = prepareToolsWithUsageControl(tools, providerTools, mockLogger)

      expect(result.tools).toHaveLength(2)
      expect(result.hasFilteredTools).toBe(true)
      expect(result.forcedTools).toEqual(['tool3'])
      expect(mockLogger.info).toHaveBeenCalledWith("Filtered out 1 tools with usageControl='none'")
    })

    it.concurrent('should set toolChoice for forced tools (OpenAI format)', () => {
      const tools = [{ function: { name: 'forcedTool' } }]
      const providerTools = [{ id: 'forcedTool', usageControl: 'force' }]

      const result = prepareToolsWithUsageControl(tools, providerTools, mockLogger)

      expect(result.toolChoice).toEqual({
        type: 'function',
        function: { name: 'forcedTool' },
      })
    })

    it.concurrent('should set toolChoice for forced tools (Anthropic format)', () => {
      const tools = [{ function: { name: 'forcedTool' } }]
      const providerTools = [{ id: 'forcedTool', usageControl: 'force' }]

      const result = prepareToolsWithUsageControl(tools, providerTools, mockLogger, 'anthropic')

      expect(result.toolChoice).toEqual({
        type: 'tool',
        name: 'forcedTool',
      })
    })

    it.concurrent('should set toolConfig for Google format', () => {
      const tools = [{ function: { name: 'forcedTool' } }]
      const providerTools = [{ id: 'forcedTool', usageControl: 'force' }]

      const result = prepareToolsWithUsageControl(tools, providerTools, mockLogger, 'google')

      expect(result.toolConfig).toEqual({
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames: ['forcedTool'],
        },
      })
    })

    it.concurrent('should return empty when all tools are filtered', () => {
      const tools = [{ function: { name: 'tool1' } }]
      const providerTools = [{ id: 'tool1', usageControl: 'none' }]

      const result = prepareToolsWithUsageControl(tools, providerTools, mockLogger)

      expect(result.tools).toBeUndefined()
      expect(result.toolChoice).toBeUndefined()
      expect(result.hasFilteredTools).toBe(true)
    })

    it.concurrent('should default to auto when no forced tools', () => {
      const tools = [{ function: { name: 'tool1' } }]
      const providerTools = [{ id: 'tool1', usageControl: 'auto' }]

      const result = prepareToolsWithUsageControl(tools, providerTools, mockLogger)

      expect(result.toolChoice).toBe('auto')
    })
  })
})
