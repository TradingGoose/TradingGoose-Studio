/** @vitest-environment node */
import './__test-utils__/managed-services'
import { Agent } from '@mastra/core/agent'
import type { OutputProcessor } from '@mastra/core/processors'
import { InMemoryStore } from '@mastra/core/storage'
import { MastraLanguageModelV2Mock, simulateReadableStream } from '@mastra/core/test-utils/llm-mock'
import { createTool } from '@mastra/core/tools'
import { Memory } from '@mastra/memory'
import { beforeEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { projectNativeMessage } from './messages'
import { assertNativeCompletion } from './result'
import { usageProcessors } from './usage-processors'

const billing = vi.hoisted(() => ({
  admit: vi.fn(),
  begin: vi.fn(),
  record: vi.fn(),
  contact: vi.fn(),
}))
vi.mock('@/lib/billing/model-usage', () => ({
  assertModelUsageAllowed: billing.admit,
  beginWorkflowModelUsage: billing.begin,
  recordModelUsage: billing.record,
}))
const scope = {
  actorUserId: 'actor',
  funding: 'account' as const,
  runId: 'run',
  purpose: 'copilot',
  model: 'openai/gpt-4.1',
}
const usage = { inputTokens: 2, outputTokens: 3, totalTokens: 5 }
type NativeStreamPart = Awaited<
  ReturnType<MastraLanguageModelV2Mock['doStream']>
>['stream'] extends ReadableStream<infer Part>
  ? Part
  : never

beforeEach(() => {
  vi.clearAllMocks()
  billing.admit.mockResolvedValue(undefined)
  billing.begin.mockResolvedValue(false)
  billing.record.mockImplementation(async (_scope, _usage, cost) => cost)
})

async function generate(
  finishReason: 'stop' | 'content-filter' | 'error' = 'stop',
  reportedUsage = usage
) {
  const accounting = await usageProcessors(scope)
  const model = new MastraLanguageModelV2Mock({
    doGenerate: async () => {
      billing.contact()
      return {
        content: [{ type: 'text', text: 'answer' }],
        usage: reportedUsage,
        finishReason,
        warnings: [],
      }
    },
  })
  const agent = new Agent({
    id: 'usage-test',
    name: 'Usage test',
    instructions: '',
    model,
    inputProcessors: accounting.inputProcessors,
    outputProcessors: accounting.outputProcessors,
  })
  const [outcome] = await Promise.allSettled([
    agent.generate('hello', { runId: scope.runId, maxSteps: 1 }),
  ])
  return { ...accounting, outcome }
}

it('admits and bills each native attempt once', async () => {
  const accounting = await generate()
  await accounting.verifyComplete()
  expect(billing.admit).toHaveBeenCalledExactlyOnceWith(scope)
  expect(billing.begin).toHaveBeenCalledExactlyOnceWith(
    scope,
    expect.stringMatching(/^run:[0-9a-f-]{36}:0:0$/)
  )
  expect(billing.record).toHaveBeenCalledExactlyOnceWith(
    scope,
    usage,
    accounting.getCost(),
    expect.stringMatching(/^run:[0-9a-f-]{36}:0:0$/)
  )
  expect(billing.admit.mock.invocationCallOrder[0]).toBeLessThan(
    billing.contact.mock.invocationCallOrder[0]
  )
  expect(accounting.getUsage()).toEqual(usage)
  expect(accounting.getCost().total).toBeCloseTo(0.000028)
  expect(billing.record.mock.calls[0][3]).toBe(billing.begin.mock.calls[0][1])
})

it('awaits durable attempt ownership before native contact and completes the same occurrence', async () => {
  let admit!: (owned: boolean) => void
  billing.begin.mockReturnValue(
    new Promise<boolean>((resolve) => {
      admit = resolve
    })
  )
  const generating = generate()
  await vi.waitFor(() => expect(billing.begin).toHaveBeenCalledOnce())
  expect(billing.contact).not.toHaveBeenCalled()
  expect(billing.record).not.toHaveBeenCalled()
  admit(true)
  const accounting = await generating
  await accounting.verifyComplete()
  expect(billing.contact).toHaveBeenCalledOnce()
  expect(billing.record.mock.calls[0][3]).toBe(billing.begin.mock.calls[0][1])
})

it('separates provider invocations that reuse the same run label', async () => {
  const first = await generate()
  const second = await generate()
  await first.verifyComplete()
  await second.verifyComplete()
  const ids = billing.begin.mock.calls.map((call) => call[1])
  expect(ids).toEqual([
    expect.stringMatching(/^run:[0-9a-f-]{36}:0:0$/),
    expect.stringMatching(/^run:[0-9a-f-]{36}:0:0$/),
  ])
  expect(new Set(ids).size).toBe(2)
  expect(billing.record.mock.calls.map((call) => call[3])).toEqual(ids)
  expect(billing.begin.mock.calls.every(([selected]) => selected.runId === scope.runId)).toBe(true)
  expect(billing.record.mock.calls.every(([selected]) => selected.runId === scope.runId)).toBe(true)
})

it.each(['account', 'byok'] as const)(
  'retains native recovered request usage and unknown attempts (%s)',
  async (funding) => {
    const accounting = await usageProcessors({ ...scope, funding })
    const storage = new InMemoryStore()
    const memory = new Memory({ storage })
    const threadId = `native-recovery:${funding}`
    const transient = Object.assign(new Error('Transient provider stream failure'), {
      isRetryable: true,
      statusCode: 503,
    })
    const agent = new Agent({
      id: 'native-recovery',
      name: 'Native recovery',
      instructions: '',
      memory,
      model: new MastraLanguageModelV2Mock({
        doStream: async () => {
          billing.contact()
          return {
            stream: simulateReadableStream<NativeStreamPart>({
              chunks:
                billing.contact.mock.calls.length === 1
                  ? [
                      { type: 'stream-start', warnings: [] },
                      { type: 'text-start', id: 'failed-answer' },
                      { type: 'text-delta', id: 'failed-answer', delta: 'Wrong partial. ' },
                      { type: 'error', error: transient },
                    ]
                  : [
                      { type: 'stream-start', warnings: [] },
                      { type: 'text-start', id: 'answer' },
                      { type: 'text-delta', id: 'answer', delta: 'Recovered answer' },
                      { type: 'text-end', id: 'answer' },
                      { type: 'finish', usage, finishReason: 'stop' },
                    ],
            }),
          }
        },
      }),
      inputProcessors: accounting.inputProcessors,
      outputProcessors: accounting.outputProcessors.map(
        (processor): OutputProcessor => ({
          ...processor,
          async processOutputStep(args) {
            await processor.processOutputStep!(args)
            return processor.processOutputStep!(args)
          },
        })
      ),
    })
    const streamed = await agent.stream('hello', {
      runId: scope.runId,
      memory: { thread: threadId, resource: scope.actorUserId },
    })
    const result = await streamed.getFullOutput()
    expect(result.text).toBe('Recovered answer')
    await accounting.verifyComplete()
    expect(billing.contact).toHaveBeenCalledTimes(2)
    expect(billing.begin.mock.calls.map((call) => call[1])).toEqual([
      expect.stringMatching(/^run:[0-9a-f-]{36}:0:0$/),
      expect.stringMatching(/^run:[0-9a-f-]{36}:0:1$/),
    ])
    expect(accounting.getUsage()).toEqual(usage)
    expect(accounting.getCost()).toMatchObject({
      status: 'partial',
      currency: 'USD',
      availableTotal: 0.000028,
      ...(funding === 'byok' ? { accountCost: null } : {}),
    })
    expect(billing.record).toHaveBeenCalledOnce()
    expect(billing.record.mock.calls[0][0]).toMatchObject({ funding })
    const persisted = await (await storage.getStore('memory'))!.listMessages({
      threadId,
      resourceId: scope.actorUserId,
      perPage: false,
      orderBy: { field: 'createdAt', direction: 'ASC' },
    })
    const assistant = persisted.messages.filter((message) => message.role === 'assistant').at(-1)!
    const reloaded = projectNativeMessage(assistant)
    expect(reloaded.usage).toEqual(accounting.getUsage())
    expect(reloaded.cost).toEqual(accounting.getCost())
  }
)

it.each(['admit', 'begin'] as const)('stops model contact when %s fails', async (operation) => {
  const failure = new Error('Usage admission failed')
  billing[operation].mockRejectedValue(failure)
  const accounting = await generate()
  await expect(accounting.verifyComplete()).rejects.toBe(failure)
  expect(billing.contact).not.toHaveBeenCalled()
  expect(billing.record).not.toHaveBeenCalled()
})

it.each([false, true])(
  'uses the same standard price for report and account record (BYOK=%s)',
  async (isByok) => {
    const nativeScope = { ...scope, model: 'openrouter/openai/gpt-4.1' }
    const observed = { inputTokens: 1000, outputTokens: 100, totalTokens: 1100 }
    const accounting = await usageProcessors(nativeScope)
    const agent = new Agent({
      id: 'standard-cost-test',
      name: 'Standard cost test',
      instructions: '',
      model: new MastraLanguageModelV2Mock({
        doGenerate: async () => ({
          content: [{ type: 'text', text: 'answer' }],
          usage: observed,
          finishReason: 'stop',
          warnings: [],
          providerMetadata: {
            openrouter: {
              usage: { cost: 99, isByok, costDetails: { upstreamInferenceCost: 25 } },
            },
          },
        }),
      }),
      inputProcessors: accounting.inputProcessors,
      outputProcessors: accounting.outputProcessors,
    })
    const result = await agent.generate('hello', { runId: nativeScope.runId, maxSteps: 1 })
    await accounting.verifyComplete()
    const cost = accounting.getCost()
    expect(cost).toMatchObject({ total: 0.0028, currency: 'USD', status: 'estimated' })
    const assistant = result.messages.find((message) => message.role === 'assistant')!
    expect(projectNativeMessage(assistant).cost).toEqual(cost)
    expect(billing.admit).toHaveBeenCalledExactlyOnceWith(nativeScope)
    expect(billing.record).toHaveBeenCalledExactlyOnceWith(
      nativeScope,
      observed,
      cost,
      expect.stringMatching(/^run:[0-9a-f-]{36}:0:0$/)
    )
  }
)

it.each(['generate', 'stream'] as const)(
  'blocks tool execution after failed billing in %s',
  async (mode) => {
    const failure = new Error('Usage write failed')
    billing.record.mockRejectedValue(failure)
    const accounting = await usageProcessors(scope)
    const execute = vi.fn(async () => ({ success: true }))
    const agent = new Agent({
      id: 'usage-tool-test',
      name: 'Usage tool test',
      instructions: '',
      model: new MastraLanguageModelV2Mock({
        doGenerate: async () => ({
          content: [{ type: 'tool-call', toolCallId: 'effect', toolName: 'effect', input: '{}' }],
          usage,
          finishReason: 'tool-calls',
          warnings: [],
        }),
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'tool-call', toolCallId: 'effect', toolName: 'effect', input: '{}' },
              { type: 'finish', usage, finishReason: 'tool-calls' },
            ],
          }),
        }),
      }),
      tools: {
        effect: createTool({
          id: 'effect',
          description: 'Effect',
          inputSchema: z.object({}),
          execute,
        }),
      },
    })
    const options = {
      runId: scope.runId,
      maxSteps: 2,
      inputProcessors: accounting.inputProcessors,
      outputProcessors: accounting.outputProcessors,
    }
    try {
      if (mode === 'generate') await agent.generate('Run the effect', options)
      else await (await agent.stream('Run the effect', options)).getFullOutput()
    } catch {
      // Either native failure representation must stop execution before tool dispatch.
    }
    await expect(accounting.verifyComplete()).rejects.toBe(failure)
    expect(accounting.getUsage()).toEqual(usage)
    expect(billing.record).toHaveBeenCalledOnce()
    expect(execute).not.toHaveBeenCalled()

    // The same valid tool call runs when its centralized accounting succeeds.
    billing.record.mockImplementation(async (_scope, _usage, cost) => cost)
    const allowed = await usageProcessors({ ...scope, runId: `${scope.runId}-allowed` })
    const allowedOptions = {
      ...options,
      runId: `${scope.runId}-allowed`,
      inputProcessors: allowed.inputProcessors,
      outputProcessors: allowed.outputProcessors,
    }
    if (mode === 'generate') await agent.generate('Run the effect', allowedOptions)
    else await (await agent.stream('Run the effect', allowedOptions)).getFullOutput()
    await allowed.verifyComplete()
    expect(execute).toHaveBeenCalled()
  }
)

