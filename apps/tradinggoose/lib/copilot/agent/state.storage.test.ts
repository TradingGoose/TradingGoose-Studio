/** @vitest-environment node */
import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  url: process.env.MASTRA_TEST_DATABASE_URL,
  currentDb: undefined as ReturnType<typeof drizzle> | undefined,
}))
vi.mock('@tradinggoose/db', () => ({ db: fixture.currentDb }))

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
  })
  afterAll(async () => {
    await Promise.all(clients.map((client) => client.end({ timeout: 2 })))
    if (owner) {
      await owner.unsafe(`drop schema "${schema}" cascade`)
      await owner.end({ timeout: 2 })
    }
  })

  it('dispatches a racing action once and reuses its result after restart', async () => {
    const runId = randomUUID()
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
    ).resolves.toEqual({ applied: true, entityId: 'entity' })
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
      binding: {
        namespace: 'billing-usage:user:actor-1',
        key: 'operation',
        fingerprint: 'fingerprint',
        actorUserId: scope.actorUserId,
        workspaceId: scope.workspaceId,
        workflowId: null,
        runId: '',
        purpose: 'copilot',
      },
    }
    run.binding.runId = run.runId
    await first.saveCopilotRun(run)
    await first.saveCopilotOccurrence(run, { runId: run.runId, stepNumber: 3, retryCount: 0 })
    expect(await second.readCopilotRun(scope, run.runId)).toEqual(run)
    await expect(
      second.readCopilotRun({ ...scope, actorUserId: 'other' }, run.runId)
    ).rejects.toMatchObject({ status: 403 })
    await first.claimCopilotThread(scope, run.threadId, run.runId)
    await expect(second.assertCopilotThreadIdle(scope, run.threadId)).rejects.toMatchObject({
      status: 409,
    })
    await second.releaseCopilotThread(scope, run.threadId, 'stale-run')
    await expect(first.assertCopilotThreadIdle(scope, run.threadId)).rejects.toMatchObject({
      status: 409,
    })
    await second.cancelCopilotRun(run.runId)
    const restarted = await connectInstance()
    await expect(restarted.assertCopilotRunActive(run.runId)).rejects.toMatchObject({ status: 409 })
    await restarted.releaseCopilotThread(scope, run.threadId, run.runId)
    await expect(first.assertCopilotThreadIdle(scope, run.threadId)).resolves.toBeUndefined()
  })

  it('allows only one instance to claim a browser business action', async () => {
    const runId = randomUUID()
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
})
