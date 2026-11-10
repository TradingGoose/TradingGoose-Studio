/** @vitest-environment node */
import { randomUUID } from 'node:crypto'
import { Mastra } from '@mastra/core/mastra'
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import { createTool } from '@mastra/core/tools'
import { Memory } from '@mastra/memory'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createNativeStorage } from '@/lib/mastra/runtime'
import { createCopilotAgent } from './agent'

const url = process.env.MASTRA_TEST_DATABASE_URL
const disposable =
  url &&
  ['127.0.0.1', 'localhost'].includes(new URL(url).hostname) &&
  new URL(url).pathname.endsWith('_disposable')
describe.runIf(Boolean(disposable))('built-in Copilot PostgreSQL continuation', () => {
  let first: ReturnType<typeof createNativeStorage>
  let second: ReturnType<typeof createNativeStorage>
  const threads: string[] = []
  beforeAll(async () => {
    first = createNativeStorage(url!, true)
    await first.storage.init()
    await first.verifyCapabilities()
    second = createNativeStorage(url!)
    await second.verifyCapabilities()
  }, 30000)
  afterAll(async () => {
    if (first) {
      const memory = await first.storage.getStore('memory')
      for (const threadId of threads) await memory!.deleteThread({ threadId })
      await first.close()
    }
    await second?.close()
  }, 30000)

  function instance(native: typeof first) {
    const memory = new Memory({
      storage: native.storage,
      options: {
        messageHistory: { maxTokens: 32000 },
        generateTitle: false,
        semanticRecall: false,
        workingMemory: { enabled: false },
        observationalMemory: false,
      },
    })
    const agent = createCopilotAgent(memory)
    new Mastra({
      agents: { copilot: agent },
      storage: native.storage,
      recovery: { workflows: 'off', durableAgents: 'off' },
    })
    return agent
  }
  function model(toolName?: string) {
    return new MastraLanguageModelV2Mock({
      doGenerate: async () => ({
        content: toolName
          ? [
              {
                type: 'tool-call' as const,
                toolCallId: 'original-call',
                toolName,
                input: '{"value":"exact🔥"}',
              },
            ]
          : [{ type: 'text' as const, text: 'Completed' }],
        finishReason: toolName ? 'tool-calls' : 'stop',
        usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
        warnings: [],
      }),
    })
  }
  function conversation() {
    const threadId = `copilot-continuation:${randomUUID()}`
    threads.push(threadId)
    return { threadId, resourceId: `copilot-resource:${randomUUID()}` }
  }

  it('discovers an approval on a second Studio instance and executes concurrent duplicate approvals once', async () => {
    const scope = conversation()
    const runId = randomUUID()
    const execute = vi.fn(async ({ value }: { value: string }) => ({
      value,
      businessResult: 'kept',
    }))
    const toolsets = {
      fixture: {
        effect: createTool({
          id: 'effect',
          description: 'Test effect',
          inputSchema: z.object({ value: z.string() }),
          requireApproval: true,
          execute,
        }),
      },
    }
    const initial = await instance(first).generate(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Keep this exact request🔥' },
            {
              type: 'image',
              image: 'data:image/png;base64,aW1hZ2UgYnl0ZXM=',
              mediaType: 'image/png',
            },
          ],
        },
      ],
      {
        runId,
        memory: { thread: scope.threadId, resource: scope.resourceId },
        model: model('effect'),
        toolsets,
        maxSteps: 2,
      }
    )
    expect(initial.finishReason).toBe('suspended')
    expect(execute).not.toHaveBeenCalled()
    const cold = instance(second)
    const { runs } = await cold.listSuspendedRuns(scope)
    expect(runs).toEqual([
      expect.objectContaining({
        runId,
        threadId: scope.threadId,
        resourceId: scope.resourceId,
        toolCalls: [
          expect.objectContaining({
            toolCallId: 'original-call',
            toolName: 'effect',
            requiresApproval: true,
            args: { value: 'exact🔥' },
          }),
        ],
      }),
    ])
    expect((await cold.listSuspendedRuns({ ...scope, resourceId: 'foreign' })).runs).toEqual([])
    const options = {
      runId,
      toolCallId: 'original-call',
      model: model(),
      toolsets,
      memory: { thread: scope.threadId, resource: scope.resourceId },
      maxSteps: 2,
    }
    const outcomes = await Promise.allSettled([
      cold.approveToolCallGenerate(options),
      instance(first).approveToolCallGenerate(options),
    ])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(execute).toHaveBeenCalledOnce()
    expect((await cold.listSuspendedRuns(scope)).runs).toEqual([])
    const memory = (await second.storage.getStore('memory'))!
    const rows = (await memory.listMessages({ ...scope, page: 0, perPage: 100 })).messages
    const parts = rows.flatMap((row) => row.content.parts)
    expect(parts).toContainEqual(
      expect.objectContaining({
        type: 'file',
        data: 'data:image/png;base64,aW1hZ2UgYnl0ZXM=',
        mimeType: 'image/png',
      })
    )
    expect(JSON.stringify(parts)).toContain('businessResult')
    expect(JSON.stringify(parts)).toContain('exact🔥')
  }, 30000)

  it('rediscovers a browser suspension and validates a cold result against its original tool target', async () => {
    const scope = conversation()
    const runId = randomUUID()
    const completed = vi.fn()
    const browser = createTool({
      id: 'browser',
      description: 'Browser completion',
      inputSchema: z.object({ value: z.string() }),
      suspendSchema: z.object({ original: z.string() }),
      resumeSchema: z.object({ answer: z.string() }).strict(),
      execute: async ({ value }, context) => {
        if (!context.agent?.resumeData) return await context.agent?.suspend({ original: value })
        completed(context.agent.resumeData.answer)
        return { answer: context.agent.resumeData.answer }
      },
    })
    const toolsets = { fixture: { browser } }
    expect(
      (
        await instance(first).generate('Wait for the browser', {
          runId,
          model: model('browser'),
          toolsets,
          memory: { thread: scope.threadId, resource: scope.resourceId },
          maxSteps: 2,
        })
      ).finishReason
    ).toBe('suspended')
    const cold = instance(second)
    expect((await cold.listSuspendedRuns(scope)).runs[0].toolCalls).toEqual([
      expect.objectContaining({
        toolCallId: 'original-call',
        toolName: 'browser',
        requiresApproval: false,
        suspendPayload: { original: 'exact🔥' },
      }),
    ])
    await expect(
      cold.resumeGenerate(
        { answer: 'wrong target' },
        { runId, toolCallId: 'foreign', model: model(), toolsets }
      )
    ).rejects.toThrow()
    await expect(
      cold.resumeGenerate(
        { wrong: 'schema' },
        { runId, toolCallId: 'original-call', model: model(), toolsets }
      )
    ).rejects.toThrow()
    expect(completed).not.toHaveBeenCalled()
    const result = await cold.resumeGenerate(
      { answer: 'Browser acknowledged' },
      {
        runId,
        toolCallId: 'original-call',
        model: model(),
        toolsets,
        memory: { thread: scope.threadId, resource: scope.resourceId },
        maxSteps: 2,
      }
    )
    expect(result.text).toBe('Completed')
    expect(completed).toHaveBeenCalledExactlyOnceWith('Browser acknowledged')
    await expect(
      cold.resumeGenerate(
        { answer: 'duplicate' },
        { runId, toolCallId: 'original-call', model: model(), toolsets }
      )
    ).rejects.toThrow()
    expect(completed).toHaveBeenCalledOnce()
  }, 30000)
})
