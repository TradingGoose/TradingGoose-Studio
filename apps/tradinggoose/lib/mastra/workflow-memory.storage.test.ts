import { randomUUID } from 'node:crypto'
import { Memory } from '@mastra/memory'
import { PostgresStore } from '@mastra/pg'
import { user, workflow, workspace } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { encodeWorkflowMessage, workflowMemoryIdentity } from './messages'
import {
  appendWorkflowMemory,
  deleteWorkflowMemories,
  deleteWorkflowMemory,
  getAllWorkflowMemory,
  getWorkflowMemory,
} from './workflow-memory'

const fixture = vi.hoisted(() => ({
  url: process.env.MASTRA_TEST_DATABASE_URL,
  client: undefined as ReturnType<typeof import('postgres').default> | undefined,
  db: undefined as typeof import('@tradinggoose/db').db | undefined,
  memory: undefined as Memory | undefined,
  storage: undefined as PostgresStore | undefined,
}))
vi.mock('@tradinggoose/db', async () => {
  const schema = await import('@tradinggoose/db/schema')
  if (!fixture.url) return { ...schema, db: {} }
  const { drizzle } = await import('drizzle-orm/postgres-js')
  const { default: postgres } = await import('postgres')
  fixture.client = postgres(fixture.url, { max: 5, prepare: false })
  fixture.db = drizzle(fixture.client, { schema })
  return { ...schema, db: fixture.db }
})
vi.mock('@/lib/auth/hybrid', () => ({ AuthType: { API_KEY: 'api_key' } }))
vi.mock('./runtime', () => ({
  getAgentMemory: async () => fixture.memory!,
  getNativeMemoryStore: async () => (await fixture.storage!.getStore('memory'))!,
}))

