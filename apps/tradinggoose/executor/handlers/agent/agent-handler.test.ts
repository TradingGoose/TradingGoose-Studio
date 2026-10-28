import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { isHosted } from '@/lib/environment'
import { getAllBlocks } from '@/blocks'
import { BlockType } from '@/executor/consts'
import { AgentBlockHandler } from '@/executor/handlers/agent/agent-handler'
import type { ExecutionContext, StreamingExecution } from '@/executor/types'
import { getProviderFromModel } from '@/providers/ai/models'
import { transformBlockTool } from '@/providers/ai/utils'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import { executeTool } from '@/tools'

process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'

const mockResolveSkillMetadata = vi.hoisted(() => vi.fn())
const { mockExecuteProviderRequest, mockGetApiKey } = vi.hoisted(() => ({
  mockExecuteProviderRequest: vi.fn(),
  mockGetApiKey: vi.fn(),
}))

vi.mock('@/providers/ai', () => ({ executeProviderRequest: mockExecuteProviderRequest }))
vi.mock('@/providers/ai/utils-server', () => ({ getApiKey: mockGetApiKey }))

vi.mock('@/lib/environment', () => ({
  isHosted: vi.fn().mockReturnValue(false),
  isProd: vi.fn().mockReturnValue(false),
  isDev: vi.fn().mockReturnValue(true),
  isTest: vi.fn().mockReturnValue(false),
}))

vi.mock('@/providers/ai/utils', async () => ({
  ...(await vi.importActual<typeof import('@/providers/ai/utils')>('@/providers/ai/utils')),
  transformBlockTool: vi.fn(),
}))
vi.mock('@/providers/ai/models', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/providers/ai/models')>()),
  getProviderFromModel: vi.fn().mockReturnValue('mock-provider'),
}))

vi.mock('@/blocks', () => ({
  getAllBlocks: vi.fn().mockReturnValue([]),
}))

vi.mock('@/tools', () => ({
  executeTool: vi.fn(),
  getToolAsync: vi.fn(),
}))

vi.mock('@/executor/handlers/agent/skills-resolver', () => ({
  resolveSkillMetadata: mockResolveSkillMetadata,
}))

global.fetch = Object.assign(vi.fn(), { preconnect: vi.fn() }) as typeof fetch

const mockGetAllBlocks = getAllBlocks as Mock
const mockExecuteTool = executeTool as Mock
const mockIsHosted = isHosted as unknown as Mock
const mockGetProviderFromModel = getProviderFromModel as Mock
const mockTransformBlockTool = transformBlockTool as Mock
const mockFetch = global.fetch as unknown as Mock

