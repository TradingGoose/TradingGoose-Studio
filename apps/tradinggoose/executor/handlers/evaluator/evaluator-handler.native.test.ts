import '@/lib/mastra/__test-utils__/managed-services'
vi.mock('@/lib/mastra/connections', async (original) => ({
  ...(await original<typeof import('@/lib/mastra/connections')>()),
  createConfiguredLanguageModel: vi.fn(() => state.model),
}))
vi.mock('@/lib/mastra/usage-processors', () => ({
  usageProcessors: vi.fn(async () => ({
    inputProcessors: [],
    outputProcessors: [],
    getUsage: () => state.usage,
    getCost: () => ({ status: 'unavailable' as const }),
    verifyComplete: () => state.verify(),
  })),
}))
vi.mock('@/lib/mastra/runtime', () => ({ getMastra: async () => undefined }))

import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createConfiguredLanguageModel } from '@/lib/mastra/connections'
import { getInferenceFacts } from '@/lib/mastra/result'
import { resultAccounting } from '@/lib/mastra/usage'
import { usageProcessors } from '@/lib/mastra/usage-processors'
import { createMinimalWorkflow, createMockContext } from '@/executor/__test-utils__/executor-mocks'
import { RouterBlockHandler } from '../router/router-handler'
import { EvaluatorBlockHandler } from './evaluator-handler'

const state = vi.hoisted(() => {
  const usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } = {}
  return { model: null as any, result: undefined as any, usage, verify: vi.fn() }
})
vi.mock('@/blocks/blocks/router', () => ({
  generateRouterPrompt: (prompt: string) => prompt,
}))
vi.mock('@mastra/core/agent', async (original) => {
  const native = await original<typeof import('@mastra/core/agent')>()
  return {
    ...native,
    Agent: class extends native.Agent {
      constructor(config: any) {
        super({ ...config, model: state.model })
      }
      async generate(...args: any[]) {
        state.result = await (super.generate as any)(...args)
        return state.result
      }
    },
  }
})
beforeEach(() => {
  vi.clearAllMocks()
  state.result = undefined
  state.usage = {}
  state.verify.mockReset().mockResolvedValue(undefined)
})

it('rejects the installed native engine resolving an aborted score-less structured result', async () => {
  let cancelled = false
  state.model = new MastraLanguageModelV2Mock({
    doGenerate: async (options) =>
      new Promise((_resolve, reject) => {
        options.abortSignal?.addEventListener('abort', () => reject(options.abortSignal?.reason), {
          once: true,
        })
        cancelled = true
      }),
  })
  const outcome = new EvaluatorBlockHandler().execute(
    { id: 'evaluator', metadata: { id: 'evaluator' } } as any,
    {
      model: 'openai/gpt-4.1',
      metrics: [{ name: 'Accuracy', range: { min: 0, max: 10 } }],
      content: 'Answer',
    },
    {
      userId: 'actor',
      workspaceId: 'workspace',
      shouldCancelExecution: async () => cancelled,
    } as any
  )
  const failure = await outcome.then(
    () => {
      throw new Error('Aborted native generation unexpectedly succeeded')
    },
    (error: unknown) => error
  )
  expect(failure).toBeInstanceOf(Error)
  expect(state.result).toMatchObject({ finishReason: 'aborted', object: undefined })
  // An abort before any native response has no completed processor usage.
  const expected = await resultAccounting(state.usage)
  expect(getInferenceFacts(failure)).toMatchObject({
    ...expected,
    generatedFields: ['model', 'tokens', 'cost'],
  })
  expect(expected.cost).toEqual({ status: 'unavailable' })
  expect(state.model.doGenerateCalls).toHaveLength(1)
})

describe('canonical settings and processor usage before financial refusal', () => {
  it.each(['evaluator', 'router'] as const)(
    'uses %s normalized settings and accepted processor counts',
    async (kind) => {
      let contacts = 0
      state.usage = { totalTokens: 7 }
      state.verify.mockRejectedValue(new Error('Financial acceptance refused'))
      state.model = new MastraLanguageModelV2Mock({
        doGenerate: async () => {
          contacts += 1
          return {
            content: [{ type: 'text', text: kind === 'evaluator' ? '{"accuracy":8}' : 'target' }],
            finishReason: 'stop',
            usage: { inputTokens: 11, outputTokens: 6, totalTokens: 17 },
            warnings: [],
          }
        },
      })
      const workflow = createMinimalWorkflow()
      const block = workflow.blocks[1]
      block.metadata = { ...block.metadata, id: kind }
      block.id = kind
      if (kind === 'router') {
        workflow.blocks.push({
          ...block,
          id: 'target',
          metadata: { ...block.metadata, id: 'agent', name: 'Target' },
        })
        workflow.connections = [{ source: block.id, target: 'target' }]
      }
      const context = {
        ...createMockContext({ workflow, workspaceId: 'workspace' }),
        userId: 'actor',
      }
      const operation =
        kind === 'evaluator'
          ? new EvaluatorBlockHandler().execute(
              block,
              {
                model: 'openai/gpt-4.1',
                metrics: [{ name: 'Accuracy', range: { min: 0, max: 10 } }],
                content: 'Answer',
                temperature: '0.1',
                apiKey: '  ',
              },
              context
            )
          : new RouterBlockHandler().execute(
              block,
              { model: 'openai/gpt-4.1', prompt: 'Select target', temperature: '0.1', apiKey: '' },
              context
            )
      const failure = await operation.then(
        () => {
          throw new Error('Financial refusal unexpectedly succeeded')
        },
        (error: unknown) => error
      )
      expect(failure).toBeInstanceOf(Error)
      expect(createConfiguredLanguageModel).toHaveBeenCalledWith('openai/gpt-4.1', undefined)
      expect(usageProcessors).toHaveBeenCalledWith(
        expect.objectContaining({ funding: 'account', actorUserId: 'actor' })
      )
      expect(state.result.finishReason).toBe('stop')
      expect(state.result.totalUsage).toMatchObject({
        inputTokens: 11,
        outputTokens: 6,
        totalTokens: 17,
      })
      expect(getInferenceFacts(failure)).toMatchObject({
        model: 'openai/gpt-4.1',
        tokens: { total: 7 },
        cost: { status: 'unavailable' },
        generatedFields: ['model', 'tokens', 'cost'],
      })
      expect(state.verify).toHaveBeenCalledOnce()
      expect(contacts).toBe(1)
      expect(state.model.doGenerateCalls[0].temperature).toBe(0.1)
    }
  )
})