describe.runIf(Boolean(fixture.url))('workflow Memory with native PostgreSQL storage', () => {
  const actor = randomUUID()
  const workspaceId = randomUUID()
  const workflowId = randomUUID()
  const auth = { success: true, userId: actor }
  const threads = new Set<string>()
  const append = async (key: string, content: string) => {
    const result = await appendWorkflowMemory(auth, workflowId, key, { role: 'user', content })
    threads.add(result.record.id)
    return result
  }
  beforeAll(async () => {
    fixture.storage = new PostgresStore({
      id: 'workflow-memory-test',
      connectionString: fixture.url!,
      schemaName: 'mastra',
    })
    await fixture.storage.init()
    fixture.memory = new Memory({
      storage: fixture.storage,
      options: {
        semanticRecall: false,
        workingMemory: { enabled: false },
        observationalMemory: false,
        generateTitle: false,
      },
    })
    const at = new Date()
    await fixture.db!.insert(user).values({
      id: actor,
      name: 'Memory test',
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
      name: 'Memory test',
      createdAt: at,
      updatedAt: at,
    })
    await fixture.db!.insert(workflow).values({
      id: workflowId,
      userId: actor,
      workspaceId,
      name: 'Memory test',
      lastSynced: at,
      createdAt: at,
      updatedAt: at,
    })
  }, 30000)
  afterAll(async () => {
    if (fixture.storage) {
      const store = (await fixture.storage.getStore('memory'))!
      for (const threadId of threads) await store.deleteThread({ threadId })
      await fixture.storage.close()
    }
    if (fixture.db) {
      await fixture.db.delete(workspace).where(eq(workspace.id, workspaceId))
      await fixture.db.delete(user).where(eq(user.id, actor))
    }
    await fixture.client?.end({ timeout: 2 })
  })

  it('preserves text and semantic roles and retrieves a complete native history', async () => {
    const key = randomUUID()
    await append(key, '')
    await appendWorkflowMemory(auth, workflowId, key, { role: 'system', content: 'Literal🔥\n' })
    const identity = workflowMemoryIdentity(workspaceId, workflowId, key)
    const added = Array.from({ length: 151 }, (_, index) => ({
      role: 'assistant' as const,
      content: `Answer ${index}`,
    }))
    await (await fixture.storage!.getStore('memory'))!.saveMessages({
      messages: added.map((entry, index) =>
        encodeWorkflowMessage(entry, identity, new Date(Date.now() + index + 1000))
      ),
    })
    const record = await getWorkflowMemory(auth, workflowId, key)
    expect(record.data).toEqual([
      { role: 'user', content: '' },
      { role: 'system', content: 'Literal🔥\n' },
      ...added,
    ])
  })

  it('deletes the native thread and recreates the logical key without retained containers', async () => {
    const key = randomUUID()
    const first = await append(key, 'before')
    await deleteWorkflowMemory(auth, workflowId, key)
    const store = (await fixture.storage!.getStore('memory'))!
    expect(await store.getThreadById({ threadId: first.record.id })).toBeNull()
    await expect(getWorkflowMemory(auth, workflowId, key)).rejects.toMatchObject({ status: 404 })
    const next = await append(key, 'after')
    expect(next.created).toBe(true)
    expect(next.record.data).toEqual([{ role: 'user', content: 'after' }])
  })

  it('refuses foreign actors and workspace API keys through the existing Studio authorization', async () => {
    const key = randomUUID()
    await append(key, 'private')
    await expect(
      getWorkflowMemory({ success: true, userId: randomUUID() }, workflowId, key)
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      getWorkflowMemory(
        {
          ...auth,
          authType: 'api_key' as never,
          apiKeyType: 'workspace',
          workspaceId: randomUUID(),
        },
        workflowId,
        key
      )
    ).rejects.toMatchObject({ status: 403 })
    expect((await getWorkflowMemory(auth, workflowId, key)).data[0].content).toBe('private')
  })

  it('lists at most 50 scoped conversations with one bulk native message query', async () => {
    const store = (await fixture.storage!.getStore('memory'))!
    for (let index = 0; index < 52; index++) {
      const identity = workflowMemoryIdentity(workspaceId, workflowId, `list-${index}`)
      await fixture.memory!.createThread({ ...identity, threadId: identity.threadId })
      threads.add(identity.threadId)
      await store.saveMessages({
        messages: [
          encodeWorkflowMessage(
            { role: 'user', content: `Message ${index}` },
            identity,
            new Date()
          ),
        ],
      })
    }
    const list = vi.spyOn(store, 'listMessages')
    try {
      const records = await getAllWorkflowMemory(auth, workflowId)
      expect(records).toHaveLength(50)
      expect(records.every((entry) => entry.workflowId === workflowId && entry.data.length)).toBe(
        true
      )
      expect(list).toHaveBeenCalledTimes(1)
      expect(list.mock.calls[0][0]).toMatchObject({
        perPage: false,
        resourceId: workflowMemoryIdentity(workspaceId, workflowId, '').resourceId,
      })
      expect(list.mock.calls[0][0].threadId).toHaveLength(50)
    } finally {
      list.mockRestore()
    }
  })

  it('removes native reusable Memory after its workflow is deleted and preserves other purposes', async () => {
    const retained = await fixture.memory!.createThread({
      resourceId: `workflow-execution:${workspaceId}:other`,
      metadata: { purpose: 'workflow-agent', workspaceId, workflowId },
    })
    threads.add(retained.id)
    await fixture.db!.delete(workflow).where(eq(workflow.id, workflowId))
    await deleteWorkflowMemories(workspaceId, workflowId)
    const store = (await fixture.storage!.getStore('memory'))!
    const { threads: removed } = await store.listThreads({
      filter: { metadata: { purpose: 'workflow-memory', workspaceId, workflowId } },
      perPage: false,
    })
    expect(removed).toEqual([])
    expect(await store.getThreadById({ threadId: retained.id })).not.toBeNull()
    await expect(getAllWorkflowMemory(auth, workflowId)).rejects.toMatchObject({ status: 404 })
  })
})
