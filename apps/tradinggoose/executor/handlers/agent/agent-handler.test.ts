import { InMemoryStore } from '@mastra/core/storage'
import { Memory } from '@mastra/memory'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import type { TraceSpan } from '@/lib/logs/types'
import { setManagedProviders } from '@/lib/mastra/__test-utils__/managed-services'
import { createConfiguredLanguageModel } from '@/lib/mastra/connections'
import { getNativeModelLookup } from '@/lib/mastra/registry'
import { getInferenceFacts, withInferenceFacts } from '@/lib/mastra/result'
import { getAgentMemory, getNativeMemoryStore } from '@/lib/mastra/runtime'
import { sumNativeUsage } from '@/lib/mastra/usage'
import { mcpService } from '@/lib/mcp/service'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { createChatOutputEventReader } from '@/lib/workflows/chat-output'
import { AgentBlock } from '@/blocks/blocks/agent'
import { getBlock } from '@/blocks/index'

vi.mock('@/lib/mastra/connections', async (original) => ({
  ...(await original<typeof import('@/lib/mastra/connections')>()),
  createConfiguredLanguageModel: vi.fn(() => state.model),
}))
vi.mock('@/lib/mastra/usage-processors', () => ({
  usageProcessors: async (scope: unknown) => {
    state.finance(scope)
    const signal = (scope as { signal: AbortSignal }).signal
    const completed = new Map<string, { usage: any }>()
    return {
      inputProcessors: state.trackAdmissions
        ? [
            {
              id: 'fixture-live-tool-admission',
              processInputStep: (args: {
                stepNumber: number
                retryCount: number
                runId?: string
              }) => {
                signal.throwIfAborted()
                state.admissions(args.stepNumber)
              },
            },
          ]
        : [],
      outputProcessors: [
        {
          id: 'fixture-live-tool-completed-response',
          processOutputStep: (args: any) => {
            const key = JSON.stringify([args.stepNumber, args.retryCount])
            completed.set(key, { usage: args.usage })
          },
        },
      ],
      getUsage: () => sumNativeUsage([...completed.values()]),
      getCost: () => state.nativeCost,
      verifyComplete: async () => {
        if (state.trackAdmissions) signal.throwIfAborted()
        if (state.completionError) throw state.completionError
      },
    }
  },
}))
vi.mock('@/lib/mastra/runtime', () => ({
  getMastra: async () => undefined,
  getAgentMemory: async () => state.memory,
  getNativeMemoryStore: async () => state.storage.getStore('memory'),
}))

import { Agent } from '@mastra/core/agent'
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Executor } from '@/executor'
import { createMinimalWorkflow } from '@/executor/__test-utils__/executor-mocks'
import {
  AgentBlockHandler,
  createAgentToolSet,
  createForcedToolPolicy,
} from '@/executor/handlers/agent/agent-handler'
import { InputResolver } from '@/executor/resolver/resolver'
import type { ExecutionContext, StreamingExecution } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'

const state = vi.hoisted(() => ({
  storage: undefined as unknown as InMemoryStore,
  memory: undefined as unknown as Memory,
  finance: vi.fn(),
  trackAdmissions: false,
  admissions: vi.fn(),
  model: null as any,
  configurations: [] as any[],
  setupError: undefined as Error | undefined,
  completionError: undefined as Error | undefined,
  nativeCost: { status: 'unavailable' } as Record<string, unknown>,
}))
vi.mock('@mastra/core/agent', async (original) => {
  const native = await original<typeof import('@mastra/core/agent')>()
  return {
    ...native,
    Agent: class extends native.Agent {
      constructor(configuration: any) {
        state.configurations.push(configuration)
        if (state.setupError) throw state.setupError
        super({ ...configuration, model: state.model })
      }
    },
  }
})
vi.mock('@/lib/mcp/service', () => ({ mcpService: { discoverServerTools: vi.fn() } }))
vi.mock('@/lib/permissions/utils', () => ({ getUserEntityPermissions: vi.fn() }))
vi.mock('@/blocks', () => ({ getAllBlocks: vi.fn(() => []), getBlock: vi.fn() }))
vi.mock('@/tools', () => ({ executeTool: vi.fn(), getToolAsync: vi.fn() }))
vi.mock('@/tools/utils', () => ({ getTool: vi.fn() }))
vi.mock('@/executor/handlers/agent/skills-resolver', () => ({
  resolveSkillMetadata: vi.fn(async () => []),
}))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

const usage = { inputTokens: 2, outputTokens: 3, totalTokens: 5 }
function fixture(text = 'Native response') {
  return new MastraLanguageModelV2Mock({
    doGenerate: async (options) => ({
      content:
        options.toolChoice?.type === 'tool'
          ? [
              {
                type: 'tool-call' as const,
                toolCallId: crypto.randomUUID(),
                toolName: options.toolChoice.toolName,
                input: '{"query":"generated"}',
              },
            ]
          : [{ type: 'text' as const, text }],
      finishReason: options.toolChoice?.type === 'tool' ? 'tool-calls' : 'stop',
      usage,
      warnings: [],
    }),
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text-start', id: 'text' })
          controller.enqueue({ type: 'text-delta', id: 'text', delta: text })
          controller.enqueue({ type: 'text-end', id: 'text' })
          controller.enqueue({ type: 'finish', finishReason: 'stop', usage })
          controller.close()
        },
      }),
    }),
  })
}
const block = {
  id: 'agent-1',
  metadata: { id: 'agent', name: 'Agent' },
  config: { params: {} },
} as SerializedBlock
function context(overrides: Partial<ExecutionContext> = {}) {
  return {
    workspaceId: 'workspace-1',
    executionId: 'execution-1',
    workflowLogId: 'log-1',
    userId: 'user-1',
    workflowId: 'workflow-1',
    blockStates: new Map(),
    environmentVariables: {},
    workflowVariables: {},
    ...overrides,
  } as ExecutionContext
}

function createOwnedTestToolSet(
  configured: Parameters<typeof createAgentToolSet>[0],
  scope: Record<string, any>
) {
  const abortController = new AbortController()
  return createAgentToolSet(configured, scope, undefined, {
    signal: abortController.signal,
    abort: (reason) => abortController.abort(reason),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.storage = new InMemoryStore()
  state.memory = new Memory({
    storage: state.storage,
    options: {
      messageHistory: { maxTokens: 32000 },
      semanticRecall: false,
      workingMemory: { enabled: false },
      generateTitle: false,
    },
  })
  state.model = fixture()
  state.trackAdmissions = false
  state.setupError = undefined
  state.completionError = undefined
  state.nativeCost = { status: 'unavailable' }
  state.configurations.length = 0
  vi.mocked(executeTool).mockResolvedValue({ success: true, output: { found: true } })
  vi.mocked(getUserEntityPermissions).mockResolvedValue('read')
  vi.mocked(mcpService.discoverServerTools).mockResolvedValue([
    {
      name: 'lookup',
      description: 'MCP lookup',
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      serverName: 'Research',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          arguments: { type: 'string' },
          _context: { type: 'object' },
        },
        required: ['query'],
      },
    },
  ])
})

afterEach(() => vi.unstubAllGlobals())

describe('configured endpoint response schemas', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.mocked(getBlock).mockReset()
  })

  it.each([
    { provider: 'openai', valid: true },
    { provider: 'custom', valid: true },
    { provider: 'openai', valid: false },
    { provider: 'custom', valid: false },
  ])(
    'preserves and validates the configured $provider schema (valid=$valid)',
    async ({ provider, valid }) => {
      const model = `${provider}/gpt-3.5-turbo`
      setManagedProviders({
        [provider]: {
          name: 'Configured',
          url: 'https://endpoint.invalid/v1',
          models: ['gpt-3.5-turbo'],
        },
      })

      const responseFormat = {
        schema: {
          type: 'object',
          properties: { answer: { type: 'number' } },
          required: ['answer'],
          additionalProperties: false,
        },
      }
      const workflow = createMinimalWorkflow()
      const agentBlock = workflow.blocks[1]
      agentBlock.metadata!.id = 'agent'
      agentBlock.config = { tool: 'agent', params: { model, responseFormat, userPrompt: 'Answer' } }
      vi.mocked(getBlock).mockReturnValue(AgentBlock)
      const inputs = new InputResolver(workflow, {}, {}, new Map()).resolveInputs(
        agentBlock,
        context(),
        await getNativeModelLookup()
      )
      expect(inputs.responseFormat).toEqual(responseFormat)

      const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://endpoint.invalid/v1/chat/completions')
        const body = JSON.parse(String(init?.body))
        expect(body.model).toBe('gpt-3.5-turbo')
        expect(body.response_format).toMatchObject({
          type: 'json_schema',
          json_schema: { schema: responseFormat.schema },
        })
        return Response.json({
          id: 'chatcmpl_schema',
          object: 'chat.completion',
          created: 0,
          model: body.model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify({ answer: valid ? 42 : 'invalid' }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        })
      })
      vi.stubGlobal('fetch', fetcher)
      const native = await vi.importActual<typeof import('@/lib/mastra/connections')>(
        '@/lib/mastra/connections'
      )
      state.model = await native.createConfiguredLanguageModel(model, 'fixture-key')
      const execution = new AgentBlockHandler().execute(agentBlock, inputs, context())
      if (valid) await expect(execution).resolves.toMatchObject({ answer: 42 })
      else await expect(execution).rejects.toThrow()
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  )
})

