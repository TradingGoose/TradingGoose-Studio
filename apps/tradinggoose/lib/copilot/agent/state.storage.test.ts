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
    const url = new URL(fixture.url!)
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_disposable'))
      throw new Error('A disposable loopback PostgreSQL database is required')
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

  async function saveRun(instance: typeof first, runId: string, threadId = randomUUID()) {
    const run: import('./state').CopilotRun = {
      runId,
      threadId,
      scope: { actorUserId: 'actor-1', workspaceId: 'workspace-1' },
      accessLevel: 'limited',
      model: 'test/model',
    }
    await instance.saveCopilotRun(run)
    return run
  }

  it('dispatches a racing action once and refuses replay after restart', async () => {
    const runId = randomUUID()
    await saveRun(first, runId)
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
    const execution = first.runCopilotEffectOnce(runId, callId, 'execute', input, async () => {
      effects++
      entered()
      await effect
      return { applied: true, entityId: input.entityId }
    })
    await dispatched
    try {
      await expect(
        second.runCopilotEffectOnce(runId, callId, 'execute', input, async () => {
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
      restarted.runCopilotEffectOnce(runId, callId, 'execute', input, async () => {
        effects++
        throw new Error('a known effect must never run twice')
      })
    ).rejects.toMatchObject({ status: 409 })
    expect(effects).toBe(1)
    await expect(
      restarted.runCopilotEffectOnce(
        runId,
        callId,
        'execute',
        { ...input, name: 'different edit' },
        async () => undefined
      )
    ).rejects.toMatchObject({ status: 409 })
  })

  it('retains an unknown outcome claim after restart', async () => {
    const runId = randomUUID()
    await saveRun(first, runId)
    const callId = randomUUID()
    let effects = 0
    await expect(
      first.runCopilotEffectOnce(runId, callId, 'review', { accept: true }, async () => {
        effects++
        throw new Error('reply lost after dispatch')
      })
    ).rejects.toThrow('reply lost after dispatch')
    const restarted = await connectInstance()
    await expect(
      restarted.runCopilotEffectOnce(runId, callId, 'review', { accept: true }, async () => {
        effects++
        return { success: true }
      })
    ).rejects.toMatchObject({ status: 409 })
    expect(effects).toBe(1)
  })

  it('keeps run ownership and exposes cancellation on another instance', async () => {
    const scope = { actorUserId: 'actor-1', workspaceId: 'workspace-1' }
    const run: import('./state').CopilotRun = {
      runId: randomUUID(),
      threadId: randomUUID(),
      scope,
      accessLevel: 'limited',
      model: 'test/model',
    }
    await first.saveCopilotRun(run)
    expect(await second.readCopilotRun(scope, run.runId)).toEqual(run)
    await expect(
      second.readCopilotRun({ ...scope, actorUserId: 'other' }, run.runId)
    ).rejects.toMatchObject({ status: 403 })
    await first.claimCopilotThread(scope, run.threadId, run.runId)
    await expect(
      second.claimCopilotThread(scope, run.threadId, randomUUID())
    ).rejects.toMatchObject({
      status: 409,
    })
    await second.releaseCopilotThread(scope, run.threadId, 'stale-run')
    await expect(first.claimCopilotThread(scope, run.threadId, randomUUID())).rejects.toMatchObject(
      {
        status: 409,
      }
    )
    await second.cancelCopilotRun(run.runId)
    const restarted = await connectInstance()
    await expect(restarted.assertCopilotRunActive(run.runId)).rejects.toMatchObject({ status: 409 })
    await restarted.releaseCopilotThread(scope, run.threadId, run.runId)
    await expect(
      first.claimCopilotThread(scope, run.threadId, randomUUID())
    ).resolves.toBeUndefined()
  })

  it('allows only one instance to claim a browser business action', async () => {
    const runId = randomUUID()
    await saveRun(first, runId)
    const callId = randomUUID()
    const outcomes = await Promise.allSettled([
      first.claimCopilotBrowserEffect(runId, callId, { workflowId: 'workflow-1' }),
      second.claimCopilotBrowserEffect(runId, callId, { workflowId: 'workflow-1' }),
    ])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({
      reason: { status: 409 },
    })
  })

  it('refuses new effects and browser claims after durable cancellation on another instance', async () => {
    const runId = randomUUID()
    await saveRun(first, runId)
    const execute = vi.fn(async () => ({ applied: true }))
    await first.cancelCopilotRun(runId)
    const restarted = await connectInstance()
    await expect(
      restarted.runCopilotEffectOnce(
        runId,
        randomUUID(),
        'execute',
        { entityId: 'entity' },
        execute
      )
    ).rejects.toMatchObject({ status: 409 })
    expect(execute).not.toHaveBeenCalled()
    await expect(
      restarted.claimCopilotBrowserEffect(runId, randomUUID(), { entityId: 'entity' })
    ).rejects.toMatchObject({ status: 409 })
  })
  it('stores only effect hashes and deletes all thread-owned state without touching other threads', async () => {
    const run = await saveRun(first, randomUUID())
    const other = await saveRun(first, randomUUID())
    await first.runCopilotEffectOnce(
      run.runId,
      'call',
      'execute',
      { secret: 'private-input-value' },
      async () => ({ secret: 'private-result-value' })
    )
    const values = await owner.unsafe(`select value from "${schema}".verification`)
    expect(JSON.stringify(values)).not.toContain('private-input-value')
    expect(JSON.stringify(values)).not.toContain('private-result-value')
    await first.cancelCopilotRun(run.runId)
    await first.deleteCopilotThread(run.scope, run.threadId)
    await expect(second.readCopilotRun(run.scope, run.runId)).rejects.toMatchObject({ status: 403 })
    expect(await second.isCopilotRunCancelled(run.runId)).toBe(false)
    expect(await second.readCopilotRun(other.scope, other.runId)).toEqual(other)
    await expect(
      second.claimCopilotThread(run.scope, run.threadId, randomUUID())
    ).resolves.toBeUndefined()
  })
  it('deletes native PostgreSQL pending snapshots and every thread-owned receipt', async () => {
    const run = await saveRun(first, randomUUID())
    const resourceId = nativeConversationIdentity(run.scope).resourceId
    const generated = await fixture.agent.generate('Prepare a change', {
      runId: run.runId,
      memory: { thread: run.threadId, resource: resourceId },
      maxSteps: 2,
    })
    expect(generated.finishReason).toBe('suspended')
    await first.claimCopilotThread(run.scope, run.threadId, run.runId)
    await first.runCopilotEffectOnce(
      run.runId,
      'server',
      'execute',
      { input: 'private' },
      async () => ({ output: 'native owns this result' })
    )
    await first.cancelCopilotRun(run.runId)
    await first.releaseCopilotThread(run.scope, run.threadId, run.runId)
    expect(
      (await fixture.agent.listSuspendedRuns({ threadId: run.threadId, resourceId })).runs
    ).toHaveLength(1)
    const workflows = (await fixture.storage.getStore('workflows'))!
    expect(await workflows.getWorkflowRunById({ runId: run.runId })).not.toBeNull()
    await first.deleteCopilotThread(run.scope, run.threadId)
    expect(await workflows.getWorkflowRunById({ runId: run.runId })).toBeNull()
    expect(
      (await fixture.agent.listSuspendedRuns({ threadId: run.threadId, resourceId })).runs
    ).toEqual([])
    expect(await fixture.memory.getThreadById({ threadId: run.threadId })).toBeNull()
    await expect(first.readCopilotRun(run.scope, run.runId)).rejects.toMatchObject({ status: 403 })
    expect(await first.isCopilotRunCancelled(run.runId)).toBe(false)
    const [{ count }] = await owner.unsafe(
      `select count(*)::int as count from "${schema}".verification where value like $1`,
      [`%${run.runId}%`]
    )
    expect(count).toBe(0)
  })
})
