import { Mastra } from '@mastra/core/mastra'
import { Memory } from '@mastra/memory'
import { PostgresStore } from '@mastra/pg'
import { RedisStreamsPubSub } from '@mastra/redis-streams'
import { Pool } from 'pg'
import { createCopilotAgent } from '@/lib/copilot/agent/agent'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('MastraRuntime')

export const AGENT_MEMORY_OPTIONS = {
  messageHistory: { maxTokens: 32000 },
  semanticRecall: false,
  workingMemory: { enabled: false },
  observationalMemory: false,
  generateTitle: false,
} as const

async function createRuntime() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required for the shared Studio database')
  const pool = new Pool({ connectionString, max: 20 })
  pool.on('error', (error) => logger.error('Unexpected Mastra PostgreSQL pool error', error))
  const storage = new PostgresStore({ id: 'studio', pool, schemaName: 'mastra' })
  // Keep native pinned initialization and deadlock retries for only the domains Studio uses.
  storage.stores = { memory: storage.stores.memory, workflows: storage.stores.workflows }
  try {
    await storage.init()
    const memory = new Memory({ storage, options: AGENT_MEMORY_OPTIONS })
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
    await pool.end()
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
