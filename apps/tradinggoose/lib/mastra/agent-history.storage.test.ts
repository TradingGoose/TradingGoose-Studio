import { randomUUID } from 'node:crypto'
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import { Memory } from '@mastra/memory'
import { PostgresStore } from '@mastra/pg'
import {
  user,
  workflow,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
} from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ExecutionLogger } from '@/lib/logs/execution/logger'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { getInferenceFacts } from '@/lib/mastra/result'
import { type NativeUsage, sumNativeUsage } from '@/lib/mastra/usage'
import { AgentBlockHandler } from '@/executor/handlers/agent/agent-handler'
import type { ExecutionContext, StreamingExecution } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import { attachAgentHistory, deleteAgentHistory } from './agent-history'
import { projectNativeMessage } from './messages'

const fixture = vi.hoisted(() => ({
  url: process.env.MASTRA_TEST_DATABASE_URL,
  client: undefined as ReturnType<typeof import('postgres').default> | undefined,
  db: undefined as typeof import('@tradinggoose/db').db | undefined,
  memory: undefined as import('@mastra/memory').Memory | undefined,
  storage: undefined as import('@mastra/pg').PostgresStore | undefined,
  model: undefined as any,
  tool: vi.fn(),
}))
vi.mock('@tradinggoose/db', async () => {
  const { drizzle } = await import('drizzle-orm/postgres-js')
  const { default: postgres } = await import('postgres')
  const schema = await import('@tradinggoose/db/schema')
  if (!fixture.url) return { ...schema, db: {} }
  fixture.client = postgres(fixture.url, { max: 10, prepare: false })
  fixture.db = drizzle(fixture.client, { schema })
  return { ...schema, db: fixture.db }
})
vi.mock('./runtime', () => ({
  getMastra: async () => undefined,
  getAgentMemory: async () => fixture.memory!,
  getNativeMemoryStore: async () => (await fixture.storage!.getStore('memory'))!,
}))
vi.mock('./connections', async (original) => ({
  ...(await original<typeof import('./connections')>()),
  createConfiguredLanguageModel: () => fixture.model,
}))
vi.mock('./usage-processors', () => ({
  usageProcessors: async () => {
    const steps: Array<{ usage: NativeUsage }> = []
    return {
      inputProcessors: [],
      outputProcessors: [
        {
          id: 'history-test-usage',
          processOutputStep: (args: { usage: NativeUsage }) => {
            steps.push({ usage: args.usage })
          },
        },
      ],
      getUsage: () => sumNativeUsage(steps),
      getCost: () => ({ status: 'unavailable' as const }),
      verifyComplete: async () => {},
    }
  },
}))
vi.mock('@/lib/auth/hybrid', () => ({ AuthType: { API_KEY: 'api_key' } }))
vi.mock('@/blocks', () => ({ getAllBlocks: () => [], getBlock: () => undefined }))
vi.mock('@/tools', () => ({ executeTool: fixture.tool, getToolAsync: vi.fn() }))
vi.mock('@/tools/utils', () => ({ getTool: vi.fn() }))
vi.mock('@/executor/handlers/agent/skills-resolver', () => ({
  resolveSkillMetadata: async () => [],
}))
vi.mock('@/lib/billing/settings', () => ({
  getResolvedBillingSettings: async () => ({ billingEnabled: false }),
}))
vi.mock('@/lib/logs/events', () => ({ emitWorkflowExecutionCompleted: async () => {} }))