describe('AgentBlockHandler', () => {
  let handler: AgentBlockHandler
  let mockBlock: SerializedBlock
  let mockContext: ExecutionContext
  let originalPromiseAll: any

  beforeEach(() => {
    handler = new AgentBlockHandler()
    vi.clearAllMocks()

    Object.defineProperty(global, 'window', {
      value: {},
      writable: true,
      configurable: true,
    })

    originalPromiseAll = Promise.all

    mockBlock = {
      id: 'test-agent-block',
      metadata: { id: BlockType.AGENT, name: 'Test Agent' },
      type: BlockType.AGENT,
      position: { x: 0, y: 0 },
      config: {
        tool: 'mock-tool',
        params: {},
      },
      inputs: {},
      outputs: {},
      enabled: true,
    } as SerializedBlock
    mockContext = {
      workflowId: 'test-workflow',
      workspaceId: 'test-workspace-id',
      blockStates: new Map(),
      blockLogs: [],
      metadata: { startTime: new Date().toISOString(), duration: 0 },
      environmentVariables: {},
      decisions: { router: new Map(), condition: new Map() },
      loopIterations: new Map(),
      loopItems: new Map(),
      completedLoops: new Set(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      workflow: {
        blocks: [],
        connections: [],
        version: '1.0.0',
        loops: {},
      } as SerializedWorkflow,
    }
    mockIsHosted.mockReturnValue(false)
    mockGetProviderFromModel.mockReturnValue('mock-provider')
    mockResolveSkillMetadata.mockResolvedValue([])

    mockFetch.mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        headers: {
          get: (name: string) => {
            if (name === 'Content-Type') return 'application/json'
            if (name === 'X-Execution-Data') return null
            return null
          },
        },
        json: () =>
          Promise.resolve({
            content: 'Mocked response content',
            model: 'mock-model',
            tokens: { prompt: 10, completion: 20, total: 30 },
            toolCalls: [],
            cost: 0.001,
            timing: { total: 100 },
          }),
      })
    })

    mockTransformBlockTool.mockImplementation((tool: any) => ({
      id: `transformed_${tool.id}`,
      name: `${tool.id}_${tool.operation}`,
      description: 'Transformed tool',
      parameters: { type: 'object', properties: {} },
    }))
    mockGetAllBlocks.mockReturnValue([])

    mockExecuteTool.mockImplementation((toolId, params) => {
      if (toolId === 'function_execute') {
        return Promise.resolve({
          success: true,
          output: { result: 'Executed successfully', params },
        })
      }
      return Promise.resolve({ success: false, error: 'Unknown tool' })
    })
  })

  afterEach(() => {
    Promise.all = originalPromiseAll

    try {
      Object.defineProperty(global, 'window', {
        value: undefined,
        writable: true,
        configurable: true,
      })
    } catch (e) {}
  })

  describe('canHandle', () => {
    it('should return true for blocks with metadata id "agent"', () => {
      expect(handler.canHandle(mockBlock)).toBe(true)
    })

    it('should return false for blocks without metadata id "agent"', () => {
      const nonAgentBlock: SerializedBlock = {
        ...mockBlock,
        metadata: { id: 'other-block' },
      }
      expect(handler.canHandle(nonAgentBlock)).toBe(false)
    })

    it('should return false for blocks without metadata', () => {
      const noMetadataBlock: SerializedBlock = {
        ...mockBlock,
        metadata: undefined,
      }
      expect(handler.canHandle(noMetadataBlock)).toBe(false)
    })
  })

  describe('execute', () => {
    it('normalizes a resolved object system prompt into message text', async () => {
      const systemPrompt = { task: 'Analyze prices', symbols: ['AAPL', 'MSFT'] }
      await handler.execute(
        mockBlock,
        { model: 'gpt-5.4', systemPrompt, userPrompt: 'Run the analysis' },
        mockContext
      )
      expect(JSON.parse(mockFetch.mock.calls[0][1].body).messages).toEqual([
        { role: 'system', content: JSON.stringify(systemPrompt) },
        { role: 'user', content: 'Run the analysis' },
      ])
    })

    it('sends a system-only Agent task once', async () => {
      const task = 'Analyze the current portfolio using the available tools.'
      await handler.execute(mockBlock, { model: 'gpt-5.4', systemPrompt: task }, mockContext)
      const request = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(request.messages).toEqual([{ role: 'user', content: task }])
      expect(request).not.toHaveProperty('systemPrompt')
      expect(request).not.toHaveProperty('context')
    })

    it.each([undefined, ''])('rejects a missing model (%j)', async (model) => {
      await expect(handler.execute(mockBlock, { model }, mockContext)).rejects.toThrow(
        'Agent model is required'
      )
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should execute a basic agent block request', async () => {
      const inputs = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        userPrompt: 'User query: Hello!',
        temperature: 0.7,
        maxTokens: 100,
        apiKey: 'test-api-key',
      }

      mockGetProviderFromModel.mockReturnValue('openai')
      mockContext.isDeployedContext = false

      const expectedOutput = {
        content: 'Mocked response content',
        model: 'mock-model',
        tokens: { prompt: 10, completion: 20, total: 30 },
        toolCalls: { list: [], count: 0 },
        toolResults: [],
        providerTiming: { total: 100 },
        cost: 0.001,
      }

      const result = await handler.execute(mockBlock, inputs, mockContext)

      expect(mockGetProviderFromModel).toHaveBeenCalledWith('gpt-4o')
      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.any(Object))
      const [, init] = mockFetch.mock.calls.find(([url]) => String(url).includes('/api/providers'))!
      expect(JSON.parse(String(init.body)).isDeployedContext).toBe(false)
      expect(result).toEqual(expectedOutput)
    })

    it('should generate a unique internal skill loader tool id when the reserved id is already in use', async () => {
      mockContext.workspaceId = 'workspace-123'
      mockResolveSkillMetadata.mockResolvedValueOnce([
        {
          id: 'skill-1',
          name: 'market-research',
          description: 'Research the market before acting',
        },
      ])

      const providerRequests: any[] = []
      mockTransformBlockTool.mockImplementationOnce(() => ({
        id: 'tradinggoose_internal_load_skill',
        name: 'existing_tool',
        description: 'Conflicting tool',
        parameters: { type: 'object', properties: {}, required: [] },
      }))

      mockFetch.mockImplementation((input, init) => {
        const url = String(input)

        if (url.includes('/api/providers')) {
          providerRequests.push(JSON.parse(String(init?.body || '{}')))

          return Promise.resolve({
            ok: true,
            headers: {
              get: (name: string) => {
                if (name === 'Content-Type') return 'application/json'
                if (name === 'X-Execution-Data') return null
                return null
              },
            },
            json: () =>
              Promise.resolve({
                content: 'Mocked response content',
                model: 'mock-model',
                tokens: { prompt: 10, completion: 20, total: 30 },
                toolCalls: [],
                cost: 0.001,
                timing: { total: 100 },
              }),
          })
        }

        return Promise.resolve({
          ok: true,
          headers: {
            get: (name: string) => {
              if (name === 'Content-Type') return 'application/json'
              if (name === 'X-Execution-Data') return null
              return null
            },
          },
          json: () =>
            Promise.resolve({
              content: 'Mocked response content',
              model: 'mock-model',
              tokens: { prompt: 10, completion: 20, total: 30 },
              toolCalls: [],
              cost: 0.001,
              timing: { total: 100 },
            }),
        })
      })

      await handler.execute(
        mockBlock,
        {
          model: 'gpt-4o',
          systemPrompt: 'You are a helpful assistant.',
          apiKey: 'test-api-key',
          tools: [
            {
              title: 'Conflicting Tool',
              type: 'tool-type-1',
              operation: 'operation1',
            },
          ],
          skills: [{ skillId: 'skill-1' }],
        },
        mockContext
      )

      expect(providerRequests).toHaveLength(1)

      const providerRequest = providerRequests[0]
      const toolIds = providerRequest.tools.map((tool: { id: string }) => tool.id)
      const uniqueToolIds = new Set(toolIds)
      const generatedSkillToolId = toolIds.find(
        (toolId: string) =>
          toolId.startsWith('tradinggoose_internal_load_skill') &&
          toolId !== 'tradinggoose_internal_load_skill'
      )
      expect(uniqueToolIds.size).toBe(toolIds.length)
      expect(toolIds).toContain('tradinggoose_internal_load_skill')
      expect(generatedSkillToolId).toBe('tradinggoose_internal_load_skill_2')
      expect(providerRequest.messages).toHaveLength(1)
      expect(providerRequest.messages[0].role).toBe('user')
      expect(providerRequest.messages[0].content).toContain('You are a helpful assistant.')
      expect(providerRequest.messages[0].content).toContain('tradinggoose_internal_load_skill_2')
    })

    it('executes without a skill loader when selected skills are unavailable', async () => {
      mockResolveSkillMetadata.mockResolvedValueOnce([])

      await handler.execute(
        mockBlock,
        {
          model: 'gpt-4o',
          userPrompt: 'Use the selected skill.',
          apiKey: 'test-api-key',
          skills: [{ skillId: 'deleted-skill' }],
        },
        mockContext
      )

      const [, init] = mockFetch.mock.calls.find(([url]) => String(url).includes('/api/providers'))!
      const providerRequest = JSON.parse(String(init.body))

      expect(providerRequest.tools).toEqual([])
      expect(providerRequest.messages).toEqual([
        { role: 'user', content: 'Use the selected skill.' },
      ])
    })

    it('should preserve executeFunction for custom tools with different usageControl settings', async () => {
      let capturedTools: any[] = []

      Promise.all = vi.fn().mockImplementation((promises: Promise<any>[]) => {
        const result = originalPromiseAll.call(Promise, promises)

        result.then((tools: any[]) => {
          if (tools?.length) {
            capturedTools = tools.filter((t) => t !== null)
          }
        })

        return result
      })

      mockFetch.mockImplementationOnce(() => {
        return Promise.resolve({
          ok: true,
          headers: {
            get: (name: string) => {
              if (name === 'Content-Type') return 'application/json'
              if (name === 'X-Execution-Data') return null
              return null
            },
          },
          json: () =>
            Promise.resolve({
              content: 'Using tools to respond',
              model: 'mock-model',
              tokens: { prompt: 10, completion: 20, total: 30 },
              toolCalls: [
                {
                  name: 'custom_auto_tool',
                  arguments: { input: 'test input for auto tool' },
                },
                {
                  name: 'custom_force_tool',
                  arguments: { input: 'test input for force tool' },
                },
              ],
              timing: { total: 100 },
            }),
        })
      })

      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Test custom tools with different usageControl settings',
        apiKey: 'test-api-key',
        tools: [
          {
            type: 'custom-tool',
            title: 'Auto Tool',
            toolId: 'custom_auto_tool',
            code: 'return { result: "auto tool executed", input }',
            timeout: 1000,
            schema: {
              function: {
                description: 'Custom tool with auto usage control',
                parameters: {
                  type: 'object',
                  properties: {
                    input: { type: 'string' },
                  },
                },
              },
            },
            usageControl: 'auto' as const,
          },
          {
            type: 'custom-tool',
            title: 'Force Tool',
            toolId: 'custom_force_tool',
            code: 'return { result: "force tool executed", input }',
            timeout: 1000,
            schema: {
              function: {
                description: 'Custom tool with forced usage control',
                parameters: {
                  type: 'object',
                  properties: {
                    input: { type: 'string' },
                  },
                },
              },
            },
            usageControl: 'force' as const,
          },
          {
            type: 'custom-tool',
            title: 'None Tool',
            toolId: 'custom_none_tool',
            code: 'return { result: "none tool executed", input }',
            timeout: 1000,
            schema: {
              function: {
                description: 'Custom tool that should be filtered out',
                parameters: {
                  type: 'object',
                  properties: {
                    input: { type: 'string' },
                  },
                },
              },
            },
            usageControl: 'none' as const,
          },
        ],
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      const output = (await handler.execute(mockBlock, inputs, mockContext)) as {
        toolCalls: { list: Array<{ id?: string; name: string }> }
      }

      expect(Promise.all).toHaveBeenCalled()

      expect(capturedTools.length).toBe(2)

      const autoTool = capturedTools.find((t) => t.id === 'custom_auto_tool')
      const forceTool = capturedTools.find((t) => t.id === 'custom_force_tool')
      const noneTool = capturedTools.find((t) => t.id === 'custom_none_tool')

      expect(autoTool).toBeDefined()
      expect(forceTool).toBeDefined()
      expect(noneTool).toBeUndefined()

      expect(autoTool.usageControl).toBe('auto')
      expect(forceTool.usageControl).toBe('force')

      expect(typeof autoTool.executeFunction).toBe('function')
      expect(typeof forceTool.executeFunction).toBe('function')

      await autoTool.executeFunction({ input: 'test input' })
      expect(mockExecuteTool).toHaveBeenCalledWith(
        'function_execute',
        expect.objectContaining({
          code: 'return { result: "auto tool executed", input }',
          input: 'test input',
        }),
        false, // skipPostProcess
        expect.any(Object) // execution context
      )

      await forceTool.executeFunction({ input: 'another test' })
      expect(mockExecuteTool).toHaveBeenNthCalledWith(
        2, // Check the 2nd call
        'function_execute',
        expect.objectContaining({
          code: 'return { result: "force tool executed", input }',
          input: 'another test',
        }),
        false, // skipPostProcess
        expect.any(Object) // execution context
      )

      const fetchCall = mockFetch.mock.calls[0]
      const requestBody = JSON.parse(fetchCall[1].body)

      expect(requestBody.tools.length).toBe(2)
      expect(output.toolCalls.list).toMatchObject([
        { id: 'custom_auto_tool', name: 'Auto Tool' },
        { id: 'custom_force_tool', name: 'Force Tool' },
      ])
    })

    it('should filter out tools with usageControl set to "none"', async () => {
      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Use the tools provided.',
        apiKey: 'test-api-key',
        tools: [
          {
            id: 'tool_1',
            title: 'Tool 1',
            type: 'tool-type-1',
            operation: 'operation1',
            usageControl: 'auto' as const,
          },
          {
            id: 'tool_2',
            title: 'Tool 2',
            type: 'tool-type-2',
            operation: 'operation2',
            usageControl: 'none' as const,
          },
          {
            id: 'tool_3',
            title: 'Tool 3',
            type: 'tool-type-3',
            operation: 'operation3',
            usageControl: 'force' as const,
          },
        ],
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockBlock, inputs, mockContext)

      const fetchCall = mockFetch.mock.calls[0]
      const requestBody = JSON.parse(fetchCall[1].body)

      expect(requestBody.tools.length).toBe(2)

      const toolIds = requestBody.tools.map((t: any) => t.id)
      expect(toolIds).toContain('transformed_tool_1')
      expect(toolIds).toContain('transformed_tool_3')
      expect(toolIds).not.toContain('transformed_tool_2')
    })

    it('should include usageControl property in transformed tools', async () => {
      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Use the tools with different usage controls.',
        apiKey: 'test-api-key',
        tools: [
          {
            id: 'tool_1',
            title: 'Tool 1',
            type: 'tool-type-1',
            operation: 'operation1',
            usageControl: 'auto' as const,
          },
          {
            id: 'tool_2',
            title: 'Tool 2',
            type: 'tool-type-2',
            operation: 'operation2',
            usageControl: 'force' as const,
          },
        ],
      }

      mockTransformBlockTool.mockImplementation((tool: any) => ({
        id: `transformed_${tool.id}`,
        name: `${tool.id}_${tool.operation}`,
        description: 'Transformed tool',
        parameters: { type: 'object', properties: {} },
      }))

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockBlock, inputs, mockContext)

      const fetchCall = mockFetch.mock.calls[0]
      const requestBody = JSON.parse(fetchCall[1].body)

      expect(requestBody.tools[0].usageControl).toBe('auto')
      expect(requestBody.tools[1].usageControl).toBe('force')
    })

    it('should handle custom tools with usageControl properties', async () => {
      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Use the custom tools.',
        apiKey: 'test-api-key',
        tools: [
          {
            type: 'custom-tool',
            title: 'Custom Tool - Auto',
            toolId: 'custom_tool_auto',
            schema: {
              function: {
                description: 'A custom tool with auto usage control',
                parameters: {
                  type: 'object',
                  properties: { input: { type: 'string' } },
                },
              },
            },
            usageControl: 'auto' as const,
          },
          {
            type: 'custom-tool',
            title: 'Custom Tool - Force',
            toolId: 'custom_tool_force',
            schema: {
              function: {
                description: 'A custom tool with forced usage',
                parameters: {
                  type: 'object',
                  properties: { input: { type: 'string' } },
                },
              },
            },
            usageControl: 'force' as const,
          },
          {
            type: 'custom-tool',
            title: 'Custom Tool - None',
            toolId: 'custom_tool_none',
            schema: {
              function: {
                description: 'A custom tool that should not be used',
                parameters: {
                  type: 'object',
                  properties: { input: { type: 'string' } },
                },
              },
            },
            usageControl: 'none' as const,
          },
        ],
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockBlock, inputs, mockContext)

      const fetchCall = mockFetch.mock.calls[0]
      const requestBody = JSON.parse(fetchCall[1].body)

      expect(requestBody.tools.length).toBe(2)

      const toolIds = requestBody.tools.map((t: any) => t.id)
      expect(toolIds).toContain('custom_tool_auto')
      expect(toolIds).toContain('custom_tool_force')
      expect(toolIds).not.toContain('custom_tool_none')

      const autoTool = requestBody.tools.find((t: any) => t.id === 'custom_tool_auto')
      const forceTool = requestBody.tools.find((t: any) => t.id === 'custom_tool_force')

      expect(autoTool.name).toBe('Custom Tool - Auto')
      expect(forceTool.name).toBe('Custom Tool - Force')
      expect(autoTool.usageControl).toBe('auto')
      expect(forceTool.usageControl).toBe('force')
    })

    it('should not require API key for gpt-4o on hosted version', async () => {
      mockIsHosted.mockReturnValue(true)

      const inputs = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        userPrompt: 'User query: Hello!',
        temperature: 0.7,
        maxTokens: 100,
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockBlock, inputs, mockContext)

      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.any(Object))
    })

    it('should execute with standard block tools', async () => {
      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Analyze this data.',
        apiKey: 'test-api-key', // Add API key for non-hosted env
        tools: [
          {
            id: 'block_tool_1',
            title: 'Data Analysis Tool',
            operation: 'analyze',
          },
        ],
      }

      const mockToolDetails = {
        id: 'block_tool_1',
        name: 'data_analysis_analyze',
        description: 'Analyzes data',
        parameters: { type: 'object', properties: { input: { type: 'string' } } },
      }

      mockTransformBlockTool.mockReturnValue(mockToolDetails)
      mockGetProviderFromModel.mockReturnValue('openai')

      const expectedOutput = {
        content: 'Mocked response content',
        model: 'mock-model',
        tokens: { prompt: 10, completion: 20, total: 30 },
        toolCalls: { list: [], count: 0 }, // Assuming no tool calls in this mock response
        toolResults: [],
        providerTiming: { total: 100 },
        cost: 0.001,
      }

      const result = await handler.execute(mockBlock, inputs, mockContext)

      expect(mockTransformBlockTool).toHaveBeenCalledWith(
        inputs.tools[0],
        expect.objectContaining({ selectedOperation: 'analyze' })
      )
      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.any(Object))
      expect(result).toEqual(expectedOutput)
    })

    it('skips selected tools that cannot be hydrated', async () => {
      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Analyze this data.',
        apiKey: 'test-api-key',
        tools: [
          {
            id: 'block_tool_1',
            title: 'Data Analysis Tool',
            operation: 'analyze',
          },
          {
            id: 'missing_tool',
            title: 'Missing Tool',
            operation: 'analyze',
          },
        ],
      }

      mockTransformBlockTool.mockImplementation((tool: any) =>
        tool.id === 'block_tool_1'
          ? {
              id: 'transformed_block_tool_1',
              name: 'block_tool_1_analyze',
              description: 'Transformed tool',
              parameters: { type: 'object', properties: {} },
            }
          : null
      )
      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockBlock, inputs, mockContext)

      expect(mockTransformBlockTool).toHaveBeenCalledWith(
        inputs.tools[0],
        expect.objectContaining({ selectedOperation: 'analyze' })
      )
      expect(mockTransformBlockTool).toHaveBeenCalledWith(
        inputs.tools[1],
        expect.objectContaining({ selectedOperation: 'analyze' })
      )
      const [, init] = mockFetch.mock.calls.find(([url]) => String(url).includes('/api/providers'))!
      const providerRequest = JSON.parse(String(init.body))

      expect(providerRequest.tools).toHaveLength(1)
      expect(providerRequest.tools[0].id).toBe('transformed_block_tool_1')
    })

    it('skips unavailable MCP tool selections before provider startup', async () => {
      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Use the MCP tool if available.',
        apiKey: 'test-api-key',
        tools: [
          {
            type: 'mcp',
            title: 'Read Files',
            params: {
              serverId: 'deleted-server',
              toolName: 'read_file',
            },
          },
        ],
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockBlock, inputs, mockContext)
      const calledUrls = mockFetch.mock.calls.map(([url]) => String(url))
      const [, init] = mockFetch.mock.calls.find(([url]) => String(url).includes('/api/providers'))!
      const providerRequest = JSON.parse(String(init.body))

      expect(calledUrls.some((url) => url.includes('/api/mcp/tools/discover'))).toBe(true)
      expect(calledUrls.some((url) => url.includes('/api/providers'))).toBe(true)
      expect(providerRequest.tools).toEqual([])
    })

    it('should execute with custom tools (schema only and with code)', async () => {
      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Use the custom tools.',
        apiKey: 'test-api-key',
        tools: [
          {
            type: 'custom-tool',
            title: 'Custom Schema Tool',
            toolId: 'custom_schema_tool',
            schema: {
              function: {
                description: 'A tool defined only by schema',
                parameters: {
                  type: 'object',
                  properties: {
                    input: { type: 'string' },
                  },
                },
              },
            },
          },
          {
            type: 'custom-tool',
            title: 'Custom Code Tool',
            toolId: 'custom_code_tool',
            code: 'return { result: input * 2 }',
            timeout: 1000,
            schema: {
              function: {
                description: 'A tool with code execution',
                parameters: {
                  type: 'object',
                  properties: {
                    input: { type: 'number' },
                  },
                },
              },
            },
          },
        ],
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockBlock, inputs, mockContext)

      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.any(Object))
    })

    it('should handle responseFormat with valid JSON', async () => {
      mockFetch.mockImplementationOnce(() => {
        return Promise.resolve({
          ok: true,
          headers: {
            get: (name: string) => {
              if (name === 'Content-Type') return 'application/json'
              if (name === 'X-Execution-Data') return null
              return null
            },
          },
          json: () =>
            Promise.resolve({
              content: '{"result": "Success", "score": 0.95}',
              model: 'mock-model',
              tokens: { prompt: 10, completion: 20, total: 30 },
              timing: { total: 100 },
              toolCalls: [],
              cost: undefined,
            }),
        })
      })

      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Test context',
        apiKey: 'test-api-key',
        responseFormat:
          '{"schema":{"type":"object","properties":{"result":{"type":"string"},"score":{"type":"number"}}}}',
      }

      const result = await handler.execute(mockBlock, inputs, mockContext)

      expect(result).toEqual({
        result: 'Success',
        score: 0.95,
        tokens: { prompt: 10, completion: 20, total: 30 },
        toolCalls: { list: [], count: 0 },
        toolResults: [],
        providerTiming: { total: 100 },
        cost: undefined,
      })
    })

    it('should handle responseFormat when it is an empty string', async () => {
      mockFetch.mockImplementationOnce(() => {
        return Promise.resolve({
          ok: true,
          headers: {
            get: (name: string) => {
              if (name === 'Content-Type') return 'application/json'
              if (name === 'X-Execution-Data') return null
              return null
            },
          },
          json: () =>
            Promise.resolve({
              content: 'Regular text response',
              model: 'mock-model',
              tokens: { prompt: 10, completion: 20, total: 30 },
              timing: { total: 100 },
            }),
        })
      })

      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'Test context',
        apiKey: 'test-api-key',
        responseFormat: '', // Empty string
      }

      const result = await handler.execute(mockBlock, inputs, mockContext)

      expect(result).toEqual({
        content: 'Regular text response',
        model: 'mock-model',
        tokens: { prompt: 10, completion: 20, total: 30 },
        toolCalls: { list: [], count: 0 },
        toolResults: [],
        providerTiming: { total: 100 },
        cost: undefined,
      })
    })

    it.each(['{invalid-json', '<start.input>', '{}', '{"type":"object"}', '{"schema":null}'])(
      'rejects invalid response format %s before requesting the provider',
      async (responseFormat) => {
        await expect(
          handler.execute(mockBlock, { model: 'gpt-5.4', responseFormat }, mockContext)
        ).rejects.toThrow('Invalid agent response format')
        expect(mockFetch).not.toHaveBeenCalled()
      }
    )

    it.each(['not JSON', '[]', 'null'])('rejects invalid structured output %s', async (content) => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ content })))
      await expect(
        handler.execute(
          mockBlock,
          {
            model: 'gpt-5.4',
            userPrompt: 'Test prompt',
            responseFormat: { schema: { type: 'object' } },
          },
          mockContext
        )
      ).rejects.toThrow('Agent response format requires a valid JSON object')
    })

    it('should handle errors from the provider request', async () => {
      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'This will fail.',
        apiKey: 'test-api-key', // Add API key for non-hosted env
      }

      mockGetProviderFromModel.mockReturnValue('openai')
      mockFetch.mockRejectedValue(new Error('Provider API Error'))

      await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
        'Provider API Error'
      )
    })

    it.each(['server', 'browser'])(
      'handles canonical streaming execution through %s',
      async (path) => {
        const stream = new ReadableStream({
          start(controller) {
            controller.close()
          },
        })
        const execution = {
          success: true,
          output: { content: 'Streaming content', model: 'gpt-5.4' },
          logs: [],
          metadata: { duration: 100, startTime: new Date().toISOString() },
        }
        if (path === 'server') {
          Object.defineProperty(global, 'window', { value: undefined, configurable: true })
          mockGetApiKey.mockResolvedValue('test-api-key')
          mockExecuteProviderRequest.mockResolvedValue({ stream, execution })
        } else {
          mockFetch.mockResolvedValueOnce(
            new Response(stream, {
              headers: {
                'Content-Type': 'text/event-stream',
                'X-Execution-Data': JSON.stringify(execution),
              },
            })
          )
        }
        mockContext.stream = true
        mockContext.selectedOutputs = [mockBlock.id]

        const result = (await handler.execute(
          mockBlock,
          { model: 'gpt-5.4', userPrompt: 'Stream this response.' },
          mockContext
        )) as StreamingExecution

        expect(result.stream).toBeInstanceOf(ReadableStream)
        expect(result.execution).toMatchObject({
          ...execution,
          blockId: mockBlock.id,
          blockName: 'Test Agent',
          isStreaming: true,
        })
      }
    )

    it.each([null, 'invalid', '{}'])(
      'rejects missing or malformed streaming execution data %j',
      async (header) => {
        const headers: Record<string, string> = { 'Content-Type': 'text/event-stream' }
        if (header !== null) headers['X-Execution-Data'] = header
        mockFetch.mockResolvedValueOnce(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.close()
              },
            }),
            { headers }
          )
        )

        await expect(
          handler.execute(
            mockBlock,
            { model: 'gpt-5.4', userPrompt: 'Stream this response.' },
            mockContext
          )
        ).rejects.toThrow(/Streaming provider response requires|Invalid streaming execution data/)
      }
    )

    it('processes memories with system prompt and user prompt', async () => {
      const inputs = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        userPrompt: 'What did we discuss before?',
        memories: [
          { role: 'user', content: 'Hello, my name is John.' },
          { role: 'assistant', content: 'Hello John! Nice to meet you.' },
          { role: 'user', content: 'I like programming.' },
          { role: 'assistant', content: "That's great! What programming languages do you enjoy?" },
        ],
        apiKey: 'test-api-key',
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockBlock, inputs, mockContext)

      const fetchCall = mockFetch.mock.calls[0]
      const requestBody = JSON.parse(fetchCall[1].body)

      // Verify messages were built correctly
      expect(requestBody.messages).toBeDefined()
      expect(requestBody.messages.length).toBe(6) // system + 4 memories + user prompt

      // Check system prompt is first
      expect(requestBody.messages[0].role).toBe('system')
      expect(requestBody.messages[0].content).toBe('You are a helpful assistant.')

      // Check memories are in the middle
      expect(requestBody.messages[1].role).toBe('user')
      expect(requestBody.messages[1].content).toBe('Hello, my name is John.')
      expect(requestBody.messages[2].role).toBe('assistant')
      expect(requestBody.messages[2].content).toBe('Hello John! Nice to meet you.')

      // Check user prompt is last
      expect(requestBody.messages[5].role).toBe('user')
      expect(requestBody.messages[5].content).toBe('What did we discuss before?')

      // Verify system prompt and context are not included separately
      expect(requestBody.systemPrompt).toBeUndefined()
      expect(requestBody.userPrompt).toBeUndefined()
    })

    it('should handle memory block output format', async () => {
      const inputs = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        userPrompt: 'Continue our conversation.',
        memories: {
          memories: [
            {
              key: 'conversation-1',
              type: BlockType.AGENT,
              data: [
                { role: 'user', content: 'Hi there!' },
                { role: 'assistant', content: 'Hello! How can I help you?' },
              ],
            },
          ],
        },
        apiKey: 'test-api-key',
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockBlock, inputs, mockContext)

      const fetchCall = mockFetch.mock.calls[0]
      const requestBody = JSON.parse(fetchCall[1].body)

      // Verify messages were built correctly
      expect(requestBody.messages).toBeDefined()
      expect(requestBody.messages.length).toBe(4) // system + 2 memories + user prompt

      // Check system prompt is first
      expect(requestBody.messages[0].role).toBe('system')
      expect(requestBody.messages[0].content).toBe('You are a helpful assistant.')

      // Check memories from memory block
      expect(requestBody.messages[1].role).toBe('user')
      expect(requestBody.messages[1].content).toBe('Hi there!')
      expect(requestBody.messages[2].role).toBe('assistant')
      expect(requestBody.messages[2].content).toBe('Hello! How can I help you?')

      // Check user prompt is last
      expect(requestBody.messages[3].role).toBe('user')
      expect(requestBody.messages[3].content).toBe('Continue our conversation.')
    })

    it('should not duplicate system prompt if it exists in memories', async () => {
      const inputs = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        userPrompt: 'What should I do?',
        memories: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello!' },
          { role: 'assistant', content: 'Hi there!' },
        ],
        apiKey: 'test-api-key',
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockBlock, inputs, mockContext)

      const fetchCall = mockFetch.mock.calls[0]
      const requestBody = JSON.parse(fetchCall[1].body)

      // Verify messages were built correctly
      expect(requestBody.messages).toBeDefined()
      expect(requestBody.messages.length).toBe(4) // existing system + 2 memories + user prompt

      // Check only one system message exists
      const systemMessages = requestBody.messages.filter((msg: any) => msg.role === 'system')
      expect(systemMessages.length).toBe(1)
      expect(systemMessages[0].content).toBe('You are a helpful assistant.')
    })

    it('should prioritize explicit systemPrompt over system messages in memories', async () => {
      const inputs = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        userPrompt: 'What should I do?',
        memories: [
          { role: 'system', content: 'Old system message from memories.' },
          { role: 'user', content: 'Hello!' },
          { role: 'assistant', content: 'Hi there!' },
        ],
        apiKey: 'test-api-key',
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockBlock, inputs, mockContext)

      const fetchCall = mockFetch.mock.calls[0]
      const requestBody = JSON.parse(fetchCall[1].body)

      // Verify messages were built correctly
      expect(requestBody.messages).toBeDefined()
      expect(requestBody.messages.length).toBe(4) // explicit system + 2 non-system memories + user prompt

      // Check only one system message exists and it's the explicit one
      const systemMessages = requestBody.messages.filter((msg: any) => msg.role === 'system')
      expect(systemMessages.length).toBe(1)
      expect(systemMessages[0].content).toBe('You are a helpful assistant.')

      // Verify the explicit system prompt is first
      expect(requestBody.messages[0].role).toBe('system')
      expect(requestBody.messages[0].content).toBe('You are a helpful assistant.')

      // Verify conversation order is preserved
      expect(requestBody.messages[1].role).toBe('user')
      expect(requestBody.messages[1].content).toBe('Hello!')
      expect(requestBody.messages[2].role).toBe('assistant')
      expect(requestBody.messages[2].content).toBe('Hi there!')
      expect(requestBody.messages[3].role).toBe('user')
      expect(requestBody.messages[3].content).toBe('What should I do?')
    })

    it('should handle multiple system messages in memories with explicit systemPrompt', async () => {
      const inputs = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        userPrompt: 'Continue our conversation.',
        memories: [
          { role: 'system', content: 'First system message.' },
          { role: 'user', content: 'Hello!' },
          { role: 'system', content: 'Second system message.' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'system', content: 'Third system message.' },
        ],
        apiKey: 'test-api-key',
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockBlock, inputs, mockContext)

      const fetchCall = mockFetch.mock.calls[0]
      const requestBody = JSON.parse(fetchCall[1].body)

      // Verify messages were built correctly
      expect(requestBody.messages).toBeDefined()
      expect(requestBody.messages.length).toBe(4) // explicit system + 2 non-system memories + user prompt

      // Check only one system message exists and message order is preserved
      const systemMessages = requestBody.messages.filter((msg: any) => msg.role === 'system')
      expect(systemMessages.length).toBe(1)
      expect(systemMessages[0].content).toBe('You are a helpful assistant.')

      // Verify conversation flow is preserved
      expect(requestBody.messages[0].role).toBe('system')
      expect(requestBody.messages[0].content).toBe('You are a helpful assistant.')
      expect(requestBody.messages[1].role).toBe('user')
      expect(requestBody.messages[1].content).toBe('Hello!')
      expect(requestBody.messages[2].role).toBe('assistant')
      expect(requestBody.messages[2].content).toBe('Hi there!')
      expect(requestBody.messages[3].role).toBe('user')
      expect(requestBody.messages[3].content).toBe('Continue our conversation.')
    })

    it('should preserve multiple system messages when no explicit systemPrompt is provided', async () => {
      const inputs = {
        model: 'gpt-4o',
        userPrompt: 'What should I do?',
        memories: [
          { role: 'system', content: 'First system message.' },
          { role: 'user', content: 'Hello!' },
          { role: 'system', content: 'Second system message.' },
          { role: 'assistant', content: 'Hi there!' },
        ],
        apiKey: 'test-api-key',
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockBlock, inputs, mockContext)

      const fetchCall = mockFetch.mock.calls[0]
      const requestBody = JSON.parse(fetchCall[1].body)

      // Verify messages were built correctly
      expect(requestBody.messages).toBeDefined()
      expect(requestBody.messages.length).toBe(5) // 2 system + 2 non-system memories + user prompt

      // Check that multiple system messages are preserved when no explicit systemPrompt
      const systemMessages = requestBody.messages.filter((msg: any) => msg.role === 'system')
      expect(systemMessages.length).toBe(2)
      expect(systemMessages[0].content).toBe('First system message.')
      expect(systemMessages[1].content).toBe('Second system message.')

      // Verify original order is preserved
      expect(requestBody.messages[0].role).toBe('system')
      expect(requestBody.messages[0].content).toBe('First system message.')
      expect(requestBody.messages[1].role).toBe('user')
      expect(requestBody.messages[1].content).toBe('Hello!')
      expect(requestBody.messages[2].role).toBe('system')
      expect(requestBody.messages[2].content).toBe('Second system message.')
      expect(requestBody.messages[3].role).toBe('assistant')
      expect(requestBody.messages[3].content).toBe('Hi there!')
      expect(requestBody.messages[4].role).toBe('user')
      expect(requestBody.messages[4].content).toBe('What should I do?')
    })

    it('serializes the complete object-valued user prompt', async () => {
      const inputs = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        userPrompt: {
          input: 'What is the weather like?',
          conversationId: 'abc-123',
        },
        memories: [],
        apiKey: 'test-api-key',
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockBlock, inputs, mockContext)

      const fetchCall = mockFetch.mock.calls[0]
      const requestBody = JSON.parse(fetchCall[1].body)

      expect(requestBody.messages[1]).toEqual({
        role: 'user',
        content: JSON.stringify(inputs.userPrompt),
      })
    })

    it('should pass Azure OpenAI parameters through the request pipeline', async () => {
      const inputs = {
        model: 'azure/gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        userPrompt: 'Hello!',
        apiKey: 'test-azure-api-key',
        azureEndpoint: 'https://my-azure-resource.openai.azure.com',
        azureApiVersion: '2024-07-01-preview',
        temperature: 0.7,
      }

      mockGetProviderFromModel.mockReturnValue('azure-openai')

      await handler.execute(mockBlock, inputs, mockContext)

      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.any(Object))

      const fetchCall = mockFetch.mock.calls[0]
      const requestBody = JSON.parse(fetchCall[1].body)

      // Check that Azure parameters are included in the request
      expect(requestBody.azureEndpoint).toBe('https://my-azure-resource.openai.azure.com')
      expect(requestBody.azureApiVersion).toBe('2024-07-01-preview')
      expect(requestBody.provider).toBe('azure-openai')
      expect(requestBody.model).toBe('azure/gpt-4o')
      expect(requestBody.apiKey).toBe('test-azure-api-key')
    })

    it.each([
      ['openai', { model: 'gpt-5.4', reasoningEffort: 'xhigh', verbosity: 'high' }],
      ['anthropic', { model: 'claude-sonnet-4-6', thinkingLevel: 'high' }],
    ] as const)(
      'passes optional settings through browser execution for %s',
      async (provider, settings) => {
        mockGetProviderFromModel.mockReturnValue(provider)
        await handler.execute(
          mockBlock,
          { ...settings, userPrompt: 'Hello!', apiKey: 'test-api-key' },
          mockContext
        )

        const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body)
        expect(requestBody).toMatchObject({
          provider,
          ...settings,
          apiKey: 'test-api-key',
          messages: [{ role: 'user', content: 'Hello!' }],
        })
        expect(requestBody).not.toHaveProperty('context')
        expect(requestBody).not.toHaveProperty('systemPrompt')
      }
    )

    it('passes optional model settings through direct server execution', async () => {
      Object.defineProperty(global, 'window', { value: undefined, configurable: true })
      mockGetProviderFromModel.mockReturnValue('deepseek')
      mockGetApiKey.mockResolvedValue('resolved-api-key')
      mockExecuteProviderRequest.mockResolvedValue({
        content: 'Hello!',
        model: 'deepseek-v4-flash',
      })

      await handler.execute(
        mockBlock,
        {
          model: 'deepseek-v4-flash',
          userPrompt: 'Hello!',
          reasoningEffort: 'max',
          thinkingLevel: 'none',
        },
        mockContext
      )

      expect(mockFetch).not.toHaveBeenCalled()
      expect(mockExecuteProviderRequest).toHaveBeenCalledWith(
        'deepseek',
        expect.objectContaining({
          model: 'deepseek-v4-flash',
          apiKey: 'resolved-api-key',
          reasoningEffort: 'max',
          thinkingLevel: 'none',
          verbosity: undefined,
          messages: [{ role: 'user', content: 'Hello!' }],
        })
      )
      expect(mockExecuteProviderRequest.mock.calls[0][1]).not.toHaveProperty('context')
      expect(mockExecuteProviderRequest.mock.calls[0][1]).not.toHaveProperty('systemPrompt')
    })

    it('leaves optional model settings unset when omitted', async () => {
      mockGetProviderFromModel.mockReturnValue('openai')
      await handler.execute(mockBlock, { model: 'gpt-5.4', userPrompt: 'Hello!' }, mockContext)
      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(requestBody.reasoningEffort).toBeUndefined()
      expect(requestBody.verbosity).toBeUndefined()
      expect(requestBody.thinkingLevel).toBeUndefined()
    })
  })
})
