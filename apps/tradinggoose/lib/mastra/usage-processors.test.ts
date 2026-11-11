/** @vitest-environment node */
import { Agent } from '@mastra/core/agent'
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import { beforeEach, expect, it, vi } from 'vitest'
import { NATIVE_AGENT_POLICY } from './options'
import { usageProcessors } from './usage-processors'

const billing = vi.hoisted(() => ({ admit: vi.fn(), record: vi.fn(), contact: vi.fn() }))
vi.mock('@/lib/billing/model-usage', () => ({
  assertModelUsageAllowed: billing.admit,
  recordModelUsage: billing.record,
}))
const scope = { actorUserId: 'actor', runId: 'run', purpose: 'copilot' }
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
  expect(billing.record).toHaveBeenCalledExactlyOnceWith(scope, usage)
  expect(billing.admit.mock.invocationCallOrder[0]).toBeLessThan(
    billing.contact.mock.invocationCallOrder[0]
  )
  expect(accounting.getUsage()).toEqual(usage)
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

it.each(['content-filter', 'error'] as const)(
  'accounts for reported usage before rejecting a %s outcome',
  async (finishReason) => {
    const reported = { inputTokens: 12, outputTokens: 3, totalTokens: 15 }
    const accounting = await generate(finishReason, reported)
    await expect(accounting.verifyComplete()).rejects.toThrow('did not complete successfully')
    expect(accounting.getUsage()).toEqual(reported)
    expect(billing.record).toHaveBeenCalledExactlyOnceWith(scope, reported)
    expect(billing.contact).toHaveBeenCalledOnce()
  }
)