describe('native Agent workflow execution', () => {
  it.each([
    { apiKey: undefined, funding: 'account' },
    { apiKey: '', funding: 'account' },
    { apiKey: 'caller-key', funding: 'byok' },
  ])(
    'derives $funding workflow funding from the actual key override $apiKey',
    async ({ apiKey, funding }) => {
      await new AgentBlockHandler().execute(
        block,
        { model: 'openai/gpt-4.1', apiKey, userPrompt: 'Answer' },
        context()
      )
      expect(state.finance).toHaveBeenCalledWith(
        expect.objectContaining({ funding, actorUserId: 'user-1', workflowId: 'workflow-1' })
      )
      expect(JSON.stringify(state.finance.mock.calls)).not.toContain('caller-key')
    }
  )

  it.each(
    [0, -1, 1.5, Number.POSITIVE_INFINITY, 'invalid', '0', false, [], {}].map((maxSteps) => ({
      maxSteps,
    }))
  )(
    'rejects invalid Max Steps $maxSteps before admission or model contact',
    async ({ maxSteps }) => {
      await expect(
        new AgentBlockHandler().execute(
          block,
          { model: 'openai/gpt-4.1', maxSteps: maxSteps as any },
          context()
        )
      ).rejects.toThrow('Max Steps must be a positive integer')
      expect(state.finance).not.toHaveBeenCalled()
      expect(state.configurations).toHaveLength(0)
    }
  )

  it.each(['auto', 'force'] as const)(
    'rejects an unavailable selected %s tool before model contact',
    async (usageControl) => {
      await expect(
        new AgentBlockHandler().execute(
          block,
          {
            model: 'openai/gpt-4.1',
            tools: [{ type: 'missing-block', usageControl }],
          },
          context()
        )
      ).rejects.toThrow('Block definition not found')
      expect(state.finance).not.toHaveBeenCalled()
      expect(state.configurations).toEqual([])
      expect(state.model.doGenerateCalls).toEqual([])
    }
  )

  it('preserves literal working-memory tags and surrounding code through actual native turns', async () => {
    const userText =
      ' \n\tBefore user\n```xml\n<working_memory>literal user 🔥</working_memory>\n```\nAfter user\t \n'
    const assistantText =
      '\t \nBefore assistant\n```ts\nconst literal = "<working_memory>literal assistant 🔥</working_memory>"\n```\nAfter assistant \n\t'
    const memories = [
      { role: 'user' as const, content: userText },
      { role: 'assistant' as const, content: assistantText },
    ]
    state.model = fixture(assistantText)
    const handler = new AgentBlockHandler()
    const first = await handler.execute(
      block,
      { model: 'openai/gpt-4.1', memories, userPrompt: userText },
      context()
    )
    if (first === null || typeof first !== 'object' || !('content' in first))
      throw new Error('Expected completed first-turn content')
    const firstSelected = [...memories, { role: 'user', content: userText }]
    expect(first.content).toBe(assistantText)
    expect(
      state.model.doGenerateCalls[0].prompt
        .filter((message: any) => ['user', 'assistant'].includes(message.role))
        .map((message: any) => ({
          role: message.role,
          content: message.content
            .filter((part: any) => part.type === 'text')
            .map((part: any) => part.text)
            .join(''),
        }))
    ).toEqual(firstSelected)

    const nextUserText = `${userText}\tLater question \n`
    const laterMemories = [...firstSelected, { role: 'assistant', content: first.content }]
    const later = await handler.execute(
      block,
      { model: 'openai/gpt-4.1', memories: laterMemories, userPrompt: nextUserText },
      context()
    )
    if (later === null || typeof later !== 'object' || !('content' in later))
      throw new Error('Expected completed later-turn content')
    const laterSelected = [...laterMemories, { role: 'user', content: nextUserText }]
    expect(later.content).toBe(assistantText)
    expect(
      state.model.doGenerateCalls[1].prompt
        .filter((message: any) => ['user', 'assistant'].includes(message.role))
        .map((message: any) => ({
          role: message.role,
          content: message.content
            .filter((part: any) => part.type === 'text')
            .map((part: any) => part.text)
            .join(''),
        }))
    ).toEqual(laterSelected)
    expect(state.configurations).toHaveLength(2)
    for (const configuration of state.configurations) {
      expect(configuration).toHaveProperty('memory')
      expect(configuration.mastra).toBeUndefined()
    }
  })

  it('preserves prompts, memory, model and known tokens when dollars are unavailable', async () => {
    const handler = new AgentBlockHandler()
    const result = await handler.execute(
      block,
      {
        model: 'openai/gpt-4.1',
        systemPrompt: 'Follow the policy',
        userPrompt: 'Current question',
        memories: [
          { role: 'user', content: 'Previous question' },
          { role: 'assistant', content: 'Previous answer' },
        ],
        maxTokens: 73,
        temperature: 0,
      },
      context()
    )
    expect(result).toMatchObject({
      content: 'Native response',
      model: 'openai/gpt-4.1',
      tokens: { prompt: 2, completion: 3, total: 5 },
      cost: { status: 'unavailable' },
    })
    expect(state.model.doGenerateCalls[0].maxOutputTokens).toBe(73)
    expect(state.model.doGenerateCalls[0].temperature).toBe(0)
    expect(JSON.stringify(state.model.doGenerateCalls[0].prompt)).toContain('Follow the policy')
    expect(JSON.stringify(state.model.doGenerateCalls[0].prompt)).toContain('Previous answer')
  })

  it('exposes validated structured fields as downstream workflow references', async () => {
    state.model = fixture('{"answer":42}')
    const output = await new AgentBlockHandler().execute(
      block,
      {
        model: 'openai/gpt-4.1',
        userPrompt: 'Return answer',
        responseFormat: {
          name: 'answer',
          schema: {
            type: 'object',
            properties: { answer: { type: 'number' } },
            required: ['answer'],
            additionalProperties: false,
          },
        },
      },
      context()
    )
    expect(output).toMatchObject({ answer: 42, model: 'openai/gpt-4.1', tokens: { total: 5 } })
    expect(output).not.toHaveProperty('content')
  })

  it('rejects bare and unlisted resolved identifiers without silently substituting a model', async () => {
    await expect(
      new AgentBlockHandler().execute(block, { model: 'gpt-4.1' }, context())
    ).rejects.toThrow()
    await expect(
      new AgentBlockHandler().execute(block, { model: 'openai/not-a-listed-model' }, context())
    ).rejects.toThrow()
    expect(state.configurations).toHaveLength(0)
  })

  it('keeps request-local credentials isolated and forwards native provider options', async () => {
    const handler = new AgentBlockHandler()
    const original = process.env.OPENAI_API_KEY
    await handler.execute(
      block,
      {
        model: 'openai/gpt-4.1',
        apiKey: 'tenant-one',
        providerOptions: '{"openai":{"reasoningEffort":"low"}}',
      },
      context()
    )
    await handler.execute(block, { model: 'openai/gpt-4.1', apiKey: 'tenant-two' }, context())
    expect(
      vi.mocked(createConfiguredLanguageModel).mock.calls.map(([_model, apiKey]) => apiKey)
    ).toEqual(['tenant-one', 'tenant-two'])
    expect(state.model.doGenerateCalls[0].providerOptions).toMatchObject({
      openai: { reasoningEffort: 'low' },
    })
    expect(process.env.OPENAI_API_KEY).toBe(original)
  })

  it('streams native text and retains final workflow metadata', async () => {
    const result = (await new AgentBlockHandler().execute(
      block,
      {
        model: 'openai/gpt-4.1',
        userPrompt: 'Stream it',
      },
      context({ stream: true })
    )) as StreamingExecution
    expect(await new Response(result.stream).text()).toBe('Native response')
    expect(result.execution.output).toMatchObject({
      content: 'Native response',
      tokens: { total: 5 },
      cost: { status: 'unavailable' },
    })
  })

  it.each([
    {
      name: 'tool-free text',
      tools: false,
      usageControl: 'auto',
      maxSteps: 5,
      structured: false,
    },
    {
      name: 'reserved final step',
      tools: true,
      usageControl: 'auto',
      maxSteps: 1,
      structured: false,
    },
    {
      name: 'completed forced tool',
      tools: true,
      usageControl: 'force',
      maxSteps: 2,
      structured: false,
    },
    {
      name: 'early tool-enabled answer',
      tools: true,
      usageControl: 'auto',
      maxSteps: 5,
      structured: false,
    },
    {
      name: 'structured answer',
      tools: false,
      usageControl: 'auto',
      maxSteps: 1,
      structured: true,
    },
  ] as const)('delivers $name after native completion and validation', async (scenario) => {
    const parts = scenario.structured ? ['{"answer":', '42}'] : ['Final ', 'answer']
    let finish: (() => void) | undefined
    state.model = new MastraLanguageModelV2Mock({
      doStream: async (options) => ({
        stream: new ReadableStream({
          start(controller) {
            const forced = options.toolChoice?.type === 'tool'
            controller.enqueue({ type: 'text-start', id: 'text' })
            controller.enqueue({
              type: 'text-delta',
              id: 'text',
              delta: forced ? 'Searching...' : parts[0],
            })
            if (options.toolChoice?.type === 'tool') {
              controller.enqueue({ type: 'text-end', id: 'text' })
              controller.enqueue({
                type: 'tool-call',
                toolCallId: 'streamed-lookup',
                toolName: options.toolChoice.toolName,
                input: '{"query":"lookup"}',
              })
              controller.enqueue({ type: 'finish', finishReason: 'tool-calls', usage })
              controller.close()
              return
            }
            finish = () => {
              controller.enqueue({ type: 'text-delta', id: 'text', delta: parts[1] })
              controller.enqueue({ type: 'text-end', id: 'text' })
              controller.enqueue({ type: 'finish', finishReason: 'stop', usage })
              controller.close()
            }
          },
        }),
      }),
    })
    const result = (await new AgentBlockHandler().execute(
      block,
      {
        model: 'openai/gpt-4.1',
        userPrompt: 'Answer using available information',
        maxSteps: scenario.maxSteps,
        tools: scenario.tools
          ? [
              {
                type: 'custom-tool',
                toolId: 'custom_lookup',
                usageControl: scenario.usageControl,
                schema: {
                  function: {
                    description: 'Lookup',
                    parameters: {
                      type: 'object',
                      properties: { query: { type: 'string' } },
                      required: ['query'],
                    },
                  },
                },
              },
            ]
          : [],
        responseFormat: scenario.structured
          ? {
              schema: {
                type: 'object',
                properties: { answer: { type: 'number' } },
                required: ['answer'],
                additionalProperties: false,
              },
            }
          : undefined,
      },
      context({ stream: true })
    )) as StreamingExecution
    const reader = result.stream.getReader()
    const decoder = new TextDecoder()
    let received = false
    const firstRead = reader.read().then((chunk) => {
      received = true
      return chunk
    })
    let text = ''
    try {
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(received).toBe(false)
      expect(result.execution.output).toEqual({})
    } finally {
      finish?.()
      text += decoder.decode((await firstRead).value)
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        text += decoder.decode(value)
      }
    }
    expect(text).toBe(parts.join(''))
    expect(text).not.toContain('Searching...')
    expect(result.execution.success).toBe(true)
    expect(result.execution.output).toMatchObject(
      scenario.structured ? { answer: 42 } : { content: 'Final answer' }
    )
    expect(result.execution.output.tokens).toMatchObject({
      total: scenario.usageControl === 'force' ? 10 : 5,
    })
  })

  it.each(['options', 'schema', 'native setup'])(
    'does not start cancellation polling when %s rejects before generation',
    async (failure) => {
      vi.useFakeTimers()
      try {
        const shouldCancelExecution = vi.fn(async () => false)
        if (failure === 'native setup') state.setupError = new Error('Native setup rejected')
        await expect(
          new AgentBlockHandler().execute(
            block,
            {
              model: 'openai/gpt-4.1',
              ...(failure === 'options' ? { providerOptions: '{"openai":null}' } : {}),
              ...(failure === 'schema' ? { responseFormat: { schema: [] } } : {}),
            },
            context({ shouldCancelExecution })
          )
        ).rejects.toThrow()
        expect(state.model.doGenerateCalls).toHaveLength(0)
        expect(vi.getTimerCount()).toBe(0)
        await vi.advanceTimersByTimeAsync(3000)
        expect(shouldCancelExecution).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    }
  )
})

