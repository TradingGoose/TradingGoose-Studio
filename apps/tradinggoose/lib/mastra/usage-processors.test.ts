/** @vitest-environment node */
import { Agent } from '@mastra/core/agent'
import type { OutputProcessor } from '@mastra/core/processors'
import { MastraLanguageModelV2Mock, simulateReadableStream } from '@mastra/core/test-utils/llm-mock'
import { createTool } from '@mastra/core/tools'
import { beforeEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { projectNativeMessage } from './messages'
import { NATIVE_AGENT_POLICY } from './options'
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

beforeEach(() => {
  vi.clearAllMocks()
  billing.admit.mockResolvedValue(undefined)
  billing.begin.mockResolvedValue(false)
  billing.record.mockImplementation(async (_scope, _usage, cost) => cost)
})

async function generate(
  finishReason: 'stop' | 'content-filter' | 'error' = 'stop',
  reportedUsage = usage,
  repeatOutput = false
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
    ...NATIVE_AGENT_POLICY,
    id: 'usage-test',
    name: 'Usage test',
    instructions: '',
    model,
    inputProcessors: accounting.inputProcessors,
    outputProcessors: repeatOutput
      ? accounting.outputProcessors.map(
          (processor): OutputProcessor => ({
            ...processor,
            async processOutputStep(args) {
              await processor.processOutputStep!(args)
              return processor.processOutputStep!(args)
            },
          })
        )
      : accounting.outputProcessors,
  })
  try {
    await agent.generate('hello', { runId: scope.runId, maxSteps: 1 })
  } catch {
    // Installed core can surface a processor failure directly or through its error result.
  }
  return accounting
}

it('checks Studio admission before contact and records actual native tokens once', async () => {
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

it('records duplicated native output processing only once for its owned attempt', async () => {
  const accounting = await generate('stop', usage, true)
  await accounting.verifyComplete()
  expect(billing.begin).toHaveBeenCalledOnce()
  expect(billing.record).toHaveBeenCalledOnce()
  expect(billing.record.mock.calls[0][3]).toBe(billing.begin.mock.calls[0][1])
  expect(accounting.getUsage()).toEqual(usage)
  expect(accounting.getCost().total).toBeCloseTo(0.000028)
})

it('does not contact a provider when attempt persistence fails', async () => {
  const failure = new Error('Native attempt persistence failed')
  billing.begin.mockRejectedValue(failure)
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
      ...NATIVE_AGENT_POLICY,
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

it('stops model contact when Studio refuses admission', async () => {
  const failure = new Error('Usage allowance exhausted')
  billing.admit.mockRejectedValue(failure)
  const accounting = await generate()
  await expect(accounting.verifyComplete()).rejects.toBe(failure)
  expect(billing.contact).not.toHaveBeenCalled()
  expect(billing.record).not.toHaveBeenCalled()
})

it('retains observed usage and latches a deferred accounting error', async () => {
  const failure = new Error('Usage write failed')
  billing.record.mockRejectedValue(failure)
  const accounting = await generate()
  await expect(accounting.verifyComplete()).rejects.toBe(failure)
  expect(accounting.getUsage()).toEqual(usage)
})

it.each(['generate', 'stream'] as const)(
  'blocks tool execution after failed billing in %s',
  async (mode) => {
    const failure = new Error('Usage write failed')
    billing.record.mockRejectedValue(failure)
    const accounting = await usageProcessors(scope)
    const execute = vi.fn(async () => ({ success: true }))
    const agent = new Agent({
      ...NATIVE_AGENT_POLICY,
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
  'accounts for reported usage before rejecting a %s outcome',
  async (finishReason) => {
    const reported = { inputTokens: 12, outputTokens: 3, totalTokens: 15 }
    const accounting = await generate(finishReason, reported)
    await expect(accounting.verifyComplete()).rejects.toThrow('did not complete successfully')
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
    (['abort', 'timeout', 'error', 'before-contact', 'after-accounted', 'pre-abort'] as const).map(
      (outcome) => ({ mode, outcome })
    )
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
    ...NATIVE_AGENT_POLICY,
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
  try {
    if (mode === 'generate') await agent.generate('Look up', options)
    else await (await agent.stream('Look up', options)).getFullOutput()
  } catch {
    // Native errors and cancellation both retain the accounting observed before failure.
  }
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
