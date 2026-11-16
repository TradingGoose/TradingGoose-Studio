import { randomUUID } from 'node:crypto'
import { InMemoryStore } from '@mastra/core/storage'
import { Memory } from '@mastra/memory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeWorkflowMessage, workflowMemoryIdentity } from './messages'
import {
  appendWorkflowMemory,
  deleteWorkflowMemories,
  deleteWorkflowMemory,
  getAllWorkflowMemory,
  getWorkflowMemory,
} from './workflow-memory'

const fixture = vi.hoisted(() => ({
  owner: vi.fn(),
  authorize: vi.fn(),
  memory: undefined as Memory | undefined,
  storage: undefined as InMemoryStore | undefined,
}))
vi.mock('@tradinggoose/db', () => ({
  db: {
    transaction: (run: (tx: unknown) => Promise<unknown>) =>
      run({
        select: () => ({
          from: () => ({
            where: () => ({ for: () => ({ limit: fixture.owner }) }),
          }),
        }),
      }),
  },
}))
vi.mock('@/lib/auth/workflow-scope', () => ({ authorizeWorkflowScope: fixture.authorize }))
vi.mock('./runtime', () => ({
  getAgentMemory: async () => fixture.memory!,
  getNativeMemoryStore: async () => (await fixture.storage!.getStore('memory'))!,
}))

describe('workflow Memory with native in-memory storage', () => {
  const actor = randomUUID()
  const workspaceId = randomUUID()
  const workflowId = randomUUID()
  const auth = { success: true, userId: actor }
  const append = (key: string, content: string) =>
    appendWorkflowMemory(auth, workflowId, key, { role: 'user', content })
  beforeEach(() => {
    fixture.owner.mockReset().mockResolvedValue([{ id: workflowId }])
    fixture.authorize.mockReset().mockResolvedValue({ ok: true, workspaceId, workflowId })
    fixture.storage = new InMemoryStore()
    fixture.memory = new Memory({ storage: fixture.storage })
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
    fixture.authorize
      .mockResolvedValueOnce({ ok: false, error: 'Workflow access denied', status: 403 })
      .mockResolvedValueOnce({ ok: false, error: 'Workspace scope differs', status: 403 })
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
    await append(randomUUID(), 'Removed with the workflow')
    const retained = await fixture.memory!.createThread({
      resourceId: `workflow-execution:${workspaceId}:other`,
      metadata: { purpose: 'workflow-agent', workspaceId, workflowId },
    })
    fixture.owner.mockResolvedValue([])
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