describe('native Agent MCP integration', () => {
  const selected = {
    type: 'mcp',
    params: {
      serverId: '550e8400-e29b-41d4-a716-446655440000',
      toolName: 'lookup',
      query: 'fixed query',
      arguments: 'application input',
      _context: { userId: 'application user' },
    },
    usageControl: 'force' as const,
  }
  it.each(['auto', 'force'] as const)(
    'keeps colliding long MCP names and repeated instances distinct in %s mode',
    async (usageControl) => {
      const toolNames = ['get_customer_details_v1', 'get_customer_details_v2']
      vi.mocked(mcpService.discoverServerTools).mockResolvedValue(
        toolNames.map((name) => ({
          name,
          serverId: selected.params.serverId,
          serverName: 'Customer service',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        }))
      )
      const selections = [toolNames[0], toolNames[1], toolNames[0]].map((toolName, index) => ({
        ...selected,
        usageControl,
        params: { serverId: selected.params.serverId, toolName, query: `customer-${index}` },
      }))
      let round = 0
      state.model = new MastraLanguageModelV2Mock({
        doGenerate: async (options) => {
          const index = round++
          const calling = index < selections.length
          return {
            content: calling
              ? [
                  {
                    type: 'tool-call',
                    toolCallId: `customer-call-${index}`,
                    toolName: options.tools![usageControl === 'force' ? 0 : index].name,
                    input: '{"query":"generated"}',
                  },
                ]
              : [{ type: 'text', text: 'Customers found' }],
            finishReason: calling ? 'tool-calls' : 'stop',
            usage,
            warnings: [],
          }
        },
      })
      const result = await new AgentBlockHandler().execute(
        block,
        { model: 'openai/gpt-4.1', tools: selections },
        context()
      )
      expect(result).toMatchObject({ content: 'Customers found' })
      const names = Object.keys(state.configurations[0].tools)
      expect(names).toHaveLength(3)
      expect(new Set(names).size).toBe(3)
      expect(names.every((name) => /^[a-zA-Z_][a-zA-Z0-9_-]{0,62}$/.test(name))).toBe(true)
      const calls = state.model.doGenerateCalls
      expect(calls).toHaveLength(4)
      expect(calls.map((call: any) => call.toolChoice)).toEqual(
        usageControl === 'force'
          ? [...names.map((toolName) => ({ type: 'tool', toolName })), { type: 'auto' }]
          : Array.from({ length: 4 }, () => ({ type: 'auto' }))
      )
      if (usageControl === 'auto')
        expect(calls[0].tools.map((tool: any) => tool.name)).toEqual(names)
      expect(
        vi.mocked(executeTool).mock.calls.map(([id, args]) => ({
          id,
          serverId: args.serverId,
          toolName: args.toolName,
          query: args.arguments.query,
        }))
      ).toEqual(
        selections.map(({ params }) => ({
          id: 'mcp',
          serverId: params.serverId,
          toolName: params.toolName,
          query: params.query,
        }))
      )
    }
  )
  it.each(['custom', 'mcp'])(
    'preserves %s dictionary schemas and arguments through the actual OpenAI request and shared dispatch',
    async (kind) => {
      const parameters = {
        type: 'object',
        properties: {
          headers: { type: 'object', additionalProperties: { type: 'string' } },
          payload: { type: 'object' },
        },
        required: ['headers', 'payload'],
      }
      const args = { headers: { 'x-value': 'kept' }, payload: { dynamic: { nested: true } } }
      const requests: any[] = []
      vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.openai.com/v1/responses')
        const body = JSON.parse(String(init?.body))
        requests.push(body)
        return Response.json({
          id: `resp_${requests.length}`,
          object: 'response',
          created_at: 0,
          model: body.model,
          status: 'completed',
          output:
            requests.length === 1
              ? [
                  {
                    id: 'call',
                    type: 'function_call',
                    call_id: 'dictionary-call',
                    name: body.tools[0].name,
                    arguments: JSON.stringify(args),
                    status: 'completed',
                  },
                ]
              : [
                  {
                    id: 'answer',
                    type: 'message',
                    role: 'assistant',
                    status: 'completed',
                    content: [{ type: 'output_text', text: 'Done', annotations: [] }],
                  },
                ],
          usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
        })
      })
      vi.mocked(mcpService.discoverServerTools).mockResolvedValue([
        {
          name: 'lookup',
          serverId: selected.params.serverId,
          serverName: 'Research',
          inputSchema: parameters,
        },
      ])
      const native = await vi.importActual<typeof import('@/lib/mastra/connections')>(
        '@/lib/mastra/connections'
      )
      state.model = await native.createConfiguredLanguageModel('openai/gpt-4.1', 'fixture-key')
      const configured =
        kind === 'mcp'
          ? {
              type: 'mcp',
              params: { serverId: selected.params.serverId, toolName: 'lookup' },
              usageControl: 'force' as const,
            }
          : {
              type: 'custom-tool',
              toolId: 'custom_dictionary',
              title: 'Dictionary',
              schema: { function: { description: 'Receive dictionaries', parameters } },
              usageControl: 'force' as const,
            }
      const result = await new AgentBlockHandler().execute(
        block,
        { model: 'openai/gpt-4.1', tools: [configured] },
        context()
      )
      expect(result).toMatchObject({ content: 'Done', tokens: { total: 10 } })
      expect(requests).toHaveLength(2)
      expect(requests[0].tools[0]).toMatchObject({
        strict: false,
        parameters: { properties: parameters.properties },
      })
      const [id, dispatched] = vi.mocked(executeTool).mock.calls[0]
      expect(id).toBe(kind === 'mcp' ? 'mcp' : 'custom_dictionary')
      expect(kind === 'mcp' ? dispatched.arguments : dispatched).toMatchObject(args)
      if (kind === 'mcp')
        expect(dispatched).toMatchObject({ serverId: selected.params.serverId, toolName: 'lookup' })
    }
  )
  it.each(['auto', 'force'] as const)(
    'dispatches a long MCP identity using Mastra-normalized %s selection',
    async (usageControl) => {
      const toolName = 'get_graphql_type_schema'
      const nativeName = `mcp-${selected.params.serverId}-${toolName}`.slice(0, 63)
      vi.mocked(mcpService.discoverServerTools).mockResolvedValue([
        {
          name: toolName,
          serverId: selected.params.serverId,
          serverName: 'Research',
          inputSchema: { type: 'object' },
        },
      ])
      let first = true
      state.model = new MastraLanguageModelV2Mock({
        doGenerate: async (options) => {
          const callTool = first
          first = false
          return {
            content: callTool
              ? [
                  {
                    type: 'tool-call',
                    toolCallId: 'schema-call',
                    toolName: options.tools![0].name,
                    input: '{}',
                  },
                ]
              : [{ type: 'text', text: 'Schema answer' }],
            finishReason: callTool ? 'tool-calls' : 'stop',
            usage,
            warnings: [],
          }
        },
      })
      const result = await new AgentBlockHandler().execute(
        block,
        {
          model: 'openai/gpt-4.1',
          tools: [{ ...selected, usageControl, params: { ...selected.params, toolName } }],
        },
        context()
      )
      expect(result).toMatchObject({ content: 'Schema answer' })
      expect(state.model.doGenerateCalls[0].tools.map((tool: any) => tool.name)).toEqual([
        nativeName,
      ])
      expect(state.model.doGenerateCalls[0].toolChoice).toEqual(
        usageControl === 'force' ? { type: 'tool', toolName: nativeName } : { type: 'auto' }
      )
      expect(executeTool).toHaveBeenCalledExactlyOnceWith(
        'mcp',
        expect.objectContaining({ serverId: selected.params.serverId, toolName }),
        false,
        expect.anything(),
        expect.anything()
      )
    }
  )
  it.each([false, true])(
    'uses workspace-authorized discovery and the shared execution path (deployed=%s)',
    async (isDeployedContext) => {
      const fetcher = vi.fn()
      vi.stubGlobal('fetch', fetcher)
      await new AgentBlockHandler().execute(
        block,
        { model: 'openai/gpt-4.1', tools: [selected] },
        context({ isDeployedContext })
      )
      expect(getUserEntityPermissions).toHaveBeenCalledWith('user-1', 'workspace', 'workspace-1')
      expect(mcpService.discoverServerTools).toHaveBeenCalledWith(
        'user-1',
        '550e8400-e29b-41d4-a716-446655440000',
        'workspace-1',
        isDeployedContext
      )
      expect(executeTool).toHaveBeenCalledOnce()
      const [toolId, params, skipPostProcess, execution, options] =
        vi.mocked(executeTool).mock.calls[0]
      expect(toolId).toBe('mcp')
      expect(params).toMatchObject({
        serverId: '550e8400-e29b-41d4-a716-446655440000',
        toolName: 'lookup',
        arguments: {
          query: 'fixed query',
          arguments: 'application input',
          _context: { userId: 'application user' },
        },
        _context: {
          userId: 'user-1',
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
          isDeployedContext,
        },
      })
      expect(skipPostProcess).toBe(false)
      expect(execution?.userId).toBe('user-1')
      expect(options?.signal).toBeInstanceOf(AbortSignal)
      expect(fetcher).not.toHaveBeenCalled()
      expect(state.model.doGenerateCalls).toHaveLength(2)
    }
  )
  it('rejects non-object MCP schemas before model contact', async () => {
    vi.mocked(mcpService.discoverServerTools).mockResolvedValueOnce([
      {
        name: 'lookup',
        serverId: '550e8400-e29b-41d4-a716-446655440000',
        serverName: 'Research',
        inputSchema: { type: 'array' },
      },
    ])
    await expect(
      new AgentBlockHandler().execute(
        block,
        { model: 'openai/gpt-4.1', tools: [selected] },
        context()
      )
    ).rejects.toThrow('MCP input schema must be an object')
    expect(executeTool).not.toHaveBeenCalled()
    expect(state.model.doGenerateCalls).toEqual([])
  })
  it('rejects revoked workspace access before discovery', async () => {
    vi.mocked(getUserEntityPermissions).mockResolvedValueOnce(null)
    await expect(
      new AgentBlockHandler().execute(
        block,
        { model: 'openai/gpt-4.1', tools: [selected] },
        context()
      )
    ).rejects.toThrow('Workspace access required')
    expect(mcpService.discoverServerTools).not.toHaveBeenCalled()
    expect(executeTool).not.toHaveBeenCalled()
    expect(state.model.doGenerateCalls).toEqual([])
  })
})

