import { EMBEDDING_MODELS } from '@mastra/core/llm'
import { createConfiguredLanguageModel } from '@/lib/mastra/connections'
import { getInferenceFacts, withInferenceFacts } from '@/lib/mastra/result'
import { selectNativeUsage, sumNativeUsage } from '@/lib/mastra/usage'

vi.mock('@/lib/mastra/connections', async (original) => ({
  ...(await original<typeof import('@/lib/mastra/connections')>()),
  createConfiguredLanguageModel: vi.fn(() => state.model),
}))
vi.mock('@/lib/mastra/workflow-history', () => ({
  readFunctionalPayload: async () => state.payloads.at(-1),
  writeFunctionalPayload: async (scope: Record<string, unknown>, payload: any) => {
    state.payloads.push({
      ...payload,
      toolResultIndexes: payload.tools.flatMap((run: any, index: number) =>
        run.success || run.result?.cost || run.result?.tokens ? [index] : []
      ),
    })
    const { actorUserId: _actor, ...owned } = scope
    return {
      version: 1,
      purpose: 'workflow-agent',
      threadId: 'canonical-fixture',
      ...owned,
      resourceId: 'canonical-fixture-resource',
      messageIds: [],
      digest: 'canonical-fixture-digest',
    }
  },
}))
vi.mock('@/lib/mastra/financial-processors', () => ({
  financialProcessors: async (scope: unknown, captureResponse?: (observation: any) => void) => {
    state.finance(scope)
    const signal = (scope as { signal: AbortSignal }).signal
    let occurrence: { stepNumber: number; retryCount: number; runId?: string } | undefined
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
                occurrence = {
                  stepNumber: args.stepNumber,
                  retryCount: args.retryCount,
                  runId: args.runId,
                }
                state.admissions(args.stepNumber)
              },
            },
          ]
        : [],
      outputProcessors: state.trackAdmissions
        ? [
            {
              id: 'fixture-live-tool-completed-response',
              processOutputStep: (args: any) => {
                if (!occurrence) throw new Error('Fixture response has no admitted occurrence')
                const key = JSON.stringify(occurrence)
                completed.set(key, {
                  usage: { ...selectNativeUsage(args.usage), ...completed.get(key)?.usage },
                })
                captureResponse?.({
                  key,
                  occurrence: { ...occurrence },
                  readResponse: () => args.messageList.get.response.db(),
                })
              },
            },
          ]
        : [],
      getUsage: () => sumNativeUsage([...completed.values()]),
      verifyComplete: async () => {
        if (state.trackAdmissions) signal.throwIfAborted()
        if (state.completionError) throw state.completionError
      },
    }
  },
}))
vi.mock('@/lib/mastra/runtime', () => ({ getMastra: async () => undefined }))

import { Agent } from '@mastra/core/agent'
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attachWorkflowMessageSource,
  getWorkflowMessageSource,
} from '@/lib/mastra/workflow-message-source'
import { hydrateCheckpointFunctionalPayloads } from '@/lib/workflow-archive/functional'
import type { WorkflowCheckpointSnapshot } from '@/lib/workflows/human-in-the-loop/types'
import { Executor } from '@/executor'
import { createMinimalWorkflow } from '@/executor/__test-utils__/executor-mocks'
import {
  AgentBlockHandler,
  createAgentToolSet,
  createForcedToolPolicy,
  extractCompletedToolMetadata,
  parseNativeProviderOptions,
} from '@/executor/handlers/agent/agent-handler'
import type { ExecutionContext, StreamingExecution } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'
import { resolveSkillMetadata } from './skills-resolver'

