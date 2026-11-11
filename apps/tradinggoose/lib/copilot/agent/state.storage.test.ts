/** @vitest-environment node */
import { randomUUID } from 'node:crypto'
import { Agent } from '@mastra/core/agent'
import { Mastra } from '@mastra/core/mastra'
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import { createTool } from '@mastra/core/tools'
import { Memory } from '@mastra/memory'
import { PostgresStore } from '@mastra/pg'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { nativeConversationIdentity } from '@/lib/copilot/native/identity'

const fixture = vi.hoisted(() => ({
  url: process.env.MASTRA_TEST_DATABASE_URL,
  currentDb: undefined as ReturnType<typeof drizzle> | undefined,
  storage: undefined as unknown as PostgresStore,
  memory: undefined as unknown as Memory,
  agent: undefined as unknown as Agent,
}))
vi.mock('@tradinggoose/db', () => ({ db: fixture.currentDb }))
vi.mock('@/lib/mastra/runtime', () => ({
  getAgentMemory: async () => fixture.memory,
  getCopilotAgent: async () => fixture.agent,
  getNativeWorkflowsStore: async () => fixture.storage.getStore('workflows'),
}))

const storageTests = fixture.url ? describe : describe.skip
storageTests('Copilot durable claims across Studio instances', () => {
  const schema = `copilot_state_${randomUUID().replaceAll('-', '')}`
  let owner: postgres.Sql
  const clients: postgres.Sql[] = []
  let first: typeof import('./state')
  let second: typeof import('./state')

  async function connectInstance() {
    const client = postgres(fixture.url!, { max: 1, connection: { search_path: schema } })
    clients.push(client)
    fixture.currentDb = drizzle(client)
    vi.resetModules()
    return import('./state')
  }
  beforeAll(async () => {
    owner = postgres(fixture.url!, { max: 1 })
    await owner.unsafe(`create schema "${schema}"`)
    await owner.unsafe(`create table "${schema}".verification (
      id text primary key, identifier text not null, value text not null,
      expires_at timestamp not null, created_at timestamp, updated_at timestamp
    )`)
    first = await connectInstance()
    second = await connectInstance()
    fixture.storage = new PostgresStore({
      id: schema,
      connectionString: fixture.url!,
      schemaName: schema,
    })
    await fixture.storage.init()
    fixture.memory = new Memory({ storage: fixture.storage, options: { generateTitle: false } })
    fixture.agent = new Agent({
      id: 'copilot-lifecycle-fixture',
      name: 'Copilot lifecycle',
      instructions: '',
      memory: fixture.memory,
      model: new MastraLanguageModelV2Mock({
        doGenerate: async () => ({
          content: [
            {
              type: 'tool-call',
              toolCallId: 'native-approval',
              toolName: 'change',
              input: '{"value":"review"}',
            },
          ],
          finishReason: 'tool-calls',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          warnings: [],
        }),
      }),
      tools: {
        change: createTool({
          id: 'change',
          description: 'Review fixture',
          inputSchema: z.object({ value: z.string() }),
          requireApproval: true,
          execute: async (args) => args,
        }),
      },
    })
    new Mastra({
      agents: { copilot: fixture.agent },
      storage: fixture.storage,
      recovery: { workflows: 'off', durableAgents: 'off' },
    })
  })
  afterAll(async () => {
    await fixture.storage?.close()
    await Promise.all(clients.map((client) => client.end({ timeout: 2 })))
    if (owner) {
      await owner.unsafe(`drop schema "${schema}" cascade`)
      await owner.end({ timeout: 2 })
    }
  })

  function run(): import('./state').CopilotRun {
    return {
      runId: randomUUID(),
      threadId: randomUUID(),
      scope: { actorUserId: 'actor-1', workspaceId: 'workspace-1' },
      accessLevel: 'limited',
      model: 'test/model',
    }
  }

  it('dispatches a racing action once and refuses replay after restart', async () => {
    const invocation = run()
    const callId = randomUUID()
    const input = { actor: 'actor', entityId: 'entity', name: 'accepted edit' }
    let entered!: () => void
    const dispatched = new Promise<void>((resolve) => {
      entered = resolve
    })
    let release!: () => void
    const effect = new Promise<void>((resolve) => {
      release = resolve
    })
    let effects = 0
    const execution = first.runCopilotEffectOnce(invocation, callId, 'execute', async () => {
      effects++
      entered()
      await effect
      return { applied: true, entityId: input.entityId }
    })
    await dispatched
    try {
      await expect(
        second.runCopilotEffectOnce(invocation, callId, 'execute', async () => {
          effects++
          return { applied: true, entityId: input.entityId }
        })
      ).rejects.toMatchObject({ status: 409 })
    } finally {
      release()
    }
    expect(await execution).toEqual({ applied: true, entityId: 'entity' })
    const restarted = await connectInstance()
    await expect(
      restarted.runCopilotEffectOnce(invocation, callId, 'execute', async () => {
        effects++
        throw new Error('a known effect must never run twice')
      })
    ).rejects.toMatchObject({ status: 409 })
    expect(effects).toBe(1)
    await expect(
      restarted.runCopilotEffectOnce(invocation, callId, 'execute', async () => undefined)
    ).rejects.toMatchObject({ status: 409 })
  })

  it('retains an unknown outcome claim after restart', async () => {
    const invocation = run()
    const callId = randomUUID()
    let effects = 0
    await expect(
      first.runCopilotEffectOnce(invocation, callId, 'review', async () => {
        effects++
        throw new Error('reply lost after dispatch')
      })
    ).rejects.toThrow('reply lost after dispatch')
    const restarted = await connectInstance()
    await expect(
      restarted.runCopilotEffectOnce(invocation, callId, 'review', async () => {
        effects++
        return { success: true }
      })
    ).rejects.toMatchObject({ status: 409 })
    expect(effects).toBe(1)
  })

  it('keeps scoped thread ownership and cancellation across instances', async () => {
    const invocation = run()
    const { scope, threadId, runId } = invocation
    await first.claimCopilotThread(scope, threadId, runId)
    expect(await second.readCopilotThreadRun(scope, threadId)).toBe(runId)
    expect(
      await second.readCopilotThreadRun({ ...scope, actorUserId: 'other' }, threadId)
    ).toBeUndefined()
    await expect(second.claimCopilotThread(scope, threadId, randomUUID())).rejects.toMatchObject({
      status: 409,
    })
    await second.releaseCopilotThread(scope, threadId, 'stale-run')
    expect(await first.readCopilotThreadRun(scope, threadId)).toBe(runId)
    await second.cancelCopilotRun(invocation)
    const restarted = await connectInstance()
    await expect(restarted.assertCopilotRunActive(runId)).rejects.toMatchObject({ status: 409 })
    await restarted.releaseCopilotThread(scope, threadId, runId)
    await expect(first.claimCopilotThread(scope, threadId, randomUUID())).resolves.toBeUndefined()
  })

  it('allows only one instance to claim a browser business action', async () => {
    const invocation = run()
    const callId = randomUUID()
    const outcomes = await Promise.allSettled([
      first.claimCopilotBrowserEffect(invocation, callId),
      second.claimCopilotBrowserEffect(invocation, callId),
    ])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({
      reason: { status: 409 },
    })
  })

  it('refuses new effects and browser claims after durable cancellation on another instance', async () => {
    const invocation = run()
    const execute = vi.fn(async () => ({ applied: true }))
    await first.cancelCopilotRun(invocation)
    const restarted = await connectInstance()
    await expect(
      restarted.runCopilotEffectOnce(invocation, randomUUID(), 'execute', execute)
    ).rejects.toMatchObject({ status: 409 })
    expect(execute).not.toHaveBeenCalled()
    await expect(
      restarted.claimCopilotBrowserEffect(invocation, randomUUID())
    ).rejects.toMatchObject({ status: 409 })
  })
  it('stores only claim markers and deletes them without touching other threads', async () => {
    const invocation = run()
    const other = run()
    await first.runCopilotEffectOnce(invocation, 'call', 'execute', async () => ({ applied: true }))
    await first.cancelCopilotRun(invocation)
    await first.cancelCopilotRun(other)
    const values = await owner.unsafe(
      `select value from "${schema}".verification where id not like 'copilot:thread:%'`
    )
    expect(values.every((row) => row.value === 'true')).toBe(true)
    await first.deleteCopilotThread(invocation.scope, invocation.threadId)
    expect(await second.isCopilotRunCancelled(invocation.runId)).toBe(false)
    expect(await second.isCopilotRunCancelled(other.runId)).toBe(true)
    await expect(
      second.claimCopilotThread(invocation.scope, invocation.threadId, randomUUID())
    ).resolves.toBeUndefined()
  })
  it('deletes native PostgreSQL pending snapshots and every thread-owned receipt', async () => {
    const invocation = run()
    const resourceId = nativeConversationIdentity(invocation.scope).resourceId
    const generated = await fixture.agent.generate('Prepare a change', {
      runId: invocation.runId,
      memory: { thread: invocation.threadId, resource: resourceId },
      maxSteps: 2,
    })
    expect(generated.finishReason).toBe('suspended')
    await first.claimCopilotThread(invocation.scope, invocation.threadId, invocation.runId)
    await first.runCopilotEffectOnce(invocation, 'server', 'execute', async () => ({
      output: 'native owns this result',
    }))
    await first.cancelCopilotRun(invocation)
    await first.releaseCopilotThread(invocation.scope, invocation.threadId, invocation.runId)
    expect(
      (await fixture.agent.listSuspendedRuns({ threadId: invocation.threadId, resourceId })).runs
    ).toHaveLength(1)
    const workflows = (await fixture.storage.getStore('workflows'))!
    expect(await workflows.getWorkflowRunById({ runId: invocation.runId })).not.toBeNull()
    await first.deleteCopilotThread(invocation.scope, invocation.threadId)
    expect(await workflows.getWorkflowRunById({ runId: invocation.runId })).toBeNull()
    expect(
      (await fixture.agent.listSuspendedRuns({ threadId: invocation.threadId, resourceId })).runs
    ).toEqual([])
    expect(await fixture.memory.getThreadById({ threadId: invocation.threadId })).toBeNull()
    expect(await first.isCopilotRunCancelled(invocation.runId)).toBe(false)
    const [{ count }] = await owner.unsafe(
      `select count(*)::int as count from "${schema}".verification where value like $1`,
      [`%${invocation.runId}%`]
    )
    expect(count).toBe(0)
  })
})