describe('native named Force tools', () => {
  const schema = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  it('uses the native name for invalid characters and a leading digit while dispatching the original ID', async () => {
    const configured = [
      { id: '9.lookup', description: 'Lookup', parameters: schema, usageControl: 'force' as const },
    ]
    const tools = createOwnedTestToolSet(configured, context())
    const policy = createForcedToolPolicy(configured)
    const result = await new Agent({
      id: 'normalized',
      name: 'Normalized',
      instructions: '',
      model: state.model,
      tools,
    }).generate('Lookup', { maxSteps: 2, prepareStep: policy.prepareStep })
    policy.assertComplete(result.steps)
    expect(state.model.doGenerateCalls[0].toolChoice).toEqual({
      type: 'tool',
      toolName: '_9_lookup',
    })
    expect(vi.mocked(executeTool).mock.calls[0][0]).toBe('9.lookup')
  })

  it.each([
    { ids: [`${'lookup_'.repeat(9)}a`, `${'lookup_'.repeat(9)}b`] },
    { ids: ['lookup.value', 'lookup/value'] },
    { ids: ['9.lookup', '_9_lookup'] },
    { ids: ['same_operation', 'same_operation', 'same_operation__instance_1'] },
  ])('allocates unique native names for $ids without changing dispatch', async ({ ids }) => {
    const configured = ids.map((id, index) => ({
      id,
      description: 'Lookup',
      parameters: schema,
      params: { query: `fixed-${index}` },
      usageControl: 'force' as const,
    }))
    const tools = createOwnedTestToolSet(configured, context())
    const names = Object.keys(tools)
    const policy = createForcedToolPolicy(configured)
    const result = await new Agent({
      id: 'collision',
      name: 'Collision',
      instructions: '',
      model: state.model,
      tools,
    }).generate('Lookup', { maxSteps: ids.length + 1, prepareStep: policy.prepareStep })
    policy.assertComplete(result.steps)
    expect(names).toHaveLength(ids.length)
    expect(names.every((name) => /^[a-zA-Z_][a-zA-Z0-9_-]{0,62}$/.test(name))).toBe(true)
    expect(state.model.doGenerateCalls.map((call: any) => call.toolChoice)).toEqual([
      ...names.map((toolName) => ({ type: 'tool', toolName })),
      { type: 'auto' },
    ])
    expect(vi.mocked(executeTool).mock.calls.map(([id, params]) => [id, params.query])).toEqual(
      ids.map((id, index) => [id, `fixed-${index}`])
    )
  })

  it('runs two forced tools in configured order, then Auto; None stays unexposed and fixed args/context survive', async () => {
    const configured = [
      {
        id: 'first',
        description: 'First lookup',
        parameters: schema,
        params: { query: 'fixed' },
        usageControl: 'force' as const,
      },
      {
        id: 'second',
        description: 'Second lookup',
        parameters: schema,
        usageControl: 'force' as const,
      },
      {
        id: 'excluded',
        description: 'Never expose',
        parameters: schema,
        usageControl: 'none' as const,
      },
    ]
    const tools = createOwnedTestToolSet(configured, context())
    const policy = createForcedToolPolicy(configured)
    const agent = new Agent({
      id: 'forced',
      name: 'Forced',
      instructions: '',
      model: state.model,
      tools,
    })
    const result = await agent.generate('Look up both', {
      maxSteps: 5,
      prepareStep: policy.prepareStep,
      activeTools: Object.keys(tools),
    })
    policy.assertComplete(result.steps)
    expect(state.model.doGenerateCalls.map((call: any) => call.toolChoice)).toEqual([
      { type: 'tool', toolName: 'first' },
      { type: 'tool', toolName: 'second' },
      { type: 'auto' },
    ])
    expect(
      state.model.doGenerateCalls.every((call: any) =>
        call.tools.every((tool: any) => tool.name !== 'excluded')
      )
    ).toBe(true)
    expect(vi.mocked(executeTool).mock.calls[0][0]).toBe('first')
    expect(vi.mocked(executeTool).mock.calls[0][1]).toMatchObject({
      query: 'fixed',
      _context: { userId: 'user-1', workspaceId: 'workspace-1', workflowId: 'workflow-1' },
    })
    expect(result.text).toBe('Native response')
  })

  it('binds repeated native instances to their own fixed arguments and original application ID', async () => {
    const configured = ['first', 'second'].map((query) => ({
      id: 'same_operation',
      description: 'Operation',
      parameters: schema,
      params: { query },
      usageControl: 'force' as const,
    }))
    const tools = createOwnedTestToolSet(configured, context())
    expect(Object.keys(tools)).toHaveLength(2)
    expect(Object.keys(createOwnedTestToolSet(configured, context()))).toEqual(Object.keys(tools))
    const policy = createForcedToolPolicy(configured)
    const result = await new Agent({
      id: 'duplicates',
      name: 'Duplicates',
      instructions: '',
      model: state.model,
      tools,
    }).generate('Run both', {
      maxSteps: 4,
      activeTools: Object.keys(tools),
      prepareStep: policy.prepareStep,
    })
    policy.assertComplete(result.steps)
    expect(vi.mocked(executeTool).mock.calls.map(([id, args]) => [id, args.query])).toEqual([
      ['same_operation', 'first'],
      ['same_operation', 'second'],
    ])
    expect(state.model.doGenerateCalls.map((call: any) => call.toolChoice)).toEqual([
      ...Object.keys(tools).map((toolName) => ({ type: 'tool', toolName })),
      { type: 'auto' },
    ])
    const auto = configured.map((tool) => ({ ...tool, usageControl: 'auto' as const }))
    expect(createForcedToolPolicy(auto).prepareStep({ steps: [], tools }).activeTools).toEqual(
      Object.keys(tools)
    )
  })

  it('fails actionably when the native run ends without completing its forced sequence', async () => {
    state.model = new MastraLanguageModelV2Mock({
      doGenerate: async () => ({
        content: [{ type: 'text', text: 'No call' }],
        finishReason: 'stop',
        usage,
        warnings: [],
      }),
    })
    const configured = [
      {
        id: 'required_lookup',
        description: 'Lookup',
        parameters: schema,
        usageControl: 'force' as const,
      },
    ]
    const tools = createOwnedTestToolSet(configured, context())
    const policy = createForcedToolPolicy(configured)
    const result = await new Agent({
      id: 'unfinished',
      name: 'Unfinished',
      instructions: '',
      model: state.model,
      tools,
    }).generate('Look up', { maxSteps: 2, prepareStep: policy.prepareStep })
    expect(() => policy.assertComplete(result.steps)).toThrow(
      'did not complete forced tools: required_lookup'
    )
  })

  it('keeps Force pending when a tool call fails', async () => {
    vi.mocked(executeTool).mockResolvedValue({ success: false, output: {}, error: 'Denied' })
    const configured = [
      {
        id: 'denied',
        description: 'Denied tool',
        parameters: schema,
        usageControl: 'force' as const,
      },
    ]
    const tools = createOwnedTestToolSet(configured, context())
    const policy = createForcedToolPolicy(configured)
    const result = await new Agent({
      id: 'denied',
      name: 'Denied',
      instructions: '',
      model: state.model,
      tools,
    }).generate('Look up', { maxSteps: 2, prepareStep: policy.prepareStep })
    expect(() => policy.assertComplete(result.steps)).toThrow('did not complete forced tools')
    expect(state.model.doGenerateCalls).toHaveLength(2)
  })
})

