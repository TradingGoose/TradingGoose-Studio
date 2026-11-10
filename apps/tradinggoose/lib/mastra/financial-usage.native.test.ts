/** @vitest-environment node */
import { Agent } from '@mastra/core/agent'
import type { MastraDBMessage } from '@mastra/core/agent/message-list'
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { validateHallucination } from '@/lib/guardrails/validate_hallucination'
import { handleAIProviderRequest } from '@/app/api/providers/ai/handler'
import { POST as vision } from '@/app/api/tools/vision/analyze/route'
import { createMockContext } from '@/executor/__test-utils__/executor-mocks'
import { AgentBlockHandler } from '@/executor/handlers/agent/agent-handler'
import { EvaluatorBlockHandler } from '@/executor/handlers/evaluator/evaluator-handler'
import { RouterBlockHandler } from '@/executor/handlers/router/router-handler'
import { getFailureAccounting } from './errors'
import { financialProcessors } from './financial-processors'
import { NATIVE_AGENT_POLICY } from './options'
import { getInferenceFacts } from './result'

const state = vi.hoisted(() => ({
  model: undefined as unknown,
  contacts: 0,
  admit: vi.fn(),
  accept: vi.fn(),
  executeTool: vi.fn(),
  payloads: [] as unknown[],
}))
vi.mock('@/lib/billing/native-finance', () => ({
  createFinancialInvocation: async (input: {
    actorUserId: string
    runId: string
    purpose: string
    workspaceId?: string
    workflowId?: string
  }) => ({
    namespace: `billing-usage:user:${input.actorUserId}`,
    key: `invocation:${input.runId}`,
    fingerprint: `synthetic:${input.runId}`,
    runId: input.runId,
    actorUserId: input.actorUserId,
    purpose: input.purpose,
    workspaceId: input.workspaceId ?? null,
    workflowId: input.workflowId ?? null,
  }),
  admitFinancialModelStep: state.admit,
  acceptFinancialModelStep: state.accept,
}))
vi.mock('@/lib/mastra/connections', async (original) => ({
  ...(await original<typeof import('@/lib/mastra/connections')>()),
  createConfiguredLanguageModel: () => state.model,
}))
vi.mock('@/lib/mastra/runtime', () => ({ getMastra: async () => undefined }))
vi.mock('@/lib/mastra/workflow-history', () => ({
  writeFunctionalPayload: async (_scope: unknown, payload: unknown) => {
    state.payloads.push(payload)
    return { version: 1, purpose: 'workflow-agent', threadId: 'synthetic-payload' }
  },
}))
vi.mock('@/lib/auth/hybrid', () => ({
  checkHybridAuth: async () => ({
    success: true,
    userId: 'actor',
    workspaceId: 'workspace',
    authType: 'session',
  }),
}))
vi.mock('@/lib/urls/utils', () => ({ getBaseUrl: () => 'http://127.0.0.1:1' }))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))
vi.mock('@/blocks', () => ({ getAllBlocks: () => [] }))
vi.mock('@/tools', () => ({ executeTool: state.executeTool, getToolAsync: vi.fn() }))
vi.mock('@/tools/utils', () => ({ getTool: vi.fn() }))
const usage = { inputTokens: 2, outputTokens: 3, totalTokens: 5 }
const tokens = { prompt: 2, completion: 3, total: 5 }
function model() {
  return new MastraLanguageModelV2Mock({
    doGenerate: async () => {
      state.contacts++
      return {
        content: [{ type: 'text', text: '{"score":8,"reasoning":"Known"}' }],
        usage,
        finishReason: 'stop',
        warnings: [],
      }
    },
    doStream: async () => {
      state.contacts++
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'text-start', id: 'text' })
            controller.enqueue({ type: 'text-delta', id: 'text', delta: 'Known content' })
            controller.enqueue({ type: 'text-end', id: 'text' })
            controller.enqueue({ type: 'finish', finishReason: 'stop', usage })
            controller.close()
          },
        }),
      }
    },
  })
}
function context(stream = false) {
  return {
    ...createMockContext(),
    userId: 'actor',
    executionId: 'execution',
    workflowLogId: 'log',
    stream,
  }
}
async function drain(stream: ReadableStream) {
  const reader = stream.getReader()
  try {
    while (!(await reader.read()).done) {}
  } finally {
    reader.releaseLock()
  }
}
async function rejected(action: () => Promise<unknown>) {
  try {
    await action()
  } catch (error) {
    return error
  }
  throw new Error('Expected the actual native financial failure')
}
beforeEach(() => {
  state.contacts = 0
  state.payloads.length = 0
  state.model = model()
  state.admit.mockReset().mockResolvedValue(undefined)
  state.accept
    .mockReset()
    .mockRejectedValue(new Error('Synthetic financial acknowledgement rejected'))
  state.executeTool.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Unmocked HTTP is forbidden')
    })
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it.each([
  'agent-generate',
  'agent-stream',
  'evaluator',
  'router',
  'provider-generate',
  'provider-stream',
  'vision',
  'hallucination',
] as const)(
  'keeps real installed-core 2/3/5 after acceptance rejection in %s without another model/tool contact',
  async (kind) => {
    const ctx = context(kind === 'agent-stream')
    const block = ctx.workflow.blocks[1]!
    block.metadata = {
      id: kind.startsWith('agent') ? 'agent' : kind,
      name: 'Synthetic native consumer',
    }
    let error: unknown
    if (kind.startsWith('agent')) {
      error = await rejected(async () => {
        const result = await new AgentBlockHandler().execute(
          block,
          { model: 'openai/gpt-4.1', userPrompt: 'Known input' },
          ctx
        )
        if (
          typeof result === 'object' &&
          result !== null &&
          'stream' in result &&
          result.stream instanceof ReadableStream
        )
          await drain(result.stream)
      })
      expect(getInferenceFacts(error)).toMatchObject({ tokens, cost: { status: 'unavailable' } })
      expect(state.payloads).toHaveLength(1)
      const failedPayload = state.payloads[0] as { output: unknown; messages: MastraDBMessage[] }
      expect(failedPayload.messages.length).toBeGreaterThan(0)
      expect(
        failedPayload.messages
          .flatMap((message) => message.content.parts)
          .filter((part) => part.type === 'text')
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            text: kind === 'agent-stream' ? 'Known content' : '{"score":8,"reasoning":"Known"}',
          }),
        ])
      )
      expect(failedPayload.output).toEqual({
        error: expect.stringContaining('Synthetic financial acknowledgement rejected'),
      })
      expect(JSON.stringify(state.payloads)).not.toMatch(
        /"tokens"|"usage"|"cost"|inputTokens|outputTokens|totalTokens/
      )
    } else if (kind === 'evaluator') {
      state.model = new MastraLanguageModelV2Mock({
        doGenerate: async () => {
          state.contacts++
          return {
            content: [{ type: 'text', text: '{"score":8}' }],
            usage,
            finishReason: 'stop',
            warnings: [],
          }
        },
      })
      error = await rejected(() =>
        new EvaluatorBlockHandler().execute(
          block,
          {
            model: 'openai/gpt-4.1',
            content: 'Known',
            metrics: [{ name: 'score', range: { min: 0, max: 10 } }],
          },
          ctx
        )
      )
    } else if (kind === 'router') {
      error = await rejected(() =>
        new RouterBlockHandler().execute(block, { model: 'openai/gpt-4.1', prompt: 'Known' }, ctx)
      )
    } else if (kind.startsWith('provider')) {
      error = await rejected(async () => {
        const result = await handleAIProviderRequest({
          body: {
            model: 'openai/gpt-4.1',
            messages: [{ role: 'user', content: 'Known' }],
            stream: kind === 'provider-stream',
          },
          requestId: crypto.randomUUID(),
          authUserId: 'actor',
        })
        if (kind === 'provider-stream') await drain(result.body!)
      })
    } else if (kind === 'vision') {
      const response = await vision(
        new NextRequest('http://127.0.0.1:1/api/tools/vision/analyze', {
          method: 'POST',
          body: JSON.stringify({
            model: 'openai/gpt-4.1',
            imageUrl: 'data:image/png;base64,AQ==',
            prompt: 'Known',
          }),
        })
      )
      expect(response.status).toBe(500)
      error = await response.json()
    } else {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json({ data: { results: [{ content: 'Known reference' }] } }))
      )
      error = await validateHallucination({
        userInput: 'Known',
        knowledgeBaseId: 'knowledge',
        threshold: 3,
        topK: 1,
        model: 'openai/gpt-4.1',
        requestId: crypto.randomUUID(),
        userId: 'actor',
        workspaceId: 'workspace',
        authHeaders: new Headers(),
      })
      expect(error).toMatchObject({ passed: false })
    }
    expect(error).toMatchObject({ tokens, cost: { status: 'unavailable' } })
    expect(getFailureAccounting(error)).toMatchObject({ tokens, cost: { status: 'unavailable' } })
    expect(state.contacts).toBe(1)
    expect(state.admit).toHaveBeenCalledTimes(1)
    expect(state.accept).toHaveBeenCalledTimes(1)
    expect(state.executeTool).not.toHaveBeenCalled()
  }
)