const state = vi.hoisted(() => ({
  finance: vi.fn(),
  trackAdmissions: false,
  admissions: vi.fn(),
  model: null as any,
  configurations: [] as any[],
  payloads: [] as any[],
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
vi.mock('@/lib/mastra/usage', async (original) => ({
  ...(await original<typeof import('@/lib/mastra/usage')>()),
  getMastra: async () => undefined,
  resultAccounting: async (usage: any) => ({
    tokens: {
      prompt: usage?.inputTokens,
      completion: usage?.outputTokens,
      total: usage?.totalTokens,
    },
    cost: state.nativeCost,
  }),
}))
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
  state.model = fixture()
  state.trackAdmissions = false
  state.setupError = undefined
  state.completionError = undefined
  state.nativeCost = { status: 'unavailable' }
  state.configurations.length = 0
  state.payloads.length = 0
  vi.mocked(executeTool).mockResolvedValue({ success: true, output: { found: true } })
})

afterEach(() => vi.unstubAllGlobals())

describe('native Agent workflow execution', () => {
  it.each(['flat', 'record'])(
    'preserves actual empty text entries in %s reusable memory through model selection',
    async (shape) => {
      const memories = [
        { role: 'system', content: '' },
        { role: 'user', content: '' },
        { role: 'assistant', content: ' exact\n' },
      ]
      await new AgentBlockHandler().execute(
        block,
        {
          model: 'openai/gpt-4.1',
          memories: shape === 'record' ? [{ data: memories }] : memories,
          userPrompt: 'continue',
        },
        context()
      )
      expect(state.payloads[0].selectedMessages).toEqual([
        ...memories,
        { role: 'user', content: 'continue' },
      ])
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
    expect(state.payloads[0].selectedMessages).toEqual(firstSelected)
    expect(state.payloads[0].output).toEqual({ content: assistantText })
    expect(
      state.payloads[0].messages
        .filter((message: any) => message.role === 'assistant')
        .flatMap((message: any) => message.content.parts)
    ).toContainEqual(expect.objectContaining({ type: 'text', text: assistantText }))
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
    expect(state.payloads[1].selectedMessages).toEqual(laterSelected)
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
      expect(configuration).not.toHaveProperty('memory')
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

  it('rejects malformed native options instead of clearing the user configuration', () => {
    expect(() => parseNativeProviderOptions('{')).toThrow('valid JSON')
    expect(() => parseNativeProviderOptions({ openai: 'invalid' })).toThrow('namespace')
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

describe('native named Force tools', () => {
  const schema = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
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
    const { tools, toolRuns } = createOwnedTestToolSet(configured, context())
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
    expect(toolRuns.map((run) => run.name)).toEqual(['first', 'second'])
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
    const { tools, toolRuns } = createOwnedTestToolSet(configured, context())
    expect(Object.keys(tools)).toHaveLength(2)
    expect(Object.keys(createOwnedTestToolSet(configured, context()).tools)).toEqual(
      Object.keys(tools)
    )
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
    expect(toolRuns.map((run) => run.id)).toEqual(['same_operation', 'same_operation'])
    expect(state.model.doGenerateCalls.map((call: any) => call.toolChoice)).toEqual([
      ...Object.keys(tools).map((toolName) => ({ type: 'tool', toolName })),
      { type: 'auto' },
    ])
    const auto = configured.map((tool) => ({ ...tool, usageControl: 'auto' as const }))
    expect(createForcedToolPolicy(auto).prepareStep({ steps: [] }).activeTools).toEqual(
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
    const { tools } = createOwnedTestToolSet(configured, context())
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
    const { tools } = createOwnedTestToolSet(configured, context())
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
    const { tools } = createOwnedTestToolSet(configured, context())
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

  it('combines native named tools and validated structured workflow fields', async () => {
    state.model = fixture('{"answer":42}')
    const output = await new AgentBlockHandler().execute(
      block,
      {
        model: 'openai/gpt-4.1',
        tools: [customTool],
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
      context()
    )
    expect(output).toMatchObject({ answer: 42, toolCalls: { count: 1 }, tokens: { total: 10 } })
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
      toolCost: 0.004,
      toolResults: [{ found: true, cost: { total: 0.004 } }],
    })
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
      expect(displayedText).toContain('Searching...')
      expect(displayedText).toContain('{"answer":42}')
    } else {
      expect(result.error).toBeTruthy()
      expect(onExecutionEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'stream:done' })
      )
    }
  })
})

it('aborts a native stream during a model step and retains earlier completed work', async () => {
  let cancelled = false
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
          }
        },
      }),
    }),
  })
  const schema = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  const result = (await new AgentBlockHandler().execute(
    block,
    {
      model: 'openai/gpt-4.1',
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
  expect(new TextDecoder().decode((await reader.read()).value)).toBe('Partial answer')
  cancelled = true
  await expect(reader.read()).rejects.toThrow()
  expect(result.execution.success).toBe(false)
  expect(result.execution.output.tokens).toMatchObject({ total: 5 })
  expect(result.execution.output.cost).toMatchObject({ status: 'unavailable' })
  expect(result.execution.output.toolCost).toBe(0.004)
})

it('retains completed partial tool charges when a later native model step fails', async () => {
  vi.mocked(executeTool).mockResolvedValue({
    success: true,
    output: withInferenceFacts(
      { found: true, cost: { availableTotal: 0.006, status: 'partial' } },
      { cost: { availableTotal: 0.006, status: 'partial' }, generatedFields: ['cost'] }
    ),
  })
  state.model = new MastraLanguageModelV2Mock({
    doGenerate: async (options) => {
      if (options.toolChoice?.type !== 'tool') throw new Error('Later native model failure')
      return {
        content: [
          {
            type: 'tool-call',
            toolCallId: 'charged-lookup',
            toolName: options.toolChoice.toolName,
            input: '{"query":"lookup"}',
          },
        ],
        finishReason: 'tool-calls',
        usage,
        warnings: [],
      }
    },
  })
  const schema = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  await expect(
    new AgentBlockHandler().execute(
      block,
      {
        model: 'openai/gpt-4.1',
        userPrompt: 'Lookup then answer',
        tools: [
          {
            type: 'custom-tool',
            toolId: 'custom_lookup',
            schema: { function: { description: 'Lookup', parameters: schema } },
            usageControl: 'force',
          },
        ],
      },
      context()
    )
  ).rejects.toMatchObject({
    model: 'openai/gpt-4.1',
    toolCost: 0.006,
    unavailableToolCosts: 1,
    cost: { status: 'unavailable' },
    toolResults: [{ found: true, cost: { availableTotal: 0.006, status: 'partial' } }],
  })
})

it('retains native accounting from a failed callback in metadata used by workflow failure settlement', async () => {
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
  const { tools, toolRuns } = createOwnedTestToolSet(
    [{ id: 'vision', description: 'Vision', parameters: { type: 'object', properties: {} } }],
    context()
  )
  await expect(
    tools.vision.execute?.({}, { agent: { toolCallId: 'failed-vision' } } as any)
  ).rejects.toThrow('Vision cancelled')
  expect(extractCompletedToolMetadata(toolRuns)).toMatchObject({
    toolCost: 0.002,
    toolResults: [
      { toolCallId: 'failed-vision', tokens: { total: 9 }, cost: { status: 'estimated' } },
    ],
  })
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

describe('exact selected Memory system provenance', () => {
  it.each([false, 0, '', undefined])(
    'retains duplicate whitespace and ordered Memory systems when explicit prompt is %s',
    async (systemPrompt) => {
      const first = attachWorkflowMessageSource(
        { role: 'system', content: '  policy  ' },
        {
          messageId: 'first',
          threadId: 'workflow-memory:thread',
          resourceId: 'workflow-memory:resource',
        }
      )
      const second = attachWorkflowMessageSource(
        { role: 'system', content: '  policy  ' },
        {
          messageId: 'second',
          threadId: 'workflow-memory:thread',
          resourceId: 'workflow-memory:resource',
        }
      )
      await new AgentBlockHandler().execute(
        block,
        {
          model: 'openai/gpt-4.1',
          systemPrompt,
          memories: [
            {
              data: [
                first,
                { role: 'user', content: 'prior' },
                second,
                { role: 'assistant', content: 'answer' },
                { role: 'system', content: '' },
              ],
            },
          ],
          userPrompt: 'current',
        } as any,
        context()
      )
      const selected = state.payloads[0].selectedMessages
      expect(selected.map(({ role, content }: any) => [role, content])).toEqual([
        ['system', '  policy  '],
        ['user', 'prior'],
        ['system', '  policy  '],
        ['assistant', 'answer'],
        ['system', ''],
        ['user', 'current'],
      ])
      expect(getWorkflowMessageSource(selected[0])?.messageId).toBe('first')
      expect(getWorkflowMessageSource(selected[2])?.messageId).toBe('second')
      const systems = state.configurations[0].inputProcessors[0].processInputStep().systemMessages
      expect(systems.map((message: any) => message.content)).toEqual([
        '  policy  ',
        '  policy  ',
        '',
      ])
    }
  )

  it('selects a truthy explicit prompt before stringification and removes all Memory systems', async () => {
    await new AgentBlockHandler().execute(
      block,
      {
        model: 'openai/gpt-4.1',
        systemPrompt: { exact: 'override' },
        memories: [
          { role: 'system', content: 'old' },
          { role: 'user', content: 'keep' },
          { role: 'system', content: 'old2' },
        ],
      } as any,
      context()
    )
    const selected = state.payloads[0].selectedMessages
    expect(selected).toHaveLength(2)
    expect(selected[0].role).toBe('system')
    expect(JSON.parse(selected[0].content)).toEqual({ exact: 'override' })
    expect(getWorkflowMessageSource(selected[0])).toBeUndefined()
    expect(selected[1]).toEqual({ role: 'user', content: 'keep' })
  })

  it('adds skills only to the first selected system without claiming unchanged original provenance for composed text', async () => {
    vi.mocked(resolveSkillMetadata).mockResolvedValueOnce([
      { id: 'skill', name: 'Skill', description: 'Read the handbook' },
    ])
    const first = attachWorkflowMessageSource(
      { role: 'system', content: 'first' },
      {
        messageId: 'first',
        threadId: 'workflow-memory:thread',
        resourceId: 'workflow-memory:resource',
      }
    )
    const second = attachWorkflowMessageSource(
      { role: 'system', content: 'second' },
      {
        messageId: 'second',
        threadId: 'workflow-memory:thread',
        resourceId: 'workflow-memory:resource',
      }
    )
    await new AgentBlockHandler().execute(
      block,
      { model: 'openai/gpt-4.1', skills: [{ skillId: 'skill' }], memories: [first, second] } as any,
      context()
    )
    const selected = state.payloads[0].selectedMessages
    expect(selected[0].content).toContain('Read the handbook')
    expect(selected[1].content).toBe('second')
    expect(getWorkflowMessageSource(selected[0])).toBeUndefined()
    expect(getWorkflowMessageSource(selected[1])?.messageId).toBe('second')
  })
})

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
  expect(state.payloads).toHaveLength(1)
  expect(JSON.stringify(state.payloads[0].output)).not.toContain(key)
  expect(JSON.stringify(state.payloads[0].messages)).not.toContain(key)
  expect(state.payloads[0].selectedMessages).toEqual([
    ...memories,
    { role: 'user', content: userText },
  ])
  expect(state.payloads[0].messages).toHaveLength(1)
  expect(state.payloads[0].messages[0].role).toBe('assistant')
  expect(state.payloads[0].messages[0].content.parts.map((part: any) => part.type)).toEqual([
    'error',
  ])
  expect(state.model.doGenerateCalls).toHaveLength(1)
  expect(state.configurations[0]).not.toHaveProperty('memory')
  expect(state.configurations[0].mastra).toBeUndefined()
})

it.each([false, true])(
  'keeps actual executor status 500 through failed Agent error-edge, canonical hydration and %s cold resume',
  async (cold) => {
    const literal = ' completed <working_memory>literal🔥</working_memory>\n '
    state.model = fixture(literal)
    state.completionError = new Error('Synthetic completed Agent acknowledgement unavailable')
    const workflow = createMinimalWorkflow()
    workflow.blocks[1].metadata = { id: 'agent', name: 'Agent' }
    workflow.blocks[1].config = {
      tool: 'llm_chat',
      params: { model: 'openai/gpt-4.1', userPrompt: 'Complete exactly once' },
    }
    workflow.blocks.push(
      {
        id: 'approval',
        position: { x: 200, y: 0 },
        enabled: true,
        inputs: {},
        outputs: {},
        metadata: { id: 'human_in_the_loop', name: 'Approval' },
        config: {
          tool: 'human_in_the_loop',
          params: {
            inputFormat: [{ name: 'approved', type: 'boolean', required: true }],
            builderData: [{ id: 'display', name: 'question', type: 'string', value: 'Continue?' }],
          },
        },
      },
      {
        id: 'after',
        position: { x: 300, y: 0 },
        enabled: true,
        inputs: {},
        outputs: {},
        metadata: { id: 'response', name: 'After' },
        config: {
          tool: 'response',
          params: {
            dataMode: 'structured',
            builderData: [
              { id: 'status', name: 'status', type: 'number', value: '<agent.status>' },
            ],
          },
        },
      }
    )
    workflow.connections.push(
      { source: 'block1', target: 'approval', sourceHandle: 'error' },
      { source: 'approval', target: 'after' }
    )
    const contextExtensions = {
      workspaceId: 'workspace-1',
      userId: 'user-1',
      workflowLogId: 'log-1',
      executionId: 'execution-1',
    }
    const paused = await new Executor({ workflow, contextExtensions }).execute(
      'workflow-1',
      'trigger'
    )
    expect(paused.status).toBe('paused')
    expect(state.model.doGenerateCalls).toHaveLength(1)
    expect(state.payloads).toHaveLength(1)
    expect(state.payloads[0].output).toEqual({
      error: expect.stringContaining('acknowledgement unavailable'),
    })
    expect(JSON.stringify(state.payloads[0].messages)).toContain(literal.replace(/\n/g, '\\n'))
    if (!paused.checkpoint) throw new Error('Expected actual executor checkpoint')
    const before = paused.checkpoint
    expect(before.context.blockStates.find(([id]) => id === 'block1')?.[1].output).toMatchObject({
      status: 500,
    })
    expect(before.currentBlockStates).not.toHaveProperty('block1')
    const snapshot = {
      executor: cold ? JSON.parse(JSON.stringify(before)) : before,
      blueprint: { workflowId: 'workflow-1' },
      workflowLogId: 'log-1',
    } as unknown as WorkflowCheckpointSnapshot
    await hydrateCheckpointFunctionalPayloads(snapshot, {
      workspaceId: 'workspace-1',
      executionId: 'execution-1',
      logId: 'log-1',
    })
    const log = snapshot.executor.context.blockLogs.find(({ blockId }) => blockId === 'block1')!
    expect(log.success).toBe(false)
    expect(log.output).not.toHaveProperty('status')
    expect(
      snapshot.executor.context.blockStates.find(([id]) => id === 'block1')?.[1].output
    ).toMatchObject({ status: 500 })
    expect(snapshot.executor.currentBlockStates).not.toHaveProperty('block1')
    const resumed = await new Executor({
      workflow: snapshot.executor.workflow,
      checkpoint: snapshot.executor,
      currentBlockStates: snapshot.executor.currentBlockStates,
      workflowVariables: snapshot.executor.context.workflowVariables,
      envVarValues: snapshot.executor.context.environmentVariables,
      resumeInputs: new Map([['approval', { approved: true }]]),
      contextExtensions: { ...contextExtensions, pendingExecutionId: 'execution-1:resume:1' },
    }).execute('workflow-1', 'trigger')
    expect(resumed.success).toBe(true)
    expect(resumed.logs?.find(({ blockId }) => blockId === 'after')?.output).toMatchObject({
      response: { status: 200, data: { status: 500 } },
    })
    expect(state.model.doGenerateCalls).toHaveLength(1)
    expect(state.payloads).toHaveLength(1)
  }
)

it.each(EMBEDDING_MODELS.map(({ provider, id }) => [`${provider}/${id}`, provider, id] as const))(
  'refuses native-known embedding model %s before generation admission or model contact',
  async (model, provider, modelId) => {
    // Trusted deployment membership is explicit; purpose rejection uses real installed native metadata.
    vi.stubEnv(
      'MASTRA_MODEL_PROVIDERS',
      JSON.stringify({
        [provider]: {
          name: 'Controlled registered provider',
          url: 'https://not-contacted.invalid',
          models: [modelId],
        },
      })
    )
    try {
      await expect(
        new AgentBlockHandler().execute(
          block,
          { model, userPrompt: 'A genuine generation request', tools: [] },
          context()
        )
      ).rejects.toMatchObject({ status: 400 })
      expect(state.finance).not.toHaveBeenCalled()
      expect(createConfiguredLanguageModel).not.toHaveBeenCalled()
      expect(state.configurations).toEqual([])
      expect(state.payloads).toEqual([])
      expect(executeTool).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  }
)

it('archives a same branded tool Error and counts native5 plus tool9 once when cancellation stops the next step', async () => {
  const { getInferenceFacts } = await import('@/lib/mastra/result')
  const { checkpointFunctionalOutput } = await import('@/executor/checkpoint')
  const { calculateCostSummary } = await import('@/lib/logs/execution/logging-factory')
  const toolFacts = {
    model: 'native/tool',
    tokens: { total: 9 },
    cost: { status: 'unavailable' },
    generatedFields: ['model', 'tokens', 'cost'],
  } satisfies import('@/lib/mastra/result').InferenceFacts
  const business = {
    model: 'business model',
    tokens: 9000,
    cost: 'literal',
    stack: 'business stack',
  }
  const cause = new Error('Private provider diagnostics')
  const toolFailure = withInferenceFacts(
    Object.assign(new Error('Lookup failed after completed native work'), {
      model: toolFacts.model,
      tokens: toolFacts.tokens,
      cost: toolFacts.cost,
      cause,
      business,
    }),
    toolFacts
  )
  // Make both known Error diagnostics enumerable so the old active spread visibly leaks them.
  Object.defineProperty(toolFailure, 'stack', { enumerable: true })
  const originalStack = toolFailure.stack
  const originalStackDescriptor = Object.getOwnPropertyDescriptor(toolFailure, 'stack')
  let cancelled = false
  const shouldCancelExecution = vi.fn(async () => cancelled)
  vi.mocked(executeTool).mockImplementationOnce(async () => {
    // This is the existing explicit cancellation hook, not a new Force failure policy.
    cancelled = true
    throw toolFailure
  })
  const failure = await new AgentBlockHandler()
    .execute(
      block,
      {
        model: 'openai/gpt-4.1',
        userPrompt: 'Perform the required lookup',
        tools: [
          {
            type: 'custom-tool',
            toolId: 'custom_lookup',
            title: 'Lookup',
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
      },
      context({ shouldCancelExecution })
    )
    .then(
      () => {
        throw new Error('Cancelled native turn unexpectedly succeeded')
      },
      (error: unknown) => error
    )
  expect(failure).toBeInstanceOf(Error)
  expect(cancelled).toBe(true)
  expect(await shouldCancelExecution.mock.results.at(-1)?.value).toBe(true)
  expect(state.model.doGenerateCalls).toHaveLength(1)
  expect(executeTool).toHaveBeenCalledOnce()
  expect(state.payloads).toHaveLength(1)
  const facts = getInferenceFacts(failure)
  if (!facts) throw new Error('Expected the actual Agent failure facts')
  expect(facts).toMatchObject({
    model: 'openai/gpt-4.1',
    tokens: { prompt: 2, completion: 3, total: 5 },
    cost: { status: 'unavailable' },
    unavailableToolCosts: 1,
    nativePayload: { purpose: 'workflow-agent' },
  })
  const activeTools = facts.toolResults
  if (!activeTools || activeTools.length !== 1)
    throw new Error('Expected the single completed failed-tool occurrence')
  expect(getInferenceFacts(activeTools[0])).toBe(toolFacts)
  const payload = state.payloads[0]
  expect(payload.tools).toHaveLength(1)
  const run = payload.tools[0]
  expect(run).toMatchObject({
    id: 'custom_lookup',
    success: false,
    toolCallId: expect.any(String),
    error: toolFailure.message,
  })
  // The real createAgentToolSet catch retained the SAME object; the writer seam has not projected it.
  expect(run.result).toBe(toolFailure)
  expect(getInferenceFacts(run.result)).toBe(toolFacts)
  expect(payload.toolResultIndexes).toEqual([0])
  const functionalChild = {
    toolCallId: run.toolCallId,
    name: 'Error',
    message: toolFailure.message,
    model: 'native/tool',
    business,
  }
  // The extractor's active plain copy keeps its SAME private facts, not raw Error diagnostics/reports.
  expect(activeTools[0]).not.toBe(toolFailure)
  expect(Object.getPrototypeOf(activeTools[0])).toBe(Object.prototype)
  expect(activeTools[0]).toMatchObject(functionalChild)
  expect(getInferenceFacts(activeTools[0])?.tokens).toEqual({ total: 9 })
  for (const field of ['tokens', 'cost', 'stack', 'cause'])
    expect(activeTools[0]).not.toHaveProperty(field)
  const projectedActiveTools = checkpointFunctionalOutput(activeTools)
  const projectedFailure = checkpointFunctionalOutput(failure)
  const coldActiveTools = JSON.parse(JSON.stringify(projectedActiveTools))
  const coldFailure = JSON.parse(JSON.stringify(projectedFailure))
  expect(coldActiveTools).toEqual([functionalChild])
  expect(coldFailure).toMatchObject({
    name: 'Error',
    message: expect.any(String),
    model: 'openai/gpt-4.1',
    toolResults: [functionalChild],
  })
  for (const copy of [coldActiveTools[0], coldFailure.toolResults[0]]) {
    for (const field of ['tokens', 'cost', 'stack', 'cause']) expect(copy).not.toHaveProperty(field)
    expect(copy.message).toBe(toolFailure.message)
    expect(copy.business).toEqual(business)
    expect(getInferenceFacts(copy)).toBeUndefined()
  }
  for (const field of ['tokens', 'cost', 'stack', 'cause'])
    expect(coldFailure).not.toHaveProperty(field)
  expect(getInferenceFacts(projectedActiveTools[0])).toBeUndefined()
  expect(getInferenceFacts(projectedFailure)).toBeUndefined()
  expect(getInferenceFacts(coldFailure)).toBeUndefined()
  const activeSpan = { id: 'failed-agent-native-turn', inference: facts }
  for (const summary of [
    calculateCostSummary([activeSpan]),
    calculateCostSummary([activeSpan, activeSpan]),
  ]) {
    expect(summary.totalTokens).toBe(14)
    expect(summary.models['openai/gpt-4.1'].tokens.total).toBe(5)
    expect(summary.models['native/tool'].tokens.total).toBe(9)
    expect(summary.status).toBe('unavailable')
    expect(summary.totalCost).toBeUndefined()
    expect(summary.availableTotal).toBeUndefined()
  }
  const projected = checkpointFunctionalOutput(payload)
  const cold = JSON.parse(JSON.stringify(projected))
  expect(projected.tools[0].result).not.toBe(toolFailure)
  expect(Object.getPrototypeOf(projected.tools[0].result)).toBe(Object.prototype)
  expect(cold.toolResultIndexes).toEqual([0])
  expect(cold.tools[0]).toMatchObject({
    success: false,
    toolCallId: run.toolCallId,
    error: toolFailure.message,
  })
  expect(cold.tools[0].result).toEqual({
    name: 'Error',
    message: toolFailure.message,
    model: 'native/tool',
    business,
  })
  for (const field of ['tokens', 'cost', 'stack', 'cause'])
    expect(cold.tools[0].result).not.toHaveProperty(field)
  expect(getInferenceFacts(projected.tools[0].result)).toBeUndefined()
  expect(getInferenceFacts(cold.tools[0].result)).toBeUndefined()
  expect(getInferenceFacts(cold.tools[0])).toBeUndefined()
  expect(toolFailure.message).toBe('Lookup failed after completed native work')
  expect(toolFailure.stack).toBe(originalStack)
  expect(Object.getOwnPropertyDescriptor(toolFailure, 'stack')).toEqual(originalStackDescriptor)
  expect(toolFailure.cause).toBe(cause)
  expect(toolFailure.business).toBe(business)
  expect(toolFailure.tokens.total).toBe(9)
  expect(getInferenceFacts(toolFailure)).toBe(toolFacts)
  // Projection and cold reading perform no new model/tool/payload work.
  expect(state.model.doGenerateCalls).toHaveLength(1)
  expect(executeTool).toHaveBeenCalledOnce()
  expect(state.payloads).toHaveLength(1)
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
  'guards a newly completed Agent tool result before another installed native step (stream=$stream,allowed=$allowed)',
  async ({ stream, allowed }) => {
    state.trackAdmissions = true
    state.model = liveToolModel()
    const url = allowed
      ? 'https://public.fixture/live-agent.png'
      : 'https://private.fixture/api/files/serve/hidden.png?context=copilot'
    const toolFacts = {
      tokens: { total: 9 },
      cost: { total: 0.004, status: 'reported' as const },
      generatedFields: ['tokens', 'cost'],
    }
    const raw = withInferenceFacts(
      {
        content: [
          { type: 'text', text: 'Exact tool text' },
          { type: 'image', data: url, mimeType: 'image/png' },
        ],
        business: { value: 17 },
        tokens: toolFacts.tokens,
        cost: toolFacts.cost,
      },
      toolFacts
    )
    vi.mocked(executeTool).mockResolvedValue({ success: true, output: raw })
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://public.fixture/live-agent.png')
      expect(init?.redirect).toBe('manual')
      return new Response(new Uint8Array(liveToolImage), {
        headers: { 'content-type': 'image/png' },
      })
    })
    vi.stubGlobal('fetch', fetcher)
    let output: any
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
          if ((await reader.read()).done) break
        }
        output = streamed.execution.output
      } else output = result
    } catch (error) {
      failure = error
    }
    const calls = stream ? state.model.doStreamCalls : state.model.doGenerateCalls
    expect(executeTool).toHaveBeenCalledOnce()
    expect(vi.mocked(executeTool).mock.calls[0][0]).toBe('function_execute')
    expect(state.finance).toHaveBeenCalledOnce()
    expect(state.admissions).toHaveBeenCalledTimes(allowed ? 2 : 1)
    expect(calls).toHaveLength(allowed ? 2 : 1)
    const scope = state.finance.mock.calls[0][0] as { signal: AbortSignal }
    expect(scope.signal.aborted).toBe(!allowed)
    expect(fetcher).toHaveBeenCalledTimes(allowed ? 1 : 0)
    expect(state.payloads).toHaveLength(1)
    const saved = state.payloads[0]
    expect(saved.tools).toHaveLength(1)
    expect(saved.tools[0]).toMatchObject({ success: true, id: 'custom_lookup' })
    expect(saved.tools[0].result).toBe(raw)
    expect(getInferenceFacts(saved.tools[0].result)).toBe(toolFacts)
    expect(saved.toolResultIndexes).toEqual([0])
    expect(raw.content[1].data).toBe(url)
    expect(JSON.stringify(saved.messages)).toContain('Known before media delivery')
    const active = allowed ? output : failure
    expect(active).toMatchObject({
      model: 'openai/gpt-4.1',
      toolCost: 0.004,
      tokens: { prompt: allowed ? 4 : 2, completion: allowed ? 6 : 3, total: allowed ? 10 : 5 },
      toolResults: [
        {
          content: raw.content,
          business: raw.business,
          tokens: toolFacts.tokens,
          cost: toolFacts.cost,
        },
      ],
    })
    if (allowed) {
      expect(failure).toBeUndefined()
      expect(output.content).toBe('Known before media deliveryVerified media answer')
      const prompt = JSON.stringify(calls[1].prompt)
      expect(prompt).not.toContain(url)
      expect(prompt).toContain(liveToolImage.toString('base64'))
      expect(prompt).toContain('Exact tool text')
      expect(prompt).not.toContain('"total":9')
    } else expect(failure).toBeInstanceOf(Error)
  }
)