describe('native forced sequence failures and completion accounting', () => {
  const schema = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  const customTool = {
    type: 'custom-tool',
    toolId: 'custom_lookup',
    title: 'Lookup',
    schema: { function: { description: 'Lookup', parameters: schema } },
    usageControl: 'force' as const,
  }
  it.each([
    { stream: false, maxSteps: 1, steps: 1 },
    { stream: true, maxSteps: '1', steps: 1 },
    { stream: false, maxSteps: 2, steps: 2 },
    { stream: true, maxSteps: '2', steps: 2 },
    { stream: false, maxSteps: undefined, steps: 5 },
    { stream: false, maxSteps: '', steps: 5 },
    { stream: false, maxSteps: '  ', steps: 5 },
    { stream: false, maxSteps: 5, steps: 5 },
  ])(
    'rejects noncompliance at native maxSteps $maxSteps (stream=$stream), retaining completed usage',
    async ({ stream, maxSteps, steps }) => {
      state.nativeCost = { total: 0.006, status: 'estimated' }
      const toolCall = () => ({
        type: 'tool-call' as const,
        toolCallId: crypto.randomUUID(),
        toolName: 'custom_lookup',
        input: '{"query":"keep searching"}',
      })
      state.model = new MastraLanguageModelV2Mock({
        doGenerate: async () => ({
          content: [{ type: 'text', text: 'Still searching' }, toolCall()],
          finishReason: 'tool-calls',
          usage,
          warnings: [],
        }),
        doStream: async () => ({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'text-start', id: 'text' })
              controller.enqueue({ type: 'text-delta', id: 'text', delta: 'Still searching' })
              controller.enqueue({ type: 'text-end', id: 'text' })
              controller.enqueue(toolCall())
              controller.enqueue({ type: 'finish', finishReason: 'tool-calls', usage })
              controller.close()
            },
          }),
        }),
      })
      let failure: unknown
      let streamed: StreamingExecution | undefined
      try {
        const result = await new AgentBlockHandler().execute(
          block,
          {
            model: 'openai/gpt-4.1',
            maxSteps,
            userPrompt: 'Search until done',
            tools: [{ ...customTool, usageControl: 'auto' }],
          },
          context({ stream })
        )
        if (stream) {
          streamed = result as StreamingExecution
          await new Response(streamed.stream).text()
        }
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(Error)
      expect((failure as Error).message).toContain('step limit')
      const accounted = streamed?.execution.output ?? failure
      expect(accounted).toMatchObject({
        tokens: { prompt: steps * 2, completion: steps * 3, total: steps * 5 },
        cost: { total: 0.006, status: 'estimated' },
      })
      expect(accounted).not.toHaveProperty('content')
      expect(getInferenceFacts(accounted)?.history).toBeDefined()
      expect(stream ? state.model.doStreamCalls : state.model.doGenerateCalls).toHaveLength(steps)
      expect(executeTool).toHaveBeenCalledTimes(steps - 1)
      const lastCall = (stream ? state.model.doStreamCalls : state.model.doGenerateCalls).at(-1)
      expect(lastCall).toMatchObject({ toolChoice: { type: 'none' }, tools: undefined })
      if (streamed) expect(streamed.execution.success).toBe(false)
    }
  )
  it.each(
    [false, true].flatMap((stream) =>
      [1, 2, 5, undefined, '', '  '].map((maxSteps) => ({
        stream,
        maxSteps,
        steps: typeof maxSteps === 'number' ? maxSteps : 5,
      }))
    )
  )(
    'reserves the final answer within native maxSteps $maxSteps (stream=$stream)',
    async ({ stream, maxSteps, steps }) => {
      const toolCall = () => ({
        type: 'tool-call' as const,
        toolCallId: crypto.randomUUID(),
        toolName: 'custom_lookup',
        input: '{"query":"keep searching"}',
      })
      state.model = new MastraLanguageModelV2Mock({
        doGenerate: async (options) => {
          const final = options.toolChoice?.type === 'none'
          return {
            content: final
              ? [{ type: 'text', text: 'Final answer from available results' }]
              : [{ type: 'text', text: 'Still searching' }, toolCall()],
            finishReason: final ? 'stop' : 'tool-calls',
            usage,
            warnings: [],
          }
        },
        doStream: async (options) => ({
          stream: new ReadableStream({
            start(controller) {
              const final = options.toolChoice?.type === 'none'
              controller.enqueue({ type: 'text-start', id: 'text' })
              controller.enqueue({
                type: 'text-delta',
                id: 'text',
                delta: final ? 'Final answer from available results' : 'Still searching',
              })
              controller.enqueue({ type: 'text-end', id: 'text' })
              if (!final) controller.enqueue(toolCall())
              controller.enqueue({
                type: 'finish',
                finishReason: final ? 'stop' : 'tool-calls',
                usage,
              })
              controller.close()
            },
          }),
        }),
      })
      const result = await new AgentBlockHandler().execute(
        block,
        {
          model: 'openai/gpt-4.1',
          maxSteps,
          systemPrompt: 'Respect the original policy',
          userPrompt: 'Search until done',
          tools: [{ ...customTool, usageControl: 'auto' }],
        },
        context({ stream })
      )
      let output: any
      if (stream) {
        const streamed = result as StreamingExecution
        expect(await new Response(streamed.stream).text()).toBe(
          'Final answer from available results'
        )
        expect(streamed.execution.success).toBe(true)
        output = streamed.execution.output
      } else output = result
      expect(output).toMatchObject({
        content: 'Final answer from available results',
        tokens: { prompt: steps * 2, completion: steps * 3, total: steps * 5 },
      })
      const calls = stream ? state.model.doStreamCalls : state.model.doGenerateCalls
      expect(calls).toHaveLength(steps)
      expect(executeTool).toHaveBeenCalledTimes(steps - 1)
      expect(calls.at(-1)).toMatchObject({ toolChoice: { type: 'none' }, tools: undefined })
      const finalPrompt = JSON.stringify(calls.at(-1).prompt)
      expect(finalPrompt).toContain('Respect the original policy')
      expect(finalPrompt).toContain('No model steps remain after this one')
      expect(finalPrompt).toContain('explain missing information instead of inventing it')
      for (const call of calls.slice(0, -1)) {
        expect(call.tools).toContainEqual(expect.objectContaining({ name: 'custom_lookup' }))
        expect(JSON.stringify(call.prompt)).not.toContain('No model steps remain after this one')
      }
    }
  )

  it.each([false, true])(
    'rejects an empty final answer, retaining usage (stream=%s)',
    async (stream) => {
      state.model = fixture(' \n\t ')
      const generate = new AgentBlockHandler().execute(
        block,
        { model: 'openai/gpt-4.1', maxSteps: 1 },
        context({ stream })
      )
      if (stream) {
        const result = (await generate) as StreamingExecution
        await expect(new Response(result.stream).text()).rejects.toThrow('final answer')
        expect(result.execution.output.tokens).toMatchObject({ total: 5 })
        expect(result.execution.success).toBe(false)
      } else await expect(generate).rejects.toMatchObject({ tokens: { total: 5 } })
    }
  )

  it('does not satisfy an unfinished Force tool by reserving a final-answer step', async () => {
    await expect(
      new AgentBlockHandler().execute(
        block,
        { model: 'openai/gpt-4.1', maxSteps: 1, tools: [customTool] },
        context()
      )
    ).rejects.toMatchObject({
      message: expect.stringContaining('did not complete forced tools'),
      tokens: { total: 5 },
    })
    expect(executeTool).not.toHaveBeenCalled()
    expect(state.model.doGenerateCalls).toHaveLength(1)
  })
  it('allows one Force tool round followed by a separate final answer', async () => {
    const output = await new AgentBlockHandler().execute(
      block,
      { model: 'openai/gpt-4.1', maxSteps: 2, tools: [customTool] },
      context()
    )
    expect(output).toMatchObject({ content: 'Native response', tokens: { total: 10 } })
    expect(executeTool).toHaveBeenCalledOnce()
    expect(state.model.doGenerateCalls.map((call: any) => call.toolChoice)).toEqual([
      { type: 'tool', toolName: 'custom_lookup' },
      { type: 'none' },
    ])
  })
  it('rejects a native model that ignores the pending named Force choice', async () => {
    state.model = new MastraLanguageModelV2Mock({
      doGenerate: async () => ({
        content: [
          {
            type: 'tool-call',
            toolCallId: crypto.randomUUID(),
            toolName: 'second',
            input: '{"query":"generated"}',
          },
        ],
        finishReason: 'tool-calls',
        usage,
        warnings: [],
      }),
    })
    const configured = ['first', 'second'].map((id) => ({
      id,
      description: id,
      parameters: schema,
      usageControl: 'force' as const,
    }))
    const tools = createOwnedTestToolSet(configured, context())
    const policy = createForcedToolPolicy(configured)
    await expect(
      new Agent({
        id: 'wrong-order',
        name: 'Wrong order',
        instructions: '',
        model: state.model,
        tools,
      }).generate('Look up', { maxSteps: 3, prepareStep: policy.prepareStep })
    ).rejects.toThrow('expected forced tool first, received second')
    expect(executeTool).not.toHaveBeenCalled()
  })

  it('keeps completed native tokens when cancellation stops a later forced step', async () => {
    const shouldCancelExecution = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    await expect(
      new AgentBlockHandler().execute(
        block,
        { model: 'openai/gpt-4.1', tools: [customTool], userPrompt: 'Lookup' },
        context({ shouldCancelExecution })
      )
    ).rejects.toMatchObject({ tokens: { total: 5 }, cost: { status: 'unavailable' } })
    expect(executeTool).toHaveBeenCalledTimes(1)
  })

  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])('uses native Gemini structured output with tools=%s, stream=%s', async (withTools, stream) => {
    const requests: any[] = []
    vi.stubGlobal('fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toContain('generativelanguage.googleapis.com')
      const body = JSON.parse(String(init?.body))
      requests.push(body)
      if (body.tools?.length && body.generationConfig?.responseMimeType === 'application/json')
        return Response.json(
          {
            error: { code: 400, message: 'Function calling with application/json is unsupported' },
          },
          { status: 400 }
        )
      const callTool = withTools && requests.length === 1
      const response = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: callTool
                ? [
                    { text: 'Searching...' },
                    { functionCall: { name: 'custom_lookup', args: { query: 'generated' } } },
                  ]
                : [{ text: '{"answer":42}' }],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 5 },
      }
      return stream
        ? new Response(`data: ${JSON.stringify(response)}\n\n`, {
            headers: { 'content-type': 'text/event-stream' },
          })
        : Response.json(response)
    })
    const native = await vi.importActual<typeof import('@/lib/mastra/connections')>(
      '@/lib/mastra/connections'
    )
    state.model = await native.createConfiguredLanguageModel('google/gemini-2.5-pro', 'fixture-key')
    const result = await new AgentBlockHandler().execute(
      block,
      {
        model: 'google/gemini-2.5-pro',
        tools: withTools ? [customTool] : [],
        userPrompt: 'Lookup then answer',
        responseFormat: {
          schema: {
            type: 'object',
            properties: { answer: { type: 'number' } },
            required: ['answer'],
            additionalProperties: false,
          },
        },
      },
      context({ stream })
    )
    if (stream) {
      const streamed = result as StreamingExecution
      expect(await new Response(streamed.stream).text()).toBe('{"answer":42}')
      expect(streamed.execution.success).toBe(true)
    }
    const output = stream ? (result as StreamingExecution).execution.output : result
    expect(output).toMatchObject({ answer: 42, tokens: { total: withTools ? 10 : 5 } })
    expect(requests).toHaveLength(withTools ? 2 : 1)
    expect(requests[0].generationConfig.responseMimeType).toBe(
      withTools ? undefined : 'application/json'
    )
    if (withTools) {
      expect(requests[0].tools[0].functionDeclarations[0].name).toBe('custom_lookup')
      expect(JSON.stringify(requests[0].systemInstruction)).toContain('JSON schema:')
    }
    expect(output).not.toHaveProperty('toolCalls')
    expect(output).not.toHaveProperty('toolResults')
    const history = getInferenceFacts(output)!.history!
    const { messages } = await (await getAgentMemory()).recall({
      threadId: history.threadId,
      resourceId: history.resourceId,
      perPage: false,
    })
    expect(
      messages.some(
        (message) =>
          message.role === 'user' &&
          JSON.stringify(message.content.parts).includes('Lookup then answer')
      )
    ).toBe(true)
    if (withTools)
      expect(messages.flatMap((message) => message.content.parts)).toContainEqual(
        expect.objectContaining({
          type: 'tool-invocation',
          toolInvocation: expect.objectContaining({
            toolName: 'custom_lookup',
            state: 'result',
            result: { found: true },
          }),
        })
      )
  })
})