it('observes a real installed-core response before rejected acceptance even when onStepFinish never runs', async () => {
  const literal = ' \n```xml\n<working_memory>completed 🔥</working_memory>\n```\t '
  const source = new MastraLanguageModelV2Mock({
    doGenerate: async () => ({
      content: [{ type: 'text', text: literal }],
      usage,
      finishReason: 'stop',
      warnings: [],
    }),
  })
  const snapshots: Array<{ key: string; rows: MastraDBMessage[] }> = []
  const finance = await financialProcessors(
    { actorUserId: 'actor', runId: 'real-preaccept-capture', purpose: 'fixture' },
    ({ key, readResponse }) => {
      snapshots.push({ key, rows: structuredClone(readResponse()) })
      expect(state.accept).not.toHaveBeenCalled()
    }
  )
  const onStepFinish = vi.fn()
  const agent = new Agent({
    ...NATIVE_AGENT_POLICY,
    id: 'preaccept-capture',
    name: 'Preaccept capture',
    instructions: '',
    model: source,
    inputProcessors: finance.inputProcessors,
    outputProcessors: finance.outputProcessors,
  })
  await expect(
    agent.generate('source-only', {
      runId: 'real-preaccept-capture',
      maxSteps: 1,
      maxProcessorRetries: 0,
      modelSettings: { maxRetries: 0 },
      onStepFinish,
    })
  ).rejects.toThrow('Synthetic financial acknowledgement rejected')
  expect(source.doGenerateCalls).toHaveLength(1)
  expect(onStepFinish).not.toHaveBeenCalled()
  expect(snapshots).toHaveLength(1)
  expect(snapshots[0].rows.flatMap((message) => message.content.parts)).toEqual(
    expect.arrayContaining([expect.objectContaining({ type: 'text', text: literal })])
  )
  expect(snapshots[0].key).toEqual(expect.any(String))
  expect(finance.getUsage()).toEqual(usage)
  await expect(finance.verifyComplete()).rejects.toThrow(
    'Synthetic financial acknowledgement rejected'
  )
  expect(state.accept).toHaveBeenCalledOnce()
})

