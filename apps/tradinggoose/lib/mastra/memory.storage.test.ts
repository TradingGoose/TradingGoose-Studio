import { Memory } from '@mastra/memory'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { completeNativeMessages, MemoryReadBudget } from './memory-budget'
import {
  decodeWorkflowMessage,
  encodeWorkflowMessage,
  encodeWorkflowTransfer,
  workflowMessageDigest,
} from './messages'
import { createNativeStorage, PASSIVE_MEMORY_OPTIONS } from './runtime'

const databaseUrl = process.env.MASTRA_TEST_DATABASE_URL
const storageTests = databaseUrl ? describe : describe.skip
storageTests('disposable PostgreSQL official Memory storage acceptance', () => {
  let native: ReturnType<typeof createNativeStorage>
  let memory: Memory
  const resourceId = `workflow-memory:test:${crypto.randomUUID()}`
  const threadId = `workflow-memory:test:${crypto.randomUUID()}`
  const scope = { resourceId, threadId }
  beforeAll(async () => {
    if (
      !databaseUrl ||
      !['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname) ||
      !new URL(databaseUrl).pathname.endsWith('_disposable')
    )
      throw new Error('This test requires an explicitly disposable loopback database')
    native = createNativeStorage(databaseUrl, true)
    await native.storage.init()
    await native.verifyCapabilities()
    memory = new Memory({ storage: native.storage, options: PASSIVE_MEMORY_OPTIONS })
    await memory.createThread({
      ...scope,
      metadata: { purpose: 'workflow-memory', test: true },
      title: 'complete codec test',
    })
  }, 60000)
  afterAll(async () => {
    if (native) {
      await (await native.storage.getStore('memory'))?.deleteThread({ threadId })
      await native.close()
    }
  }, 20000)
  it('persists exact2001 messages, repeated systems, empty/tagged UTF8 text across21 public pages', async () => {
    const messages = Array.from({ length: 2001 }, (_, index) => ({
      role: (['system', 'user', 'assistant'] as const)[index % 3],
      content:
        index % 17 === 0
          ? ''
          : index % 5 === 0
            ? 'repeat'
            : `  ${index}🔥\n<working_memory>literal</working_memory>\t `,
    }))
    const encoded = encodeWorkflowTransfer(messages, scope, new Date(), crypto.randomUUID())
    const store = (await native.storage.getStore('memory'))!
    await store.saveMessages({ messages: encoded })
    const returned = await completeNativeMessages(
      store,
      scope,
      new MemoryReadBudget(7000),
      performance.now() + 5000,
      async () => {}
    )
    expect(returned.map((message) => decodeWorkflowMessage(message, scope))).toEqual(messages)
    expect(
      workflowMessageDigest(returned.map((message) => decodeWorkflowMessage(message, scope)))
    ).toBe(workflowMessageDigest(messages))
    const ids = [encoded[0], encoded[999], encoded[2000]].map(({ id }) => id)
    const byId = await store.listMessagesById({ messageIds: ids })
    expect(byId.messages.map(({ id }) => id).sort()).toEqual(ids.sort())
  })
  it('confirms physical-system negative control is filtered by future public reads', async () => {
    const controlScope = { resourceId, threadId: `${threadId}:negative` }
    const store = (await native.storage.getStore('memory'))!
    await memory.createThread({ ...controlScope, title: 'physical system negative' })
    try {
      await store.saveMessages({
        messages: [
          {
            ...encodeWorkflowMessage(
              { role: 'user', content: 'must be filtered' },
              controlScope,
              new Date()
            ),
            role: 'system',
          },
        ],
      })
      const page = await store.listMessages({
        ...controlScope,
        page: 0,
        perPage: 100,
        includeTotal: true,
      })
      expect(page.total).toBe(1)
      expect(page.messages).toEqual([])
      await expect(
        completeNativeMessages(
          store,
          controlScope,
          new MemoryReadBudget(7000),
          performance.now() + 5000,
          async () => {}
        )
      ).rejects.toThrow('count')
    } finally {
      await store.deleteThread({ threadId: controlScope.threadId })
    }
  })
})