describe('native history for repeated workflow Agents', () => {
  const flatten = (spans: TraceSpan[]): TraceSpan[] =>
    spans.flatMap((span) => [span, ...flatten(span.children ?? [])])

  it.each([
    ['parallel', false],
    ['parallel', true],
    ['loop', false],
    ['loop', true],
  ] as const)('uses the logged block identity in %s history (stream=%s)', async (kind, stream) => {
    const workflow = createMinimalWorkflow()
    const agent = workflow.blocks[1]
    agent.metadata!.id = 'agent'
    agent.config.params = { model: 'openai/gpt-4.1', userPrompt: 'Reply' }
    workflow.blocks.push({ ...agent, id: 'container', metadata: { id: kind, name: kind } })
    workflow.connections = [
      { source: 'trigger', target: 'container' },
      { source: 'container', target: agent.id, sourceHandle: `${kind}-start-source` },
    ]
    if (kind === 'parallel')
      workflow.parallels = {
        container: { id: 'container', nodes: [agent.id], count: 2, parallelType: 'count' },
      }
    else
      workflow.loops = {
        container: { id: 'container', nodes: [agent.id], iterations: 2, loopType: 'for' },
      }
    const result = await new Executor({
      workflow,
      contextExtensions: {
        workspaceId: 'workspace-1',
        userId: 'user-1',
        workflowLogId: 'log-1',
        executionId: 'execution-1',
        stream,
        selectedOutputs: [agent.id],
      },
    }).execute('workflow-1', 'trigger')
    expect(result.success).toBe(true)
    const agents = flatten(buildTraceSpans(result).traceSpans).filter(
      (span) => span.inference?.history
    )
    expect(agents).toHaveLength(2)
    expect(new Set(agents.map((span) => span.inference!.history!.threadId)).size).toBe(2)
    for (const span of agents) {
      const thread = await (await getNativeMemoryStore()).getThreadById(span.inference!.history!)
      expect(thread?.metadata?.blockId).toBe(span.blockId)
      const { messages } = await (await getAgentMemory()).recall({
        ...span.inference!.history!,
        perPage: false,
      })
      expect(messages.some((message) => message.role === 'assistant')).toBe(true)
    }
  })
})

describe('native structured streams through the workflow executor', () => {
  it.each([
    ['{"answer":42}', true],
    ['{"answer":"invalid"}', false],
  ])('finalizes native output %s and retains completed accounting', async (finalText, valid) => {
    state.nativeCost = { total: 0.006, status: 'estimated' }
    vi.mocked(executeTool).mockResolvedValue({
      success: true,
      output: withInferenceFacts(
        { found: true, cost: { total: 0.004, status: 'reported' } },
        { cost: { total: 0.004, status: 'reported' }, generatedFields: ['cost'] }
      ),
    })
    state.model = new MastraLanguageModelV2Mock({
      doStream: async (options) => ({
        stream: new ReadableStream({
          start(controller) {
            const forced = options.toolChoice?.type === 'tool'
            controller.enqueue({ type: 'text-start', id: 'text' })
            controller.enqueue({
              type: 'text-delta',
              id: 'text',
              delta: forced ? 'Searching...' : finalText,
            })
            controller.enqueue({ type: 'text-end', id: 'text' })
            if (options.toolChoice?.type === 'tool') {
              controller.enqueue({
                type: 'tool-call',
                toolCallId: 'completed-lookup',
                toolName: options.toolChoice.toolName,
                input: '{"query":"lookup"}',
              })
            }
            controller.enqueue({
              type: 'finish',
              finishReason: forced ? 'tool-calls' : 'stop',
              usage,
            })
            controller.close()
          },
        }),
      }),
    })
    const workflow = createMinimalWorkflow()
    workflow.blocks[1].metadata!.id = 'agent'
    workflow.blocks[1].config = {
      tool: 'llm_chat',
      params: {
        model: 'openai/gpt-4.1',
        userPrompt: 'Lookup then answer',
        tools: [
          {
            type: 'custom-tool',
            toolId: 'custom_lookup',
            schema: {
              function: {
                description: 'Lookup',
                parameters: {
                  type: 'object',
                  properties: { query: { type: 'string' } },
                  required: ['query'],
                },
              },
            },
            usageControl: 'force',
          },
        ],
        responseFormat: {
          schema: {
            type: 'object',
            properties: { answer: { type: 'number' } },
            required: ['answer'],
            additionalProperties: false,
          },
        },
      },
    }
    const onExecutionEvent = vi.fn()
    const executor = new Executor({
      workflow,
      contextExtensions: {
        workspaceId: 'workspace-1',
        workflowLogId: 'log-1',
        executionId: 'execution-1',
        userId: 'user-1',
        stream: true,
        selectedOutputs: ['block1'],
        onExecutionEvent,
      },
    })
    const contextSpy = vi.spyOn(executor as any, 'createExecutionContext')

    const result = await executor.execute('workflow-1', 'trigger')

    expect(result.success).toBe(valid)
    expect(executeTool).toHaveBeenCalledTimes(1)
    const output = result.logs?.find((log) => log.blockId === 'block1')?.output
    expect(output).toMatchObject({
      model: 'openai/gpt-4.1',
      cost: { total: 0.006, status: 'estimated' },
    })
    expect(output).not.toHaveProperty('toolResults')
    expect(JSON.stringify(getInferenceFacts(output))).not.toContain('"found"')
    expect(output?.tokens?.total).toBe(valid ? 10 : 5)
    expect(contextSpy.mock.results[0].value.blockStates.get('block1').output).toMatchObject(output)
    if (valid) {
      expect(result.output).toMatchObject({ answer: 42, tokens: { total: 10 } })
      expect(result.output).not.toHaveProperty('content')
      expect(onExecutionEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'stream:done' })
      )
      const displayedText = onExecutionEvent.mock.calls
        .map(([event]) => (event.type === 'stream:chunk' ? event.data.chunk : ''))
        .join('')
      expect(displayedText).toBe('{"answer":42}')
    } else {
      expect(result.error).toBeTruthy()
      expect(onExecutionEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'stream:done' })
      )
    }
  })
})