it.each([false, true])(
  'keeps genuine structured response parts and truthful failed output before acceptance (stream=%s)',
  async (stream) => {
    const text = '{"score":8,"reasoning":" exact <working_memory>business</working_memory>🔥 "}'
    state.model = new MastraLanguageModelV2Mock({
      doGenerate: async () => {
        state.contacts++
        return { content: [{ type: 'text', text }], usage, finishReason: 'stop', warnings: [] }
      },
      doStream: async () => {
        state.contacts++
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'text-start', id: 'structured' })
              controller.enqueue({ type: 'text-delta', id: 'structured', delta: text })
              controller.enqueue({ type: 'text-end', id: 'structured' })
              controller.enqueue({ type: 'finish', finishReason: 'stop', usage })
              controller.close()
            },
          }),
        }
      },
    })
    const ctx = context(stream)
    const block = ctx.workflow.blocks[1]!
    block.metadata = { id: 'agent', name: 'Structured failure' }
    const error = await rejected(async () => {
      const result = await new AgentBlockHandler().execute(
        block,
        {
          model: 'openai/gpt-4.1',
          userPrompt: 'known input',
          responseFormat: {
            schema: {
              type: 'object',
              properties: { score: { type: 'number' }, reasoning: { type: 'string' } },
              required: ['score', 'reasoning'],
              additionalProperties: false,
            },
          },
        },
        ctx
      )
      if (
        typeof result === 'object' &&
        result !== null &&
        'stream' in result &&
        result.stream instanceof ReadableStream
      )
        await drain(result.stream)
    })
    const payload = state.payloads[0] as { output: unknown; messages: MastraDBMessage[] }
    expect(state.payloads).toHaveLength(1)
    expect(payload.output).toEqual({
      error: expect.stringContaining('Synthetic financial acknowledgement rejected'),
    })
    expect(payload.output).not.toHaveProperty('score')
    expect(payload.messages.flatMap((message) => message.content.parts)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text', text })])
    )
    expect(getInferenceFacts(error)).toMatchObject({ tokens })
    expect(state.contacts).toBe(1)
    expect(state.accept).toHaveBeenCalledOnce()
    expect(state.executeTool).not.toHaveBeenCalled()
  }
)

