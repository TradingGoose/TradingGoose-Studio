import { Mastra } from '@mastra/core/mastra'
import { Memory } from '@mastra/memory'
import { PostgresStore } from '@mastra/pg'
import { RedisStreamsPubSub } from '@mastra/redis-streams'
import { createCopilotAgent } from '@/lib/copilot/agent/agent'

async function createRuntime() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required for the shared Studio database')
  const storage = new PostgresStore({ id: 'studio', connectionString, schemaName: 'mastra' })
  // Keep native pinned initialization and deadlock retries for only the domains Studio uses.
  storage.stores = { memory: storage.stores.memory, workflows: storage.stores.workflows }
  try {
    await storage.init()
    const memory = new Memory({
      storage,
      options: { messageHistory: { maxTokens: 32000 } },
    })
    const copilotAgent = createCopilotAgent(memory)
    const mastra = new Mastra({
      agents: { copilot: copilotAgent },
      storage,
      ...(process.env.REDIS_URL
        ? { pubsub: new RedisStreamsPubSub({ url: process.env.REDIS_URL }) }
        : {}),
      recovery: { workflows: 'off', durableAgents: 'off' },
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
  return (await getRuntime()).mastra.getAgent('copilot')
}

export async function getAgentMemory() {
  return (await getRuntime()).memory
}

export async function getNativeMemoryStore() {
  const store = await (await getRuntime()).storage.getStore('memory')
  if (!store) throw new Error('Mastra memory storage is unavailable')
  return store
}

export async function getNativeWorkflowsStore() {
  const store = await (await getRuntime()).storage.getStore('workflows')
  if (!store) throw new Error('Mastra workflow storage is unavailable')
  return store
}
