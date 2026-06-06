import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/icons/icons', () => ({
  AgentIcon: () => null,
}))

vi.mock('@/providers/ai/utils', () => ({
  MODELS_WITH_REASONING_EFFORT: [],
  MODELS_WITH_VERBOSITY: [],
  getAllModelProviders: vi.fn(() => ({
    'gpt-4o': 'openai',
    'hosted/openai/gpt-5.4': 'hosted',
    'azure/gpt-4o': 'azure-openai',
    'openrouter/anthropic/claude-3.5-sonnet': 'openrouter',
  })),
  getHostedModels: vi.fn(() => ['hosted/openai/gpt-5.4']),
  getMaxTemperature: vi.fn(() => 1),
  getProviderFromModel: vi.fn(() => 'openai'),
  getProviderIcon: vi.fn(() => undefined),
  providers: {
    openai: {
      name: 'OpenAI',
      models: ['gpt-4o'],
    },
    hosted: {
      name: 'Hosted',
      models: ['hosted/openai/gpt-5.4'],
    },
    openrouter: {
      name: 'OpenRouter',
      models: ['openrouter/anthropic/claude-3.5-sonnet'],
    },
    'azure-openai': {
      name: 'Azure OpenAI',
      models: ['azure/gpt-4o'],
    },
    ollama: {
      name: 'Ollama',
      models: ['llama3.2'],
    },
  },
  supportsTemperature: vi.fn(() => true),
}))

vi.mock('@/stores/providers/store', () => ({
  useProvidersStore: {
    getState: vi.fn(() => ({
      providers: {
        base: { models: ['gpt-4o', 'hosted/openai/gpt-5.4', 'azure/gpt-4o'] },
        ollama: { models: ['llama3.2'] },
        openrouter: { models: ['openrouter/anthropic/claude-3.5-sonnet'] },
      },
    })),
  },
}))

vi.mock('@/blocks', () => ({
  getAllBlocks: vi.fn(() => [
    {
      type: 'tool-type-1',
      tools: {
        access: ['tool-id-1'],
      },
    },
    {
      type: 'tool-type-2',
      tools: {
        access: ['tool-id-2'],
      },
    },
  ]),
}))

describe('AgentBlock', () => {
  let AgentBlock: typeof import('@/blocks/blocks/agent').AgentBlock

  beforeAll(async () => {
    ;({ AgentBlock } = await import('@/blocks/blocks/agent'))
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const getParamsFunction = () => {
    const paramsFunction = AgentBlock.tools.config?.params
    if (!paramsFunction) {
      throw new Error('AgentBlock.tools.config.params function is missing')
    }
    return paramsFunction
  }

  it('includes a skills selector sub-block', () => {
    const skillsSubBlock = AgentBlock.subBlocks.find((subBlock) => subBlock.id === 'skills')

    expect(skillsSubBlock).toBeDefined()
    expect(skillsSubBlock?.type).toBe('skill-input')
    expect(skillsSubBlock?.defaultValue).toEqual([])
  })

  it('shows provider-scoped model labels while preserving full model IDs', () => {
    const modelSubBlock = AgentBlock.subBlocks.find((subBlock) => subBlock.id === 'model')
    if (!modelSubBlock || typeof modelSubBlock.options !== 'function') {
      throw new Error('AgentBlock model options function is missing')
    }
    if (typeof modelSubBlock.optionGroups !== 'function') {
      throw new Error('AgentBlock model optionGroups function is missing')
    }

    const options = modelSubBlock.options()
    const groups = modelSubBlock.optionGroups()

    expect(modelSubBlock.dropdownMode).toBe('sidebar')
    expect(options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'hosted/openai/gpt-5.4',
          label: 'openai/gpt-5.4',
          group: 'hosted',
        }),
        expect.objectContaining({
          id: 'openrouter/anthropic/claude-3.5-sonnet',
          label: 'anthropic/claude-3.5-sonnet',
          group: 'openrouter',
        }),
        expect.objectContaining({
          id: 'azure/gpt-4o',
          label: 'gpt-4o',
          group: 'azure-openai',
        }),
      ])
    )
    expect(groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'hosted', label: 'Hosted' }),
        expect.objectContaining({ id: 'openrouter', label: 'OpenRouter' }),
      ])
    )
  })

  describe('tools.config.params function', () => {
    it('should pass through params when no tools array is provided', () => {
      const paramsFunction = getParamsFunction()

      const params = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        // No tools provided
      }

      const result = paramsFunction(params)
      expect(result).toEqual(params)
    })

    it('should filter out tools with usageControl set to "none"', () => {
      const paramsFunction = getParamsFunction()

      const params = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        tools: [
          {
            type: 'tool-type-1',
            title: 'Tool 1',
            usageControl: 'auto',
          },
          {
            type: 'tool-type-2',
            title: 'Tool 2',
            usageControl: 'none', // Should be filtered out
          },
          {
            type: 'custom-tool',
            title: 'Custom Tool',
            schema: {
              function: {
                name: 'custom_function',
                description: 'A custom function',
                parameters: { type: 'object', properties: {} },
              },
            },
            usageControl: 'force',
          },
        ],
      }

      const result = paramsFunction(params)

      // Verify that transformed tools contains only the tools not set to 'none'
      expect(result.tools.length).toBe(2)

      // Verify the tool titles (custom identifiers that we can check)
      const toolIds = result.tools.map((tool: any) => tool.name)
      expect(toolIds).toContain('Tool 1')
      expect(toolIds).not.toContain('Tool 2')
      expect(toolIds).toContain('Custom Tool')
    })

    it('should set default usageControl to "auto" if not specified', () => {
      const paramsFunction = getParamsFunction()

      const params = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        tools: [
          {
            type: 'tool-type-1',
            title: 'Tool 1',
            // No usageControl specified, should default to 'auto'
          },
        ],
      }

      const result = paramsFunction(params)

      // Verify that the tool has usageControl set to 'auto'
      expect(result.tools[0].usageControl).toBe('auto')
    })

    it('should correctly transform custom tools', () => {
      const paramsFunction = getParamsFunction()

      const params = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        tools: [
          {
            type: 'custom-tool',
            title: 'Custom Tool',
            schema: {
              function: {
                name: 'custom_function',
                description: 'A custom function description',
                parameters: {
                  type: 'object',
                  properties: {
                    param1: { type: 'string' },
                  },
                },
              },
            },
            usageControl: 'force',
          },
        ],
      }

      const result = paramsFunction(params)

      // Verify custom tool transformation
      expect(result.tools[0]).toEqual({
        id: 'custom_function',
        name: 'Custom Tool',
        description: 'A custom function description',
        params: {},
        parameters: {
          type: 'object',
          properties: {
            param1: { type: 'string' },
          },
        },
        type: 'custom-tool',
        usageControl: 'force',
      })
    })

    it('should handle an empty tools array', () => {
      const paramsFunction = getParamsFunction()

      const params = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        tools: [], // Empty array
      }

      const result = paramsFunction(params)

      // Verify that transformed tools is an empty array
      expect(result.tools).toEqual([])
    })
  })
})