const usage = { inputTokens: 2, outputTokens: 3, totalTokens: 5 }
describe.runIf(Boolean(fixture.url))('workflow Agent canonical PostgreSQL history', () => {
  const actor = randomUUID()
  const workspaceId = randomUUID()
  const workflowId = randomUUID()
  const snapshotId = randomUUID()
  const threads = new Set<string>()
  let native: PostgresStore
  beforeAll(async () => {
    native = new PostgresStore({
      id: 'agent-history-test',
      connectionString: fixture.url!,
      schemaName: 'mastra',
    })
    await native.init()
    fixture.storage = native
    fixture.memory = new Memory({
      storage: native,
      options: {
        messageHistory: { maxTokens: 32000 },
        semanticRecall: false,
        workingMemory: { enabled: false },
        generateTitle: false,
      },
    })
    const at = new Date()
    await fixture.db!.insert(user).values({
      id: actor,
      name: 'History test',
      email: `${actor}@test.invalid`,
      emailVerified: true,
      createdAt: at,
      updatedAt: at,
    })
    await fixture.db!.insert(workspace).values({
      id: workspaceId,
      ownerId: actor,
      billingOwnerType: 'user',
      billingOwnerUserId: actor,
      name: 'History test',
      createdAt: at,
      updatedAt: at,
    })
    await fixture.db!.insert(workflow).values({
      id: workflowId,
      userId: actor,
      workspaceId,
      name: 'History test',
      lastSynced: at,
      createdAt: at,
      updatedAt: at,
    })
    await fixture
      .db!.insert(workflowExecutionSnapshots)
      .values({ id: snapshotId, workspaceId, workflowId, stateHash: randomUUID(), stateData: {} })
  }, 30000)
  afterAll(async () => {
    if (native) {
      const store = (await native.getStore('memory'))!
      for (const threadId of threads) await store.deleteThread({ threadId })
      await native.close()
    }
    if (fixture.db) {
      await fixture.db.delete(workspace).where(eq(workspace.id, workspaceId))
      await fixture.db.delete(user).where(eq(user.id, actor))
    }
    await fixture.client?.end({ timeout: 2 })
  }, 20000)

  it.each([false, true])(
    'persists real Agent inputs, tool calls/results, turns and output (stream=%s)',
    async (stream) => {
      fixture.tool.mockClear()
      const executionId = randomUUID()
      const logId = randomUUID()
      const at = new Date()
      let calls = 0
      fixture.model = new MastraLanguageModelV2Mock({
        doGenerate: async () =>
          ++calls === 1
            ? {
                content: [
                  {
                    type: 'tool-call',
                    toolCallId: 'lookup-call',
                    toolName: 'custom_lookup',
                    input: '{"query":"exact"}',
                  },
                ],
                finishReason: 'tool-calls',
                usage,
                warnings: [],
              }
            : {
                content: [{ type: 'text', text: 'Exact final answer 🔥' }],
                finishReason: 'stop',
                usage,
                warnings: [],
              },
        doStream: async () => {
          const first = ++calls === 1
          return {
            stream: new ReadableStream({
              start(controller) {
                if (first)
                  controller.enqueue({
                    type: 'tool-call',
                    toolCallId: 'lookup-call',
                    toolName: 'custom_lookup',
                    input: '{"query":"exact"}',
                  })
                else {
                  controller.enqueue({ type: 'text-start', id: 'answer' })
                  controller.enqueue({
                    type: 'text-delta',
                    id: 'answer',
                    delta: 'Exact final answer 🔥',
                  })
                  controller.enqueue({ type: 'text-end', id: 'answer' })
                }
                controller.enqueue({
                  type: 'finish',
                  finishReason: first ? 'tool-calls' : 'stop',
                  usage,
                })
                controller.close()
              },
            }),
          }
        },
      })
      fixture.tool.mockResolvedValue({ success: true, output: { found: 'Exact tool result' } })
      await fixture.db!.insert(workflowExecutionLogs).values({
        id: logId,
        workspaceId,
        workflowId,
        executionId,
        stateSnapshotId: snapshotId,
        workflowSummary: { id: workflowId },
        level: 'info',
        trigger: 'manual',
        startedAt: at,
        executionData: { environment: { userId: actor, workspaceId, executionId, workflowId } },
      })
      const block = {
        id: 'agent',
        metadata: { id: 'agent', name: 'Agent' },
        config: { params: {} },
      } as SerializedBlock
      const context = {
        stream,
        workspaceId,
        workflowId,
        executionId,
        workflowLogId: logId,
        userId: actor,
        blockStates: new Map(),
        environmentVariables: {},
        workflowVariables: {},
      } as ExecutionContext
      const executed = await new AgentBlockHandler().execute(
        block,
        {
          model: 'openai/gpt-4.1',
          systemPrompt: 'Exact selected policy',
          userPrompt: 'Exact first question',
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
        context
      )
      let output: Record<string, any>
      if (stream) {
        const streamed = executed as StreamingExecution
        const reader = streamed.stream.getReader()
        while (!(await reader.read()).done) {}
        output = streamed.execution.output
      } else output = executed as Record<string, any>
      const facts = getInferenceFacts(output)!
      expect(facts.tokens).toEqual({ prompt: 4, completion: 6, total: 10 })
      expect(facts.history).toBeDefined()
      threads.add(facts.history!.threadId)
      const traceSpans = buildTraceSpans({
        success: true,
        output: {},
        logs: [
          {
            id: randomUUID(),
            blockId: block.id,
            blockType: 'agent',
            blockName: 'Agent',
            startedAt: at.toISOString(),
            endedAt: new Date().toISOString(),
            durationMs: 1,
            success: true,
            input: {},
            output,
            inference: facts,
          },
        ],
      }).traceSpans
      await new ExecutionLogger().completeWorkflowExecution({
        executionId,
        workflowLogId: logId,
        workspaceId,
        endedAt: new Date().toISOString(),
        totalDurationMs: 1,
        finalOutput: output,
        success: true,
        traceSpans,
      })
      const [saved] = await fixture
        .db!.select()
        .from(workflowExecutionLogs)
        .where(eq(workflowExecutionLogs.id, logId))
      const detailed = await attachAgentHistory(saved, actor)
      const spans = (detailed.executionData as any).traceSpans
      const agent = spans
        .flatMap((span: any) => [span, ...(span.children ?? [])])
        .find((span: any) => span.agentHistory)
      const nativeMessages = (
        await (await native.getStore('memory'))!.listMessages({
          threadId: facts.history!.threadId,
          resourceId: facts.history!.resourceId,
          page: 0,
          perPage: 100,
          orderBy: { field: 'createdAt', direction: 'ASC' },
        })
      ).messages
      expect(agent.agentHistory).toEqual(nativeMessages.map(projectNativeMessage))
      expect(agent.input.systemMessages).toEqual([
        { role: 'system', content: 'Exact selected policy' },
      ])
      const text = JSON.stringify(nativeMessages)
      for (const value of [
        'Exact first question',
        'custom_lookup',
        'lookup-call',
        'Exact tool result',
        'Exact final answer 🔥',
      ])
        expect(text).toContain(value)
      expect(calls).toBe(2)
      expect(fixture.tool).toHaveBeenCalledOnce()
      await expect(attachAgentHistory(saved, randomUUID())).rejects.toThrow('revoked')
      await fixture.db!.delete(workflowExecutionLogs).where(eq(workflowExecutionLogs.id, logId))
      await deleteAgentHistory(saved)
      expect(
        await (await native.getStore('memory'))!.getThreadById({
          threadId: facts.history!.threadId,
          resourceId: facts.history!.resourceId,
        })
      ).toBeNull()
    },
    20000
  )
  it('retains actual completed native tool work when a later model step fails', async () => {
    const executionId = randomUUID()
    const logId = randomUUID()
    const at = new Date()
    let calls = 0
    fixture.tool
      .mockClear()
      .mockResolvedValue({ success: true, output: { found: 'Completed before failure' } })
    fixture.model = new MastraLanguageModelV2Mock({
      doGenerate: async () => {
        if (++calls > 1) throw new Error('Provider stopped after the tool')
        return {
          content: [
            {
              type: 'tool-call',
              toolCallId: 'partial-call',
              toolName: 'custom_lookup',
              input: '{"query":"exact"}',
            },
          ],
          finishReason: 'tool-calls',
          usage,
          warnings: [],
        }
      },
    })
    await fixture.db!.insert(workflowExecutionLogs).values({
      id: logId,
      workspaceId,
      workflowId,
      executionId,
      stateSnapshotId: snapshotId,
      workflowSummary: { id: workflowId },
      level: 'info',
      trigger: 'manual',
      startedAt: at,
      executionData: { environment: { userId: actor, workspaceId, executionId, workflowId } },
    })
    const failure = await new AgentBlockHandler()
      .execute(
        {
          id: 'agent',
          metadata: { id: 'agent', name: 'Agent' },
          config: { params: {} },
        } as SerializedBlock,
        {
          model: 'openai/gpt-4.1',
          userPrompt: 'A partial native turn',
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
        {
          workspaceId,
          workflowId,
          executionId,
          workflowLogId: logId,
          userId: actor,
          blockStates: new Map(),
          environmentVariables: {},
          workflowVariables: {},
        } as ExecutionContext
      )
      .then(
        () => {
          throw new Error('Expected a failed native turn')
        },
        (error) => error
      )
    const history = getInferenceFacts(failure)!.history!
    threads.add(history.threadId)
    const messages = (
      await (await native.getStore('memory'))!.listMessages({
        threadId: history.threadId,
        resourceId: history.resourceId,
        page: 0,
        perPage: 100,
        orderBy: { field: 'createdAt', direction: 'ASC' },
      })
    ).messages
    expect(failure).toBeInstanceOf(Error)
    expect(JSON.stringify(messages)).toContain('A partial native turn')
    expect(JSON.stringify(messages)).toContain('Completed before failure')
    expect(fixture.tool).toHaveBeenCalledOnce()
    expect(calls).toBe(2)
  }, 20000)
})