it('prices cached input from the raw native step without counting it at the full input rate', async () => {
  const reported = {
    inputTokens: 1000,
    outputTokens: 100,
    totalTokens: 1100,
    cachedInputTokens: 800,
  }
  const accounting = await generate('stop', reported)
  await accounting.verifyComplete()
  expect(accounting.getCost().total).toBeCloseTo(0.0016)
  expect(billing.record).toHaveBeenCalledExactlyOnceWith(
    scope,
    { inputTokens: 1000, outputTokens: 100, totalTokens: 1100 },
    accounting.getCost(),
    expect.stringMatching(/^run:[0-9a-f-]{36}:0:0$/)
  )
})

it.each(['content-filter', 'error'] as const)(
  'accounts for reported usage without replacing a native %s outcome',
  async (finishReason) => {
    const reported = { inputTokens: 12, outputTokens: 3, totalTokens: 15 }
    const { outcome, ...accounting } = await generate(finishReason, reported)
    await accounting.verifyComplete()
    expect(outcome.status).toBe(finishReason === 'error' ? 'rejected' : 'fulfilled')
    if (outcome.status === 'rejected')
      expect(outcome.reason).toMatchObject({ id: 'AGENT_STREAM_ERROR' })
    else {
      expect(outcome.value).toMatchObject({ finishReason })
      expect(() => assertNativeCompletion(outcome.value)).toThrow('did not complete successfully')
    }
    expect(accounting.getUsage()).toEqual(reported)
    expect(billing.record).toHaveBeenCalledExactlyOnceWith(
      scope,
      reported,
      accounting.getCost(),
      expect.stringMatching(/^run:[0-9a-f-]{36}:0:0$/)
    )
    expect(accounting.getCost().total).toBeCloseTo(0.000048)
    expect(billing.contact).toHaveBeenCalledOnce()
  }
)

