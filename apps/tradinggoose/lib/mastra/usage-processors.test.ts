/** @vitest-environment node */
import { Agent } from '@mastra/core/agent'
import { MastraLanguageModelV2Mock, simulateReadableStream } from '@mastra/core/test-utils/llm-mock'
import { createTool } from '@mastra/core/tools'
import { beforeEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { NATIVE_AGENT_POLICY } from './options'
import { usageProcessors } from './usage-processors'

const billing = vi.hoisted(() => ({ admit: vi.fn(), record: vi.fn(), contact: vi.fn() }))
vi.mock('@/lib/billing/model-usage', () => ({
  assertModelUsageAllowed: billing.admit,
  recordModelUsage: billing.record,
}))
const scope = { actorUserId: 'actor', runId: 'run', purpose: 'copilot', model: 'openai/gpt-4.1' }
const usage = { inputTokens: 2, outputTokens: 3, totalTokens: 5 }

beforeEach(() => {
  vi.clearAllMocks()
  billing.admit.mockResolvedValue(undefined)
  billing.record.mockResolvedValue(undefined)
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
    ...NATIVE_AGENT_POLICY,
    id: 'usage-test',
    name: 'Usage test',
    instructions: '',
    model,
    inputProcessors: accounting.inputProcessors,
    outputProcessors: accounting.outputProcessors,
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
  expect(billing.record).toHaveBeenCalledExactlyOnceWith(scope, usage, accounting.getCost())
  expect(billing.admit.mock.invocationCallOrder[0]).toBeLessThan(
    billing.contact.mock.invocationCallOrder[0]
  )
  expect(accounting.getUsage()).toEqual(usage)
  expect(accounting.getCost().total).toBeCloseTo(0.000028)
})

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
    billing.record.mockResolvedValue(undefined)
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
    accounting.getCost()
  )
})

it.each(['content-filter', 'error'] as const)(
  'accounts for reported usage before rejecting a %s outcome',
  async (finishReason) => {
    const reported = { inputTokens: 12, outputTokens: 3, totalTokens: 15 }
    const accounting = await generate(finishReason, reported)
    await expect(accounting.verifyComplete()).rejects.toThrow('did not complete successfully')
    expect(accounting.getUsage()).toEqual(reported)
    expect(billing.record).toHaveBeenCalledExactlyOnceWith(scope, reported, accounting.getCost())
    expect(accounting.getCost().total).toBeCloseTo(0.000048)
    expect(billing.contact).toHaveBeenCalledOnce()
  }
)
