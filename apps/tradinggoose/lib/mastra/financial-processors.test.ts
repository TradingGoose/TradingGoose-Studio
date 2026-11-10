import { Agent } from '@mastra/core/agent'
import type { MastraDBMessage } from '@mastra/core/agent/message-list'
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import { createTool } from '@mastra/core/tools'
import {
  type FinancialBinding,
  financialFingerprint,
  type ModelOccurrence,
  type OperationReceipt,
  occurrenceKey,
} from '@tradinggoose/billing'
import { beforeEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { financialProcessors } from './financial-processors'
import { NATIVE_AGENT_POLICY, trustedPrepareStep } from './options'
import type { NativeUsage } from './usage'

const state = vi.hoisted(() => ({
  order: [] as string[],
  failAccept: false,
  admit: vi.fn(),
  accept: vi.fn(),
  binding: {
    runId: 'financial-run',
    namespace: 'billing-usage:user:actor',
    key: 'binding',
    fingerprint: 'original',
    actorUserId: 'actor',
    workspaceId: null,
    workflowId: null,
    purpose: 'fixture',
  },
}))
vi.mock('@/lib/billing/native-finance', () => ({
  createFinancialInvocation: async () => state.binding,
  admitFinancialModelStep: state.admit,
  acceptFinancialModelStep: state.accept,
}))
beforeEach(() => {
  state.order.length = 0
  state.failAccept = false
  state.admit.mockReset().mockImplementation(async (_binding, occurrence) => {
    state.order.push(`admit:${occurrence.stepNumber}:${occurrence.retryCount}`)
  })
  state.accept.mockReset().mockImplementation(async (binding, occurrence) => {
    state.order.push(`accept:${occurrence.stepNumber}`)
    if (state.failAccept) throw new Error('financial acceptance failed')
    return canonicalReceipt(binding, occurrence)
  })
})
function canonicalReceipt(
  binding: FinancialBinding,
  occurrence: ModelOccurrence
): OperationReceipt {
  return {
    recordType: 'operation',
    fingerprint: financialFingerprint([binding.fingerprint, occurrenceKey(binding, occurrence)]),
    binding,
    identity: {
      root: { type: 'user', id: binding.actorUserId },
      actorUserId: binding.actorUserId,
      memberUserId: null,
      scope: 'user',
      period: null,
      billingEnabled: false,
      quote: {
        holdUsd: '0',
        multiplier: '1',
        modelUsd: 'unavailable',
        baseChargeUsd: '0',
        defaultGrant: false,
        billable: true,
      },
      workspaceId: null,
      workflowId: null,
      purpose: binding.purpose,
    },
    holdState: 'closed',
    contactState: 'accepted',
    appliedUsd: '0',
    modelUsd: 'unavailable',
    financialClosureState: 'closed',
    dispatchState: 'complete',
    dispatchAtMs: 0,
    markers: [],
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function completed(
  finance: Awaited<ReturnType<typeof financialProcessors>>,
  stepNumber = 0,
  retryCount = 0
) {
  return (finance.inputProcessors[0] as any).processLLMResponse({
    stepNumber,
    retryCount,
    chunks: [{ type: 'finish', payload: { stepResult: { reason: 'stop' } } }],
  })
}
async function processors(signal?: AbortSignal) {
  const finance = await financialProcessors({
    actorUserId: 'actor',
    runId: 'financial-run',
    purpose: 'fixture',
    signal,
  })
  return {
    ...finance,
    admit: (stepNumber: number, retryCount = 0) =>
      (finance.inputProcessors[0] as any).processInputStep({
        runId: 'financial-run',
        stepNumber,
        retryCount,
      }),
    accept: (
      stepNumber: number,
      toolCalls: unknown[] = [],
      retryCount = 0,
      usage: NativeUsage = { inputTokens: 2, outputTokens: 1, totalTokens: 3 }
    ) => {
      completed(finance, stepNumber, retryCount)
      return (finance.outputProcessors[0] as any).processOutputStep({
        stepNumber,
        retryCount,
        finishReason: 'stop',
        usage,
        toolCalls,
        messageList: {},
      })
    },
  }
}

it('accepts each native output before its tool and the next actual model contact', async () => {
  const finance = await financialProcessors({
    actorUserId: 'actor',
    workspaceId: 'workspace',
    runId: 'financial-run',
    purpose: 'fixture',
  })
  let calls = 0
  const model = new MastraLanguageModelV2Mock({
    doGenerate: async () => {
      const first = calls++ === 0
      state.order.push(`model:${calls - 1}`)
      return {
        content: first
          ? [{ type: 'tool-call', toolCallId: 'call', toolName: 'lookup', input: '{}' }]
          : [{ type: 'text', text: 'done' }],
        finishReason: first ? 'tool-calls' : 'stop',
        usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
        warnings: [],
      }
    },
  })
  const agent = new Agent({
    ...NATIVE_AGENT_POLICY,
    id: 'financial-fixture',
    name: 'fixture',
    instructions: '',
    model,
    inputProcessors: finance.inputProcessors,
    outputProcessors: finance.outputProcessors,
    tools: {
      lookup: createTool({
        id: 'lookup',
        description: 'lookup',
        inputSchema: z.object({}),
        execute: async () => {
          state.order.push('tool')
          return 'found'
        },
      }),
    },
  })
  const output = await agent.generate('test', {
    runId: 'financial-run',
    maxSteps: 3,
    modelSettings: { maxRetries: 0 },
    prepareStep: trustedPrepareStep(model),
    maxProcessorRetries: 0,
  })
  await finance.verifyComplete()
  expect(output.text).toBe('done')
  expect(state.order).toEqual([
    'admit:0:0',
    'model:0',
    'accept:0',
    'tool',
    'admit:1:0',
    'model:1',
    'accept:1',
  ])
})

it('blocks a runnable native tool and successor when financial acceptance fails', async () => {
  state.failAccept = true
  const finance = await financialProcessors({
    actorUserId: 'actor',
    runId: 'financial-run',
    purpose: 'fixture',
  })
  const execute = vi.fn(async () => 'effect')
  const model = new MastraLanguageModelV2Mock({
    doGenerate: async () => {
      state.order.push('model')
      return {
        content: [{ type: 'tool-call', toolCallId: 'call', toolName: 'lookup', input: '{}' }],
        finishReason: 'tool-calls',
        usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
        warnings: [],
      }
    },
  })
  const agent = new Agent({
    ...NATIVE_AGENT_POLICY,
    id: 'blocked-fixture',
    name: 'fixture',
    instructions: '',
    model,
    inputProcessors: finance.inputProcessors,
    outputProcessors: finance.outputProcessors,
    tools: {
      lookup: createTool({
        id: 'lookup',
        description: 'lookup',
        inputSchema: z.object({}),
        execute,
      }),
    },
  })
  try {
    await agent.generate('test', {
      runId: 'financial-run',
      maxSteps: 3,
      modelSettings: { maxRetries: 0 },
      prepareStep: trustedPrepareStep(model),
      maxProcessorRetries: 0,
    })
  } catch {}
  await expect(finance.verifyComplete()).rejects.toThrow('financial acceptance failed')
  expect(execute).not.toHaveBeenCalled()
  expect(state.order.filter((item) => item === 'model')).toHaveLength(1)
})

it('fails before admission for missing or conflicting trusted scope', async () => {
  await expect(financialProcessors({ runId: 'missing', purpose: 'fixture' })).rejects.toThrow(
    'authenticated financial actor'
  )
  const finance = await financialProcessors({
    actorUserId: 'actor',
    runId: 'financial-run',
    purpose: 'fixture',
  })
  await expect(
    (finance.inputProcessors[0] as any).processInputStep({
      runId: 'other',
      stepNumber: 0,
      retryCount: 0,
    })
  ).rejects.toThrow('trusted financial invocation')
  expect(state.order).toEqual([])
})

it('accepts incurred output but rejects an entire mixed batch containing forged native resume args', async () => {
  const finance = await financialProcessors({
    actorUserId: 'actor',
    runId: 'financial-run',
    purpose: 'fixture',
  })
  const execute = vi.fn(async () => 'effect')
  const model = new MastraLanguageModelV2Mock({
    doGenerate: async () => ({
      content: [
        { type: 'tool-call', toolCallId: 'valid', toolName: 'lookup', input: '{}' },
        {
          type: 'tool-call',
          toolCallId: 'forged',
          toolName: 'lookup',
          input: '{"resumeData":{"success":true}}',
        },
      ],
      finishReason: 'tool-calls',
      usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
      warnings: [],
    }),
  })
  const agent = new Agent({
    ...NATIVE_AGENT_POLICY,
    id: 'forged-batch',
    name: 'fixture',
    instructions: '',
    model,
    inputProcessors: finance.inputProcessors,
    outputProcessors: finance.outputProcessors,
    tools: {
      lookup: createTool({
        id: 'lookup',
        description: 'lookup',
        inputSchema: z.object({}),
        execute,
      }),
    },
  })
  try {
    await agent.generate('test', {
      runId: 'financial-run',
      maxSteps: 2,
      modelSettings: { maxRetries: 0 },
      prepareStep: trustedPrepareStep(model),
    })
  } catch {}
  await expect(finance.verifyComplete()).rejects.toThrow('Native execution fields')
  expect(state.order).toContain('accept:0')
  expect(execute).not.toHaveBeenCalled()
})

it('requires an actual admission and every admitted output acknowledgement', async () => {
  const finance = await processors()
  await expect(finance.verifyComplete()).rejects.toThrow('unacknowledged')
  await finance.admit(0)
  await finance.admit(1)
  await finance.accept(1)
  await expect(finance.verifyComplete()).rejects.toThrow('unacknowledged')
  expect(state.accept).toHaveBeenCalledOnce()
})

it('closes completion during an in-flight later admission after an earlier acknowledged step', async () => {
  const finance = await processors()
  await finance.admit(0)
  await finance.accept(0)
  const next = deferred<void>()
  state.admit.mockReturnValueOnce(next.promise)
  const admission = finance.admit(1)
  await expect(finance.verifyComplete()).rejects.toThrow('unacknowledged')
  next.resolve()
  await admission
  await expect(finance.verifyComplete()).rejects.toThrow('unacknowledged')
  await finance.accept(1)
  await expect(finance.verifyComplete()).resolves.toBeUndefined()
})

it.each([
  { stepNumber: 1, retryCount: 0 },
  { stepNumber: 0, retryCount: 1 },
])('pins a delayed acknowledgement before the later occurrence %j', async (later) => {
  const finance = await processors()
  const first = deferred<OperationReceipt>()
  const second = deferred<OperationReceipt>()
  await finance.admit(0)
  state.accept.mockReturnValueOnce(first.promise)
  const earlierOutput = finance.accept(0)
  await finance.admit(later.stepNumber, later.retryCount)
  state.accept.mockReturnValueOnce(second.promise)
  const laterOutput = finance.accept(later.stepNumber, [], later.retryCount)
  first.resolve(canonicalReceipt(state.binding, { stepNumber: 0, retryCount: 0 }))
  await earlierOutput
  await expect(finance.verifyComplete()).rejects.toThrow('unacknowledged')
  second.resolve(canonicalReceipt(state.binding, later))
  await laterOutput
  await expect(finance.verifyComplete()).resolves.toBeUndefined()
  expect(
    state.accept.mock.calls.map((call) => ({
      stepNumber: call[1].stepNumber,
      retryCount: call[1].retryCount,
    }))
  ).toEqual([{ stepNumber: 0, retryCount: 0 }, later])
})

it('does not forget an earlier unacknowledged step when the later acceptance resolves first', async () => {
  const finance = await processors()
  const first = deferred<OperationReceipt>()
  await finance.admit(0)
  state.accept.mockReturnValueOnce(first.promise)
  const earlierOutput = finance.accept(0)
  await finance.admit(1)
  await finance.accept(1)
  await expect(finance.verifyComplete()).rejects.toThrow('unacknowledged')
  first.resolve(canonicalReceipt(state.binding, { stepNumber: 0, retryCount: 0 }))
  await earlierOutput
  await expect(finance.verifyComplete()).resolves.toBeUndefined()
})

it('keeps a failed acknowledgement latched despite an outstanding later success', async () => {
  const finance = await processors()
  const first = deferred<OperationReceipt>()
  const second = deferred<OperationReceipt>()
  await finance.admit(0)
  state.accept.mockReturnValueOnce(first.promise)
  const earlierOutput = finance.accept(0)
  const refused = expect(earlierOutput).rejects.toThrow('commit acknowledgement lost')
  await finance.admit(1)
  state.accept.mockReturnValueOnce(second.promise)
  const laterOutput = finance.accept(1)
  first.reject(new Error('commit acknowledgement lost'))
  await refused
  second.resolve(canonicalReceipt(state.binding, { stepNumber: 1, retryCount: 0 }))
  await expect(laterOutput).rejects.toThrow('commit acknowledgement lost')
  await expect(finance.verifyComplete()).rejects.toThrow('commit acknowledgement lost')
  await expect(finance.admit(2)).rejects.toThrow('commit acknowledgement lost')
  expect(state.admit).toHaveBeenCalledTimes(2)
  expect(state.accept).toHaveBeenCalledTimes(2)
})

it('does not reset an existing acknowledgement or bypass canonical duplicate admission refusal', async () => {
  const finance = await processors()
  await finance.admit(0)
  await finance.accept(0)
  const duplicate = deferred<void>()
  state.admit.mockReturnValueOnce(duplicate.promise)
  const repeat = finance.admit(0)
  const refused = expect(repeat).rejects.toThrow('already admitted')
  await expect(finance.verifyComplete()).rejects.toThrow('unacknowledged')
  duplicate.reject(new Error('already admitted'))
  await refused
  await expect(finance.verifyComplete()).rejects.toThrow('already admitted')
  expect(state.admit).toHaveBeenCalledTimes(2)
  expect(state.accept).toHaveBeenCalledOnce()
})

it.each([
  { stepNumber: -1, retryCount: 0 },
  { stepNumber: 0, retryCount: -1 },
  { stepNumber: 0.5, retryCount: 0 },
])('validates canonical counters before admission: %j', async (occurrence) => {
  const finance = await processors()
  await expect(finance.admit(occurrence.stepNumber, occurrence.retryCount)).rejects.toThrow(
    'occurrence is invalid'
  )
  expect(state.admit).not.toHaveBeenCalled()
})

it('retains accepted facts but blocks completion and further contacts after cancellation', async () => {
  const controller = new AbortController()
  const finance = await processors(controller.signal)
  await finance.admit(0)
  state.accept.mockImplementationOnce(async (binding, occurrence) => {
    controller.abort(new Error('caller cancelled after output'))
    return canonicalReceipt(binding, occurrence)
  })
  await expect(finance.accept(0)).rejects.toThrow('caller cancelled')
  expect(state.accept).toHaveBeenCalledOnce()
  await expect(finance.verifyComplete()).rejects.toThrow('caller cancelled')
  await expect(finance.admit(1)).rejects.toThrow('caller cancelled')
  expect(state.admit).toHaveBeenCalledOnce()
})

it.each([undefined, null])('latches even a falsy acceptance rejection: %s', async (reason) => {
  const finance = await processors()
  await finance.admit(0)
  state.accept.mockRejectedValueOnce(reason)
  await expect(finance.accept(0)).rejects.toBe(reason)
  await expect(finance.verifyComplete()).rejects.toBe(reason)
  await expect(finance.admit(1)).rejects.toBe(reason)
  expect(state.admit).toHaveBeenCalledOnce()
  expect(state.accept).toHaveBeenCalledOnce()
})

it('retains copied completed usage before rejected acceptance without acknowledging completion', async () => {
  const finance = await processors()
  await finance.admit(0)
  const acceptance = deferred<OperationReceipt>()
  state.accept.mockReturnValueOnce(acceptance.promise)
  const usage = { inputTokens: 2, outputTokens: 3, totalTokens: 5 }
  const accepting = finance.accept(0, [], 0, usage)
  expect(finance.getUsage()).toEqual(usage)
  usage.totalTokens = 9000
  expect(finance.getUsage()).toEqual({ inputTokens: 2, outputTokens: 3, totalTokens: 5 })
  acceptance.reject(new Error('commit acknowledgement unavailable'))
  await expect(accepting).rejects.toThrow('commit acknowledgement unavailable')
  await expect(finance.verifyComplete()).rejects.toThrow('commit acknowledgement unavailable')
  await expect(finance.admit(1)).rejects.toThrow('commit acknowledgement unavailable')
  expect(state.accept).toHaveBeenCalledTimes(1)
})
it('deduplicates occurrence observations and keeps known fields without zero filling', async () => {
  const finance = await processors()
  await finance.admit(0)
  await finance.accept(0, [], 0, {
    inputTokens: 0,
    outputTokens: undefined,
    totalTokens: undefined,
  })
  await finance.accept(0, [], 0, { inputTokens: 40, outputTokens: 3, totalTokens: undefined })
  expect(finance.getUsage()).toEqual({ inputTokens: 0, outputTokens: 3 })
  const snapshot = finance.getUsage()
  snapshot.inputTokens = 100
  expect(finance.getUsage()).toEqual({ inputTokens: 0, outputTokens: 3 })
})
it.each([
  { step: 1, retry: 0 },
  { step: 0, retry: 1 },
])('refuses unmatched occurrence before recording usage: %j', async ({ step, retry }) => {
  const finance = await processors()
  await finance.admit(0)
  await expect(finance.accept(step, [], retry)).rejects.toThrow('Missing admitted')
  expect(finance.getUsage()).toEqual({})
  expect(state.accept).not.toHaveBeenCalled()
})
it('preserves separate known occurrences when a later acknowledgement fails', async () => {
  const finance = await processors()
  await finance.admit(0)
  await finance.accept(0)
  await finance.admit(1)
  state.failAccept = true
  await expect(
    finance.accept(1, [], 0, { inputTokens: 2, outputTokens: 3, totalTokens: 5 })
  ).rejects.toThrow()
  expect(finance.getUsage()).toEqual({ inputTokens: 4, outputTokens: 4, totalTokens: 8 })
})
it('drops invalid usage fields and never records output for a failed admission', async () => {
  const finance = await processors()
  await finance.admit(0)
  await finance.accept(0, [], 0, {
    inputTokens: Number.NaN,
    outputTokens: -1,
    totalTokens: Number.POSITIVE_INFINITY,
  })
  expect(finance.getUsage()).toEqual({})
  const refused = await processors()
  state.admit.mockRejectedValueOnce(new Error('admission refused'))
  await expect(refused.admit(0)).rejects.toThrow('admission refused')
  await expect(refused.accept(0)).rejects.toThrow('admission refused')
  expect(refused.getUsage()).toEqual({})
})

it('keeps retained usage request local and distinguishes retry occurrences', async () => {
  const first = await processors()
  const second = await processors()
  await first.admit(0)
  await second.admit(0)
  await first.accept(0, [], 0, { inputTokens: 0 })
  await first.admit(0, 1)
  await first.accept(0, [], 1, { outputTokens: 3 })
  expect(first.getUsage()).toEqual({ inputTokens: 0, outputTokens: 3 })
  expect(second.getUsage()).toEqual({})
  await second.accept(0, [], 0, { totalTokens: 7 })
  expect(second.getUsage()).toEqual({ totalTokens: 7 })
  expect(first.getUsage()).toEqual({ inputTokens: 0, outputTokens: 3 })
})

it('retains both actual installed-core steps when a later acceptance rejects without replay', async () => {
  const finance = await processors()
  let contacts = 0
  const tool = vi.fn(async () => 'found')
  const model = new MastraLanguageModelV2Mock({
    doGenerate: async () => {
      const first = contacts++ === 0
      return {
        content: first
          ? [{ type: 'tool-call', toolCallId: 'call', toolName: 'lookup', input: '{}' }]
          : [{ type: 'text', text: 'done' }],
        finishReason: first ? 'tool-calls' : 'stop',
        usage: first
          ? { inputTokens: 2, outputTokens: 3, totalTokens: 5 }
          : { inputTokens: 7, outputTokens: 11, totalTokens: 18 },
        warnings: [],
      }
    },
  })
  state.accept.mockImplementation(async (binding, occurrence) => {
    if (occurrence.stepNumber === 1) throw new Error('later acknowledgement refused')
    return canonicalReceipt(binding, occurrence)
  })
  const agent = new Agent({
    ...NATIVE_AGENT_POLICY,
    id: 'two-step-usage-fixture',
    name: 'fixture',
    instructions: '',
    model,
    inputProcessors: finance.inputProcessors,
    outputProcessors: finance.outputProcessors,
    tools: {
      lookup: createTool({
        id: 'lookup',
        description: 'lookup',
        inputSchema: z.object({}),
        execute: tool,
      }),
    },
  })
  await expect(
    agent.generate('test', {
      runId: 'financial-run',
      maxSteps: 3,
      modelSettings: { maxRetries: 0 },
      prepareStep: trustedPrepareStep(model),
      maxProcessorRetries: 0,
    })
  ).rejects.toThrow()
  expect(finance.getUsage()).toEqual({ inputTokens: 9, outputTokens: 14, totalTokens: 23 })
  await expect(finance.verifyComplete()).rejects.toThrow('later acknowledgement refused')
  expect(contacts).toBe(2)
  expect(tool).toHaveBeenCalledOnce()
  expect(state.accept).toHaveBeenCalledTimes(2)
  expect(state.admit).toHaveBeenCalledTimes(2)
})

it('captures the actual admitted public response before waiting for its one canonical acknowledgement', async () => {
  const acknowledgement = deferred<OperationReceipt>()
  state.accept.mockImplementation(async () => {
    state.order.push('accept:pending')
    return acknowledgement.promise
  })
  const rows: MastraDBMessage[] = [
    {
      id: 'actual-native-reply',
      role: 'assistant',
      createdAt: new Date(0),
      content: {
        format: 2,
        parts: [{ type: 'text', text: ' exact <working_memory>reply</working_memory>🔥\n ' }],
      },
    },
  ]
  const capture = vi.fn((observation) => {
    state.order.push('capture')
    expect(observation.key).toBe(
      occurrenceKey(state.binding, { stepNumber: 0, retryCount: 0, runId: 'financial-run' })
    )
    expect(observation.occurrence).toEqual({ stepNumber: 0, retryCount: 0, runId: 'financial-run' })
    expect(observation.readResponse()).toBe(rows)
    // The trusted callback receives a copy, never the occurrence used for acceptance.
    observation.occurrence.stepNumber = 9
  })
  const finance = await financialProcessors(
    { actorUserId: 'actor', runId: 'financial-run', purpose: 'fixture' },
    capture
  )
  await (finance.inputProcessors[0] as any).processInputStep({
    runId: 'financial-run',
    stepNumber: 0,
    retryCount: 0,
  })
  completed(finance)
  const output = (finance.outputProcessors[0] as any).processOutputStep({
    finishReason: 'stop',
    stepNumber: 0,
    retryCount: 0,
    usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
    toolCalls: [],
    messageList: { get: { response: { db: () => rows } } },
  })
  expect(state.order).toEqual(['admit:0:0', 'capture', 'accept:pending'])
  expect(finance.getUsage()).toEqual({ inputTokens: 2, outputTokens: 3, totalTokens: 5 })
  await expect(finance.verifyComplete()).rejects.toThrow('unacknowledged')
  const occurrence = { stepNumber: 0, retryCount: 0, runId: 'financial-run' }
  acknowledgement.resolve(canonicalReceipt(state.binding, occurrence))
  await output
  expect(state.accept).toHaveBeenCalledExactlyOnceWith(state.binding, {
    ...occurrence,
    usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
  })
  await expect(finance.verifyComplete()).resolves.toBeUndefined()
})

it.each([false, true])(
  'settles incurred work once after a failed response capture, with acceptance failure taking precedence (%s)',
  async (acceptanceFails) => {
    const captureError = new Error('Synthetic response projection failed')
    state.failAccept = acceptanceFails
    const capture = vi.fn(() => {
      throw captureError
    })
    const finance = await financialProcessors(
      { actorUserId: 'actor', runId: 'financial-run', purpose: 'fixture' },
      capture
    )
    await (finance.inputProcessors[0] as any).processInputStep({
      runId: 'financial-run',
      stepNumber: 0,
      retryCount: 0,
    })
    completed(finance)
    await expect(
      (finance.outputProcessors[0] as any).processOutputStep({
        finishReason: 'stop',
        stepNumber: 0,
        retryCount: 0,
        usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
        toolCalls: [],
        messageList: {},
      })
    ).rejects.toThrow(acceptanceFails ? 'financial acceptance failed' : captureError.message)
    expect(capture).toHaveBeenCalledOnce()
    expect(state.accept).toHaveBeenCalledOnce()
    expect(finance.getUsage()).toEqual({ inputTokens: 2, outputTokens: 3, totalTokens: 5 })
    await expect(finance.verifyComplete()).rejects.toThrow(
      acceptanceFails ? 'financial acceptance failed' : captureError.message
    )
  }
)

it('never captures an unadmitted output or treats its reply as an acknowledged occurrence', async () => {
  const capture = vi.fn()
  const finance = await financialProcessors(
    { actorUserId: 'actor', runId: 'financial-run', purpose: 'fixture' },
    capture
  )
  await expect(
    (finance.outputProcessors[0] as any).processOutputStep({
      stepNumber: 0,
      retryCount: 0,
      usage: {},
      messageList: {},
    })
  ).rejects.toThrow('Missing admitted')
  expect(capture).not.toHaveBeenCalled()
  expect(state.accept).not.toHaveBeenCalled()
})

it('captures and settles a completed response once before observing cancellation', async () => {
  const controller = new AbortController()
  const capture = vi.fn(() => controller.abort(new Error('Synthetic after-response cancellation')))
  const finance = await financialProcessors(
    { actorUserId: 'actor', runId: 'financial-run', purpose: 'fixture', signal: controller.signal },
    capture
  )
  await (finance.inputProcessors[0] as any).processInputStep({
    runId: 'financial-run',
    stepNumber: 0,
    retryCount: 0,
  })
  completed(finance)
  await expect(
    (finance.outputProcessors[0] as any).processOutputStep({
      finishReason: 'stop',
      stepNumber: 0,
      retryCount: 0,
      usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
      toolCalls: [],
      messageList: {},
    })
  ).rejects.toThrow('Synthetic after-response cancellation')
  expect(capture).toHaveBeenCalledOnce()
  expect(state.accept).toHaveBeenCalledOnce()
  expect(finance.getUsage()).toEqual({ inputTokens: 2, outputTokens: 3, totalTokens: 5 })
  await expect(finance.verifyComplete()).rejects.toThrow('Synthetic after-response cancellation')
})

it.each([undefined, 'error', 'abort', 'retry', 'tripwire', 'unknown', 'other'])(
  'retains observed facts but never accepts a callback without successful completion: %s',
  async (reason) => {
    const capture = vi.fn()
    const finance = await financialProcessors(
      { actorUserId: 'actor', runId: 'financial-run', purpose: 'fixture' },
      capture
    )
    await finance.inputProcessors[0]!.processInputStep!({
      runId: 'financial-run',
      stepNumber: 0,
      retryCount: 0,
    } as any)
    finance.inputProcessors[0]!.processLLMResponse!({
      stepNumber: 0,
      retryCount: 0,
      chunks: reason === undefined ? [] : [{ type: 'finish', payload: { stepResult: { reason } } }],
    } as any)
    await expect(
      finance.outputProcessors[0]!.processOutputStep!({
        stepNumber: 0,
        retryCount: 0,
        finishReason: reason,
        usage: { inputTokens: 7 },
        messageList: {},
      } as any)
    ).rejects.toThrow('successful completion')
    expect(capture).toHaveBeenCalledOnce()
    expect(finance.getUsage()).toEqual({ inputTokens: 7 })
    expect(state.accept).not.toHaveBeenCalled()
    await expect(finance.verifyComplete()).rejects.toThrow('successful completion')
    await expect(
      finance.inputProcessors[0]!.processInputStep!({
        runId: 'financial-run',
        stepNumber: 1,
        retryCount: 0,
      } as any)
    ).rejects.toThrow('successful completion')
    expect(state.admit).toHaveBeenCalledOnce()
  }
)

it('preserves the original deferred provider error and response facts despite a nominal successful finish', async () => {
  const original = new Error('Synthetic original provider failure after finish')
  const capture = vi.fn()
  const finance = await financialProcessors(
    { actorUserId: 'actor', runId: 'financial-run', purpose: 'fixture' },
    capture
  )
  await finance.inputProcessors[0]!.processInputStep!({
    runId: 'financial-run',
    stepNumber: 0,
    retryCount: 0,
  } as any)
  completed(finance)
  expect(
    await finance.outputProcessors[0]!.processOutputStream!({
      part: { type: 'error', runId: 'financial-run', payload: { error: original } },
      retryCount: 0,
    } as any)
  ).toMatchObject({ type: 'error' })
  await expect(
    finance.outputProcessors[0]!.processOutputStep!({
      stepNumber: 0,
      retryCount: 0,
      finishReason: 'stop',
      usage: { outputTokens: 3 },
      messageList: {},
    } as any)
  ).rejects.toBe(original)
  expect(capture).toHaveBeenCalledOnce()
  expect(finance.getUsage()).toEqual({ outputTokens: 3 })
  expect(state.accept).not.toHaveBeenCalled()
  await expect(finance.verifyComplete()).rejects.toBe(original)
})

it.each(['generate', 'stream'] as const)(
  'installed core %s cannot settle a thrown no-response model contact',
  async (method) => {
    const original = new Error('Synthetic failed actual model contact')
    let contacts = 0
    const finance = await processors()
    const model = new MastraLanguageModelV2Mock({
      doGenerate: async () => {
        contacts++
        throw original
      },
      doStream: async () => {
        contacts++
        throw original
      },
    })
    const agent = new Agent({
      id: `failed-${method}`,
      name: 'Failed contact',
      instructions: 'test',
      model,
      inputProcessors: finance.inputProcessors,
      outputProcessors: finance.outputProcessors,
    })
    try {
      if (method === 'generate')
        await agent.generate('test', { runId: 'financial-run', modelSettings: { maxRetries: 0 } })
      else {
        const output = await agent.stream('test', {
          runId: 'financial-run',
          modelSettings: { maxRetries: 0 },
        })
        for await (const _part of output.fullStream) {
          /* exhaust actual public stream */
        }
      }
    } catch {
      /* actual core may return a failed result or reject */
    }
    expect(contacts).toBe(1)
    expect(state.admit).toHaveBeenCalledOnce()
    expect(state.accept).not.toHaveBeenCalled()
    expect(finance.getUsage()).toEqual({})
    await expect(finance.verifyComplete()).rejects.toThrow('Synthetic failed actual model contact')
  }
)

it.each(['partial-error', 'finish-error', 'abort'] as const)(
  'installed streaming core preserves genuine facts and leaves %s contact unaccepted',
  async (mode) => {
    const original = new Error('Synthetic streaming failure')
    let contacts = 0
    let captured = ''
    const finance = await financialProcessors(
      { actorUserId: 'actor', runId: 'financial-run', purpose: 'fixture' },
      ({ readResponse }) => {
        captured = JSON.stringify(readResponse())
      }
    )
    const model = new MastraLanguageModelV2Mock({
      doStream: async () => {
        contacts++
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'text-start', id: 'actual' })
              controller.enqueue({
                type: 'text-delta',
                id: 'actual',
                delta: 'genuine partial response',
              })
              controller.enqueue({ type: 'text-end', id: 'actual' })
              if (mode !== 'partial-error')
                controller.enqueue({
                  type: 'finish',
                  finishReason: 'stop',
                  usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
                })
              controller.enqueue({
                type: 'error',
                error:
                  mode === 'abort'
                    ? new DOMException('Synthetic stream abort', 'AbortError')
                    : original,
              })
              controller.close()
            },
          }),
        }
      },
    })
    const agent = new Agent({
      id: `failed-${mode}`,
      name: 'Failed partial',
      instructions: 'test',
      model,
      inputProcessors: finance.inputProcessors,
      outputProcessors: finance.outputProcessors,
    })
    try {
      const output = await agent.stream('test', {
        runId: 'financial-run',
        modelSettings: { maxRetries: 0 },
      })
      for await (const _part of output.fullStream) {
        /* observe all actual SDK parts */
      }
    } catch {
      /* retain original failure via financial latch below */
    }
    expect(contacts).toBe(1)
    expect(state.accept).not.toHaveBeenCalled()
    expect(captured).toContain('genuine partial response')
    if (mode === 'finish-error')
      expect(finance.getUsage()).toEqual({ inputTokens: 2, outputTokens: 3, totalTokens: 5 })
    await expect(finance.verifyComplete()).rejects.toThrow()
  }
)

it.each(['generate', 'stream'] as const)(
  'installed core %s accepts an empty successful stop without requiring reported usage',
  async (method) => {
    const finance = await processors()
    const model = new MastraLanguageModelV2Mock({
      doGenerate: async () => ({
        content: [],
        finishReason: 'stop',
        usage: { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined },
        warnings: [],
      }),
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: 'finish',
              finishReason: 'stop',
              usage: { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined },
            })
            controller.close()
          },
        }),
      }),
    })
    const agent = new Agent({
      id: `empty-${method}`,
      name: 'Empty success',
      instructions: 'test',
      model,
      inputProcessors: finance.inputProcessors,
      outputProcessors: finance.outputProcessors,
    })
    if (method === 'generate')
      await agent.generate('test', { runId: 'financial-run', modelSettings: { maxRetries: 0 } })
    else {
      const output = await agent.stream('test', {
        runId: 'financial-run',
        modelSettings: { maxRetries: 0 },
      })
      for await (const _part of output.fullStream) {
        /* full completion */
      }
    }
    expect(state.accept).toHaveBeenCalledOnce()
    expect(finance.getUsage()).toEqual({})
    await expect(finance.verifyComplete()).resolves.toBeUndefined()
  }
)