it('retains the latest cumulative native response and completed tool work when a later occurrence is rejected', async () => {
  const literal = ' later response <working_memory>exact🔥</working_memory>\n '
  const business = { found: true, error: 'ordinary result', nested: { tokens: 'business units' } }
  state.executeTool.mockResolvedValue({ success: true, output: business })
  state.accept
    .mockReset()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('Synthetic second acknowledgement rejected'))
  state.model = new MastraLanguageModelV2Mock({
    doGenerate: async (options) => {
      state.contacts++
      const first = state.contacts === 1
      return {
        content: first
          ? [
              {
                type: 'tool-call',
                toolCallId: 'completed-lookup',
                toolName:
                  options.toolChoice?.type === 'tool'
                    ? options.toolChoice.toolName
                    : 'custom_lookup',
                input: '{"query":"exact"}',
              },
            ]
          : [{ type: 'text', text: literal }],
        finishReason: first ? 'tool-calls' : 'stop',
        usage,
        warnings: [],
      }
    },
  })
  const ctx = context()
  const block = ctx.workflow.blocks[1]!
  block.metadata = { id: 'agent', name: 'Completed work before refusal' }
  const error = await rejected(() =>
    new AgentBlockHandler().execute(
      block,
      {
        model: 'openai/gpt-4.1',
        userPrompt: 'lookup then answer',
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
      },
      ctx
    )
  )
  expect(state.contacts).toBe(2)
  expect(state.admit).toHaveBeenCalledTimes(2)
  expect(state.accept).toHaveBeenCalledTimes(2)
  expect(state.executeTool).toHaveBeenCalledOnce()
  const payload = state.payloads[0] as {
    output: unknown
    messages: MastraDBMessage[]
    tools: unknown[]
  }
  expect(state.payloads).toHaveLength(1)
  const parts = payload.messages.flatMap((message) => message.content.parts)
  expect(parts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: literal }),
      expect.objectContaining({
        type: 'tool-invocation',
        toolInvocation: expect.objectContaining({
          toolCallId: 'completed-lookup',
          state: 'result',
        }),
      }),
    ])
  )
  expect(JSON.stringify(payload.messages)).toContain('ordinary result')
  expect(payload.tools).toEqual(
    expect.arrayContaining([expect.objectContaining({ success: true, result: business })])
  )
  expect(payload.output).toEqual({
    error: expect.stringContaining('Synthetic second acknowledgement rejected'),
  })
  expect(getInferenceFacts(error)).toMatchObject({
    tokens: { prompt: 4, completion: 6, total: 10 },
  })
})

it('does not invent response history for a failure before any actual response', async () => {
  state.model = new MastraLanguageModelV2Mock({
    doGenerate: async () => {
      state.contacts++
      throw new Error('Synthetic no-response model failure')
    },
  })
  const ctx = context()
  const block = ctx.workflow.blocks[1]!
  block.metadata = { id: 'agent', name: 'No response' }
  await rejected(() =>
    new AgentBlockHandler().execute(
      block,
      { model: 'openai/gpt-4.1', userPrompt: 'known input' },
      ctx
    )
  )
  const payload = state.payloads[0] as { output: unknown; messages: MastraDBMessage[] }
  expect(state.contacts).toBe(1)
  expect(state.payloads).toHaveLength(1)
  expect(
    payload.messages.filter((message) => message.content.parts.some((part) => part.type === 'text'))
  ).toEqual([])
  expect(payload.output).toEqual({ error: expect.any(String) })
  expect(state.admit).toHaveBeenCalledOnce()
  // Installed core still invokes output processing; that callback cannot settle an uncertain contact.
  expect(state.accept).not.toHaveBeenCalled()
  expect(state.executeTool).not.toHaveBeenCalled()
})