it.each(['no-tools', 'forced-tool', 'final-answer', 'terminal-error'])(
  'publishes only validated native answers through workflow chat (%s)',
  async (scenario) => {
    const withTools = scenario === 'forced-tool' || scenario === 'final-answer'
    let failed = false
    const transient = Object.assign(new Error('Provider stream failed'), {
      statusCode: scenario === 'terminal-error' ? 401 : 503,
      isRetryable: scenario !== 'terminal-error',
    })
    state.nativeCost = { status: 'partial', availableTotal: 0.006 }
    state.model = new MastraLanguageModelV2Mock({
      doStream: async (options) => ({
        stream: new ReadableStream({
          start(controller) {
            const forced = options.toolChoice?.type === 'tool'
            const reject = !failed && (scenario !== 'final-answer' || !forced)
            controller.enqueue({ type: 'stream-start', warnings: [] })
            controller.enqueue({ type: 'text-start', id: 'answer' })
            controller.enqueue({
              type: 'text-delta',
              id: 'answer',
              delta: reject ? 'Wrong partial. ' : forced ? 'Searching. ' : 'Recovered answer',
            })
            if (reject) {
              failed = true
              controller.enqueue({ type: 'error', error: transient })
            } else {
              controller.enqueue({ type: 'text-end', id: 'answer' })
              if (forced)
                controller.enqueue({
                  type: 'tool-call',
                  toolCallId: 'completed-lookup',
                  toolName: 'custom_lookup',
                  input: '{}',
                })
              controller.enqueue({
                type: 'finish',
                finishReason: forced ? 'tool-calls' : 'stop',
                usage,
              })
            }
            controller.close()
          },
        }),
      }),
    })
    const workflow = createMinimalWorkflow()
    workflow.blocks[1].metadata!.id = 'agent'
    workflow.blocks[1].config.params = {
      model: 'openai/gpt-4.1',
      userPrompt: 'Answer after any required tool',
      maxSteps: withTools ? 2 : 1,
      tools: withTools ? [liveCustomTool()] : [],
    }
    const chat = createChatOutputEventReader(['block1'])
    const published: string[] = []
    const chunks: string[] = []
    const result = await new Executor({
      workflow,
      contextExtensions: {
        workspaceId: 'workspace-1',
        workflowLogId: 'log-1',
        executionId: 'execution-1',
        userId: 'user-1',
        stream: true,
        selectedOutputs: ['block1'],
        onExecutionEvent: async (event) => {
          if (event.type === 'stream:chunk') chunks.push(event.data.chunk)
          for (const output of chat.readEvent({
            ...event,
            executionId: 'execution-1',
            workflowId: 'workflow-1',
            timestamp: event.timestamp ?? new Date().toISOString(),
          }))
            if (output.type === 'content') published.push(output.content)
        },
      },
    }).execute('workflow-1', 'trigger')

    const succeeded = scenario !== 'terminal-error'
    expect(result.success).toBe(succeeded)
    expect(chunks).toEqual(succeeded ? ['Recovered answer'] : [])
    expect(published).toEqual(chunks)
    expect(executeTool).toHaveBeenCalledTimes(withTools ? 1 : 0)
    const calls = state.model.doStreamCalls
    expect(calls.map((call: any) => call.toolChoice.type)).toEqual(
      scenario === 'forced-tool'
        ? ['tool', 'tool', 'none']
        : scenario === 'final-answer'
          ? ['tool', 'none', 'none']
          : succeeded
            ? ['none', 'none']
            : ['none']
    )
    if (succeeded)
      expect(result.output).toMatchObject({
        content: 'Recovered answer',
        tokens: { total: withTools ? 10 : 5 },
        cost: { status: 'partial', availableTotal: 0.006 },
      })
  }
)

it.each([2, undefined])(
  'aborts a native stream and retains earlier work (maxSteps=%s)',
  async (maxSteps) => {
    let cancelled = false
    let cancelStep: (() => void) | undefined
    let started!: () => void
    const modelStepStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    vi.mocked(executeTool).mockResolvedValue({
      success: true,
      output: withInferenceFacts(
        { found: true, cost: { total: 0.004, status: 'reported' } },
        { cost: { total: 0.004, status: 'reported' }, generatedFields: ['cost'] }
      ),
    })
    state.model = new MastraLanguageModelV2Mock({
      doStream: async (options) => ({
        stream: new ReadableStream({
          start(controller) {
            if (options.toolChoice?.type === 'tool') {
              controller.enqueue({
                type: 'tool-call',
                toolCallId: 'completed-lookup',
                toolName: options.toolChoice.toolName,
                input: '{"query":"lookup"}',
              })
              controller.enqueue({ type: 'finish', finishReason: 'tool-calls', usage })
              controller.close()
            } else {
              options.abortSignal?.addEventListener(
                'abort',
                () => controller.error(options.abortSignal?.reason),
                { once: true }
              )
              controller.enqueue({ type: 'text-start', id: 'partial' })
              controller.enqueue({ type: 'text-delta', id: 'partial', delta: 'Partial answer' })
              cancelStep = () => {
                cancelled = true
                controller.enqueue({ type: 'text-end', id: 'partial' })
              }
              started()
            }
          },
        }),
      }),
    })
    const schema = {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    }
    const result = (await new AgentBlockHandler().execute(
      block,
      {
        model: 'openai/gpt-4.1',
        maxSteps,
        userPrompt: 'Lookup then stream',
        tools: [
          {
            type: 'custom-tool',
            toolId: 'custom_lookup',
            schema: { function: { description: 'Lookup', parameters: schema } },
            usageControl: 'force',
          },
        ],
      },
      context({ stream: true, shouldCancelExecution: async () => cancelled })
    )) as StreamingExecution
    const reader = result.stream.getReader()
    const firstRead = reader.read()
    await modelStepStarted
    cancelStep!()
    await expect(firstRead).rejects.toThrow()
    expect(result.execution.success).toBe(false)
    expect(result.execution.output.tokens).toMatchObject({ total: 5 })
    expect(result.execution.output.cost).toMatchObject({ status: 'unavailable' })
  }
)

it('propagates a failed inference tool callback to the native loop', async () => {
  vi.mocked(executeTool).mockResolvedValue({
    success: false,
    error: 'Vision cancelled',
    output: withInferenceFacts(
      { tokens: { total: 9 }, cost: { total: 0.002, status: 'estimated' } },
      {
        tokens: { total: 9 },
        cost: { total: 0.002, status: 'estimated' },
        generatedFields: ['tokens', 'cost'],
      }
    ),
  })
  const tools = createOwnedTestToolSet(
    [{ id: 'vision', description: 'Vision', parameters: { type: 'object', properties: {} } }],
    context()
  )
  await expect(
    tools.vision.execute?.({}, { agent: { toolCallId: 'failed-vision' } } as any)
  ).rejects.toThrow('Vision cancelled')
})

it.each([false, true])(
  'keeps structured error/stream/execution and accounting roots through actual executor (stream=%s)',
  async (stream) => {
    const business = {
      model: 'Corolla',
      tokens: { total: 9000 },
      cost: { total: 0 },
      error: 'ordinary data',
      stream: 'ordinary data',
      execution: { success: false },
    }
    state.model = fixture(JSON.stringify(business))
    const workflow = createMinimalWorkflow()
    workflow.blocks[1].metadata!.id = 'agent'
    workflow.blocks[1].config = {
      tool: 'llm_chat',
      params: {
        model: 'openai/gpt-4.1',
        userPrompt: 'return structured data',
        responseFormat: {
          schema: {
            type: 'object',
            properties: {
              model: { type: 'string' },
              tokens: {
                type: 'object',
                properties: { total: { type: 'number' } },
                required: ['total'],
              },
              cost: {
                type: 'object',
                properties: { total: { type: 'number' } },
                required: ['total'],
              },
              error: { type: 'string' },
              stream: { type: 'string' },
              execution: {
                type: 'object',
                properties: { success: { type: 'boolean' } },
                required: ['success'],
              },
            },
            required: Object.keys(business),
            additionalProperties: false,
          },
        },
      },
    }
    const executor = new Executor({
      workflow,
      contextExtensions: {
        workspaceId: 'workspace-1',
        userId: 'user-1',
        workflowLogId: 'log-1',
        executionId: 'execution-1',
        stream,
        selectedOutputs: ['block1'],
      },
    })
    const result = await executor.execute('workflow-1', 'trigger')
    expect(result.success).toBe(true)
    const log = result.logs!.find(({ blockId }) => blockId === 'block1')!
    expect(log.success).toBe(true)
    expect(log.output).toMatchObject(business)
    expect(log.inference).toMatchObject({
      model: 'openai/gpt-4.1',
      tokens: { total: 5 },
      cost: { status: 'unavailable' },
    })
  }
)