it.each(['actor', 'owner-cancel', 'native-cancel'])(
  'refuses actual promoted tool media with invalid live authority (%s), retaining the effect once',
  async (failure) => {
    const owner = new AbortController()
    const native = new AbortController()
    const raw = {
      content: [{ type: 'image', data: 'https://public.fixture/never.png', mimeType: 'image/png' }],
    }
    const effect = vi.fn(async () => {
      if (failure === 'owner-cancel') owner.abort(new Error('Owner cancelled after effect'))
      if (failure === 'native-cancel') native.abort(new Error('Native cancelled after effect'))
      return raw
    })
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const { tools, toolRuns } = createAgentToolSet(
      [
        {
          id: 'image_result',
          description: 'Image result',
          parameters: { type: 'object', properties: {} },
          executeFunction: effect,
        },
      ],
      context({ userId: failure === 'actor' ? undefined : 'user-1' }),
      undefined,
      { signal: owner.signal, abort: (reason) => owner.abort(reason) }
    )
    await expect(
      tools.image_result.execute?.({}, { abortSignal: native.signal })
    ).rejects.toBeInstanceOf(Error)
    expect(effect).toHaveBeenCalledOnce()
    expect(fetcher).not.toHaveBeenCalled()
    expect(owner.signal.aborted).toBe(true)
    expect(toolRuns).toHaveLength(1)
    expect(toolRuns[0].success).toBe(true)
    expect(toolRuns[0].result).toBe(raw)
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
    expect(output.content).toBe('Known before media deliveryVerified media answer')
    expect(state.model.doGenerateCalls).toHaveLength(2)
    expect(state.admissions).toHaveBeenCalledTimes(2)
    expect(executeTool).toHaveBeenCalledOnce()
    expect(fetcher).not.toHaveBeenCalled()
    expect(state.payloads[0].tools[0].result).toBe(raw)
    expect(JSON.stringify(state.model.doGenerateCalls[1].prompt)).toContain(url)
  }
)
