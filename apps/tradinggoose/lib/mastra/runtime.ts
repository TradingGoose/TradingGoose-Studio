import { Mastra } from '@mastra/core/mastra'
import { MastraCompositeStore } from '@mastra/core/storage'
import { Memory } from '@mastra/memory'
import { MemoryPG, WorkflowsPG } from '@mastra/pg'
import { Pool } from 'pg'
import { createCopilotAgent } from '@/lib/copilot/agent/agent'
import { getConfiguredGateways } from './connections'

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
  const storage = new MastraCompositeStore({
    id: 'studio',
    domains: {
      memory: new MemoryPG({ pool, schemaName: 'mastra' }),
      workflows: new WorkflowsPG({ pool, schemaName: 'mastra' }),
      threadState: false,
    },
  })
  try {
    await storage.init()
    const memory = new Memory({ storage, options: AGENT_MEMORY_OPTIONS })
    const copilotAgent = createCopilotAgent(memory)
    const mastra = new Mastra({
      agents: { copilot: copilotAgent },
      storage,
      gateways: getConfiguredGateways(),
      recovery: { workflows: 'off', durableAgents: 'off' },
    })
    return { storage, memory, mastra }
  } catch (error) {
    await pool.end()
    throw error
  }
}

let runtime: ReturnType<typeof createRuntime> | undefined
function getRuntime() {
  return (runtime ??= createRuntime().catch((error) => {
    runtime = undefined
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