it('removes a request-local key from failed-turn errors and canonical history without dropping known facts', async () => {
  const key = 'request-local-fixture-key'
  const userText =
    ' \n\tBefore user\n```xml\n<working_memory>literal user 🔥</working_memory>\n```\nAfter user\t \n'
  const assistantText =
    '\t \nBefore assistant\n```ts\nconst literal = "<working_memory>literal assistant 🔥</working_memory>"\n```\nAfter assistant \n\t'
  const memories = [
    { role: 'user' as const, content: userText },
    { role: 'assistant' as const, content: assistantText },
  ]
  state.model = new MastraLanguageModelV2Mock({
    doGenerate: async () => {
      throw new Error(`Provider rejected ${key}`)
    },
  })
  let failure: any
  try {
    await new AgentBlockHandler().execute(
      block,
      { model: 'openai/gpt-4.1', apiKey: key, memories, userPrompt: userText },
      context()
    )
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(Error)
  expect(failure.message).toContain('[redacted]')
  expect(failure.message).not.toContain(key)
  expect(failure.cost).toMatchObject({ status: 'unavailable' })
  expect(state.model.doGenerateCalls).toHaveLength(1)
  expect(state.configurations[0]).toHaveProperty('memory')
  expect(state.configurations[0].mastra).toBeUndefined()
})

it('refuses an embedding model before generation admission or model contact', async () => {
  setManagedProviders({
    openai: {
      name: 'Controlled registered provider',
      url: 'https://not-contacted.invalid',
      models: ['text-embedding-3-small'],
    },
  })
  await expect(
    new AgentBlockHandler().execute(
      block,
      { model: 'openai/text-embedding-3-small', userPrompt: 'Generate', tools: [] },
      context()
    )
  ).rejects.toMatchObject({ status: 400 })
  expect(state.finance).not.toHaveBeenCalled()
  expect(createConfiguredLanguageModel).not.toHaveBeenCalled()
  expect(state.configurations).toEqual([])
  expect(executeTool).not.toHaveBeenCalled()
})

const liveToolImage = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6uO8AAAAASUVORK5CYII=',
  'base64'
)
function liveToolModel() {
  const first = (options: { toolChoice?: { type: string; toolName?: string } }) =>
    options.toolChoice?.type === 'tool'
  return new MastraLanguageModelV2Mock({
    doGenerate: async (options) => ({
      content: first(options)
        ? [
            { type: 'text' as const, text: 'Known before media delivery' },
            {
              type: 'tool-call' as const,
              toolCallId: 'live-tool',
              toolName: 'custom_lookup',
              input: '{}',
            },
          ]
        : [{ type: 'text' as const, text: 'Verified media answer' }],
      finishReason: first(options) ? 'tool-calls' : 'stop',
      usage,
      warnings: [],
    }),
    doStream: async (options) => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text-start', id: 'live-text' })
          controller.enqueue({
            type: 'text-delta',
            id: 'live-text',
            delta: first(options) ? 'Known before media delivery' : 'Verified media answer',
          })
          controller.enqueue({ type: 'text-end', id: 'live-text' })
          if (first(options))
            controller.enqueue({
              type: 'tool-call',
              toolCallId: 'live-tool',
              toolName: 'custom_lookup',
              input: '{}',
            })
          controller.enqueue({
            type: 'finish',
            finishReason: first(options) ? 'tool-calls' : 'stop',
            usage,
          })
          controller.close()
        },
      }),
    }),
  })
}
function liveCustomTool() {
  return {
    type: 'custom-tool' as const,
    toolId: 'custom_lookup',
    code: 'return {}',
    schema: {
      function: {
        description: 'Return an authorized result',
        parameters: { type: 'object', properties: {} },
      },
    },
    usageControl: 'force' as const,
  }
}

it.each([false, true].flatMap((stream) => [false, true].map((allowed) => ({ stream, allowed }))))(
  'validates canonical MCP image data before the next Agent step (stream=$stream,allowed=$allowed)',
  async ({ stream, allowed }) => {
    state.trackAdmissions = true
    state.model = liveToolModel()
    const data = allowed
      ? liveToolImage.toString('base64')
      : 'https://example.invalid/not-base64.png'
    const toolFacts = {
      tokens: { total: 9 },
      cost: { total: 0.004, status: 'reported' as const },
      generatedFields: ['tokens', 'cost'],
    }
    const raw = withInferenceFacts(
      {
        content: [
          { type: 'text', text: 'Exact tool text' },
          { type: 'image', data, mimeType: 'image/png' },
        ],
        business: { value: 17 },
        tokens: toolFacts.tokens,
        cost: toolFacts.cost,
      },
      toolFacts
    )
    vi.mocked(executeTool).mockResolvedValue({ success: true, output: raw })
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    let output: any
    let displayedText = ''
    let failure: unknown
    try {
      const result = await new AgentBlockHandler().execute(
        block,
        {
          model: 'openai/gpt-4.1',
          userPrompt: 'Use one tool result',
          tools: [liveCustomTool()],
        },
        context({ stream })
      )
      if (stream) {
        const streamed = result as StreamingExecution
        const reader = streamed.stream.getReader()
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          displayedText += new TextDecoder().decode(chunk.value)
        }
        output = streamed.execution.output
      } else output = result
    } catch (error) {
      failure = error
    }
    const calls = stream ? state.model.doStreamCalls : state.model.doGenerateCalls
    expect(executeTool).toHaveBeenCalledOnce()
    expect(vi.mocked(executeTool).mock.calls[0][0]).toBe('custom_lookup')
    expect(state.finance).toHaveBeenCalledOnce()
    expect(state.admissions).toHaveBeenCalledTimes(allowed ? 2 : 1)
    expect(calls).toHaveLength(allowed ? 2 : 1)
    const scope = state.finance.mock.calls[0][0] as { signal: AbortSignal }
    expect(scope.signal.aborted).toBe(!allowed)
    expect(fetcher).not.toHaveBeenCalled()
    expect(raw.content[1].data).toBe(data)
    const active = allowed ? output : failure
    expect(active).toMatchObject({
      model: 'openai/gpt-4.1',
      tokens: { prompt: allowed ? 4 : 2, completion: allowed ? 6 : 3, total: allowed ? 10 : 5 },
    })
    expect(active).not.toHaveProperty('toolResults')
    expect(JSON.stringify(getInferenceFacts(active))).not.toContain('Exact tool text')
    if (allowed) {
      expect(failure).toBeUndefined()
      expect(output.content).toBe('Verified media answer')
      if (stream) expect(displayedText).toBe('Verified media answer')
      const history = getInferenceFacts(output)!.history!
      const { messages } = await (await getAgentMemory()).recall({
        threadId: history.threadId,
        resourceId: history.resourceId,
        perPage: false,
      })
      expect(JSON.stringify(messages)).toContain('Known before media delivery')
      const prompt = JSON.stringify(calls[1].prompt)
      expect(prompt).toContain(liveToolImage.toString('base64'))
      expect(prompt).toContain('Exact tool text')
      expect(prompt).not.toContain('"total":9')
    } else expect(failure).toBeInstanceOf(Error)
  }
)

it.each(['owner-cancel', 'native-cancel'])(
  'stops cancelled tool results before the next model step (%s), retaining the completed effect',
  async (failure) => {
    const owner = new AbortController()
    const native = new AbortController()
    const raw = withInferenceFacts(
      {
        content: [{ type: 'image', data: liveToolImage.toString('base64'), mimeType: 'image/png' }],
      },
      { cost: { total: 0.004, status: 'reported' }, generatedFields: [] }
    )
    const effect = vi.mocked(executeTool).mockImplementationOnce(async () => {
      if (failure === 'owner-cancel') owner.abort(new Error('Owner cancelled after effect'))
      if (failure === 'native-cancel') native.abort(new Error('Native cancelled after effect'))
      return { success: true, output: raw }
    })
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const tools = createAgentToolSet(
      [
        {
          id: 'image_result',
          description: 'Image result',
          parameters: { type: 'object', properties: {} },
        },
      ],
      context({ userId: 'user-1' }),
      undefined,
      { signal: owner.signal, abort: (reason) => owner.abort(reason) }
    )
    await expect(
      tools.image_result.execute?.({}, { abortSignal: native.signal })
    ).rejects.toBeInstanceOf(Error)
    expect(effect).toHaveBeenCalledOnce()
    expect(fetcher).not.toHaveBeenCalled()
    expect(owner.signal.aborted).toBe(true)
  }
)

it.each(['ordinary-json', 'nested-mcp-wrapper'])(
  'leaves unpromoted live Agent business %s literal without a source fetch',
  async (shape) => {
    state.trackAdmissions = true
    state.model = liveToolModel()
    const url = 'https://private.fixture/api/files/serve/business.png?context=copilot'
    const raw =
      shape === 'nested-mcp-wrapper'
        ? {
            success: true,
            output: { content: [{ type: 'image', data: url, mimeType: 'image/png' }] },
          }
        : { content: [{ type: 'text', text: 'Literal JSON' }], business: { url } }
    vi.mocked(executeTool).mockResolvedValue({ success: true, output: raw })
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const output = await new AgentBlockHandler().execute(
      block,
      {
        model: 'openai/gpt-4.1',
        userPrompt: 'Use one result',
        tools: [liveCustomTool()],
      },
      context()
    )
    if (!output || typeof output !== 'object' || !('content' in output))
      throw new Error('Actual nonstream business response content is unavailable')
    expect(output.content).toBe('Verified media answer')
    expect(state.model.doGenerateCalls).toHaveLength(2)
    expect(state.admissions).toHaveBeenCalledTimes(2)
    expect(executeTool).toHaveBeenCalledOnce()
    expect(fetcher).not.toHaveBeenCalled()
    expect(JSON.stringify(state.model.doGenerateCalls[1].prompt)).toContain(url)
  }
)
