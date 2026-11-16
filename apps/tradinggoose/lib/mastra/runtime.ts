import { Mastra } from '@mastra/core/mastra'
import {
  MastraCompositeStore,
  matchesRunFence,
  type RunFence,
  RunFenceConflictError,
  TABLE_MEMORY_RUN_FENCES,
} from '@mastra/core/storage'
import { Memory } from '@mastra/memory'
import { MemoryPG, PoolAdapter, PostgresStore, type TxClient } from '@mastra/pg'
import { RedisStreamsPubSub } from '@mastra/redis-streams'
import type { createCopilotAgent } from '@/lib/copilot/agent/agent'

async function createRuntime() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required for the shared Studio database')
  const storage = new PostgresStore({ id: 'studio', connectionString, schemaName: 'mastra' })
  // Keep native pinned initialization and deadlock retries for only the domains Studio uses.
  storage.stores = { memory: storage.stores.memory, workflows: storage.stores.workflows }
  try {
    await storage.init()
    const memory = new Memory({ storage })
    const mastra = new Mastra<{ copilot: ReturnType<typeof createCopilotAgent> }>({
      storage,
      ...(process.env.REDIS_URL
        ? { pubsub: new RedisStreamsPubSub({ url: process.env.REDIS_URL }) }
        : {}),
      recovery: { workflows: 'off' },
    })
    return { storage, memory, mastra }
  } catch (error) {
    await storage.close()
    throw error
  }
}

const processRuntime = globalThis as typeof globalThis & {
  __studioMastraRuntime?: ReturnType<typeof createRuntime>
}
function getRuntime() {
  return (processRuntime.__studioMastraRuntime ??= createRuntime().catch((error) => {
    processRuntime.__studioMastraRuntime = undefined
    throw error
  }))
}

export async function getMastra() {
  return (await getRuntime()).mastra
}

export async function getCopilotAgent() {
  const { mastra, memory } = await getRuntime()
  const { createCopilotAgent } = await import('@/lib/copilot/agent/agent')
  if (!Object.hasOwn(mastra.listAgents(), 'copilot'))
    mastra.addAgent(createCopilotAgent(memory), 'copilot')
  return mastra.getAgent('copilot')
}

export async function getAgentMemory() {
  return (await getRuntime()).memory
}

/** Mastra excludes deleteThread from fencing; use its fenced-write transaction pattern. */
export async function deleteNativeThread(
  threadId: string,
  fence: RunFence,
  cleanup: (transaction: TxClient) => Promise<unknown>
) {
  const { storage, mastra } = await getRuntime()
  const client = new PoolAdapter(storage.pool)
  client.tx = (remove) =>
    storage.db.tx(async (transaction) => {
      const row = await transaction.oneOrNone<{ generation: string; ownerId: string }>(
        `SELECT generation, "ownerId" FROM "mastra"."${TABLE_MEMORY_RUN_FENCES}"
         WHERE "runId" = $1 FOR SHARE`,
        [fence.runId]
      )
      if (!matchesRunFence(row && { ...row, generation: Number(row.generation) }, fence))
        throw new RunFenceConflictError(fence, 'deleteThread')
      const result = await remove(transaction)
      await cleanup(transaction)
      return result
    })
  // Scope the transaction adapter to this deletion; keep native SQL and stream cleanup.
  const memory = new Memory({
    storage: new MastraCompositeStore({
      id: 'studio-thread-deletion',
      domains: { memory: new MemoryPG({ client, schemaName: 'mastra' }) },
      disableInit: true,
    }),
  })
  memory.__registerMastra(mastra)
  await memory.deleteThread(threadId)
}

export async function getNativeMemoryStore() {
  const store = await (await getRuntime()).storage.getStore('memory')
  if (!store) throw new Error('Conversation storage is unavailable')
  return store
}

export async function getNativeWorkflowsStore() {
  const store = await (await getRuntime()).storage.getStore('workflows')
  if (!store) throw new Error('Agent state storage is unavailable')
  return store
}