it('refreshes the genuine latest public source on failure when callbacks cannot deliver a late native tool result', async () => {
  // Controlled callback-delivery seam only: actual Agent/processors/tool MessageList still run.
  // This is not a claim that installed core universally omits either callback.
  const actualGenerate = Agent.prototype.generate
  vi.spyOn(Agent.prototype, 'generate').mockImplementation(function (
    this: Agent,
    ...args: unknown[]
  ) {
    const [messages, options] = args
    if (args.length !== 2 || !options || typeof options !== 'object') {
      throw new Error('Expected the actual configured Agent generate invocation')
    }
    return Reflect.apply(actualGenerate, this, [
      messages,
      { ...options, onStepFinish: undefined, onAbort: undefined },
    ])
  })
  const business = {
    content: 'late-owned-tool-result🔥',
    nested: { error: 'ordinary business data' },
  }
  state.executeTool.mockResolvedValue({ success: true, output: business })
  state.accept.mockReset().mockResolvedValue(undefined)
  state.admit
    .mockReset()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValue(new Error('Synthetic next admission refused after tool completion'))
  state.model = new MastraLanguageModelV2Mock({
    doGenerate: async (options) => {
      state.contacts++
      if (state.contacts > 1) throw new Error('Unexpected repeated model contact')
      return {
        content: [
          {
            type: 'tool-call',
            toolCallId: 'late-native-tool-result',
            toolName:
              options.toolChoice?.type === 'tool' ? options.toolChoice.toolName : 'custom_lookup',
            input: '{"query":"exact"}',
          },
        ],
        finishReason: 'tool-calls',
        usage,
        warnings: [],
      }
    },
  })
  const ctx = context()
  const block = ctx.workflow.blocks[1]!
  block.metadata = { id: 'agent', name: 'Late source capture' }
  const error = await rejected(() =>
    new AgentBlockHandler().execute(
      block,
      {
        model: 'openai/gpt-4.1',
        userPrompt: 'lookup then answer',
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
      },
      ctx
    )
  )
  expect(state.contacts).toBe(1)
  expect(state.admit).toHaveBeenCalledTimes(2)
  expect(state.accept).toHaveBeenCalledOnce()
  expect(state.executeTool).toHaveBeenCalledOnce()
  expect(state.payloads).toHaveLength(1)
  const payload = state.payloads[0] as {
    output: unknown
    messages: MastraDBMessage[]
    tools: unknown[]
  }
  expect(payload.output).toEqual({ error: expect.any(String) })
  expect(payload.messages.flatMap((message) => message.content.parts)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'tool-invocation',
        toolInvocation: expect.objectContaining({
          toolCallId: 'late-native-tool-result',
          state: 'result',
          result: business,
        }),
      }),
    ])
  )
  expect(payload.tools).toEqual(
    expect.arrayContaining([expect.objectContaining({ success: true, result: business })])
  )
  expect(getInferenceFacts(error)?.tokens).toMatchObject(tokens)
  // Original financial callbacks determine their own outcomes; fail() never accepts anything.
  expect(state.accept.mock.calls[0][1].usage).toMatchObject(usage)
})

it('retains reported usage without accepting a structured response rejected by actual strict validation', async () => {
  // The ordinary model fixture includes an extra reasoning field that the evaluator forbids.
  const ctx = context()
  const block = ctx.workflow.blocks[1]!
  const error = await rejected(() =>
    new EvaluatorBlockHandler().execute(
      block,
      {
        model: 'openai/gpt-4.1',
        content: 'Known',
        metrics: [{ name: 'score', range: { min: 0, max: 10 } }],
      },
      ctx
    )
  )
  expect(getFailureAccounting(error)).toMatchObject({ tokens, cost: { status: 'unavailable' } })
  expect(state.contacts).toBe(1)
  expect(state.admit).toHaveBeenCalledOnce()
  expect(state.accept).not.toHaveBeenCalled()
  expect(state.executeTool).not.toHaveBeenCalled()
})
