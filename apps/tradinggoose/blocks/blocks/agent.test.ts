import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/icons/icons', () => ({
  AgentIcon: () => null,
}))

vi.mock('@/providers/ai/utils', () => ({
  MODELS_WITH_REASONING_EFFORT: [],
  MODELS_WITH_VERBOSITY: [],
  getAllModelProviders: vi.fn(() => ({ 'gpt-4o': 'openai_chat' })),
  getHostedModels: vi.fn(() => []),
  getMaxTemperature: vi.fn(() => 1),
  getProviderIcon: vi.fn(() => undefined),
  providers: {
    'azure-openai': {
      models: [],
    },
  },
  supportsTemperature: vi.fn(() => true),
}))

vi.mock('@/stores/providers/store', () => ({
  useProvidersStore: {
    getState: vi.fn(() => ({
      providers: {
        base: { models: ['gpt-4o'] },
        ollama: { models: [] },
        openrouter: { models: [] },
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