it.each(
  (['generate', 'stream'] as const).flatMap((mode) =>
    (
      [
        'abort',
        'timeout',
        'error',
        'before-contact',
        'admission-refused',
        'after-accounted',
        'pre-abort',
      ] as const
    ).map((outcome) => ({ mode, outcome }))
  )
)('tracks contacted unfinished costs in $mode ($outcome)', async ({ mode, outcome }) => {
  const abort = new AbortController()
  const failure = new DOMException(
    'Provider interrupted',
    outcome === 'timeout' ? 'TimeoutError' : 'AbortError'
  )
  const reported = { inputTokens: 1000, outputTokens: 100, totalTokens: 1100 }
  if (outcome === 'before-contact')
    billing.admit.mockImplementation(async () => {
      if (billing.contact.mock.calls.length) {
        abort.abort(failure)
        throw failure
      }
    })
  if (outcome === 'admission-refused')
    billing.begin.mockImplementation(async () => {
      if (billing.contact.mock.calls.length)
        throw new Error('Workflow execution is not accepting model requests')
      return true
    })
  if (outcome === 'after-accounted')
    billing.record.mockImplementation(async (_scope, _usage, cost) => {
      abort.abort(failure)
      return cost
    })
  if (outcome === 'pre-abort') abort.abort(failure)
  const accounting = await usageProcessors(
    outcome === 'timeout' ? scope : { ...scope, signal: abort.signal }
  )
  const contact = () => {
    billing.contact()
    if (billing.contact.mock.calls.length > 1) {
      if (outcome === 'error') throw new Error('Provider failed')
      abort.abort(failure)
      throw failure
    }
  }
  const agent = new Agent({
    id: 'interrupted-usage',
    name: 'Interrupted usage',
    instructions: '',
    model: new MastraLanguageModelV2Mock({
      doGenerate: async () => {
        contact()
        return {
          content: [{ type: 'tool-call', toolCallId: 'lookup', toolName: 'lookup', input: '{}' }],
          usage: reported,
          finishReason: 'tool-calls',
          warnings: [],
        }
      },
      doStream: async () => {
        contact()
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              { type: 'tool-call', toolCallId: 'lookup', toolName: 'lookup', input: '{}' },
              { type: 'finish', usage: reported, finishReason: 'tool-calls' },
            ],
          }),
        }
      },
    }),
    tools: {
      lookup: createTool({
        id: 'lookup',
        description: 'Lookup',
        inputSchema: z.object({}),
        execute: async () => ({ success: true }),
      }),
    },
  })
  const options = {
    runId: scope.runId,
    maxSteps: 2,
    abortSignal: abort.signal,
    inputProcessors: accounting.inputProcessors,
    outputProcessors: accounting.outputProcessors,
  }
  let nativeError: unknown
  try {
    if (mode === 'generate') await agent.generate('Look up', options)
    else await (await agent.stream('Look up', options)).getFullOutput()
  } catch (error) {
    nativeError = error
  }
  if (outcome === 'error') {
    expect(nativeError).toMatchObject({ message: 'Provider failed' })
    await accounting.verifyComplete()
  } else
    await expect(accounting.verifyComplete()).rejects.toThrow(
      outcome === 'timeout' ? 'unfinished provider request' : undefined
    )
  const incomplete = ['abort', 'timeout', 'error'].includes(outcome)
  expect(billing.contact).toHaveBeenCalledTimes(outcome === 'pre-abort' ? 0 : incomplete ? 2 : 1)
  expect(accounting.getUsage()).toEqual(outcome === 'pre-abort' ? {} : reported)
  expect(billing.record).toHaveBeenCalledTimes(
    outcome === 'pre-abort' ? 0 : outcome === 'error' ? 2 : 1
  )
  if (outcome === 'pre-abort') expect(accounting.getCost()).toEqual({ status: 'unavailable' })
  else if (incomplete) {
    expect(accounting.getCost()).toMatchObject({ status: 'partial', currency: 'USD' })
    expect(accounting.getCost().availableTotal).toBeCloseTo(0.0028)
    expect(accounting.getCost()).not.toHaveProperty('total')
  } else {
    expect(accounting.getCost()).toMatchObject({ status: 'estimated', currency: 'USD' })
    expect(accounting.getCost().total).toBeCloseTo(0.0028)
  }
})
