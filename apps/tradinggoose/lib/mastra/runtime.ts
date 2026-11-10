import { Mastra } from '@mastra/core/mastra'
import { Memory } from '@mastra/memory'
import { PostgresStore } from '@mastra/pg'
import { Pool } from 'pg'
import { getConfiguredGateways } from './connections'

/** Supplied pools belong to this factory, not PostgresStore.close(). Both use the primary. */
export function createNativeStorage(connectionString: string, initialize = false) {
  const writer = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 250 })
  const reader = new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 250,
    statement_timeout: 1000,
    query_timeout: 1500,
  })
  let storage: PostgresStore
  try {
    storage = new PostgresStore({
      id: 'studio-native',
      schemaName: 'mastra',
      pool: writer,
      readPool: reader,
      disableInit: !initialize,
    })
  } catch (error) {
    void Promise.all([writer.end(), reader.end()])
    throw error
  }
  let closing: Promise<void> | undefined
  return {
    storage,
    async verifyCapabilities() {
      // This is a PostgreSQL capability check, never a query of native tables.
      await reader.query('SHOW transaction_timeout')
      const memory = await storage.getStore('memory')
      const workflows = await storage.getStore('workflows')
      if (!memory || !workflows) throw new Error('Native memory and workflows storage are required')
      if (!(await memory.supportsRunFencing()) || !(await workflows.supportsRunFencing()))
        throw new Error('Native run-fencing capability is required before admission')
      await memory.listThreads({ page: 0, perPage: 1 })
      await workflows.listWorkflowRuns({ page: 0, perPage: 1 })
      const probe = `studio-readiness:${crypto.randomUUID()}`
      await memory.listMessages({
        threadId: probe,
        resourceId: probe,
        page: 0,
        perPage: 1,
        includeTotal: true,
      })
      await memory.getResourceById({ resourceId: probe })
      await memory.getObservationalMemory(probe, probe)
      await workflows.getRunOwnership({ runId: probe })
    },
    close() {
      closing ??= (async () => {
        try {
          await storage.close()
        } finally {
          await Promise.all([writer.end(), reader.end()])
        }
      })()
      return closing
    },
  }
}

export const PASSIVE_MEMORY_OPTIONS = {
  lastMessages: false,
  semanticRecall: false,
  workingMemory: { enabled: false },
  observationalMemory: false,
  generateTitle: false,
} as const

let runtime: Promise<ReturnType<typeof createRuntime>> | undefined

function createRuntime(native: ReturnType<typeof createNativeStorage>) {
  // Omission selects core's supported NoOpObservability. Recovery never recontacts a model.
  const mastra = new Mastra({
    storage: native.storage,
    gateways: getConfiguredGateways(),
    recovery: { workflows: 'off', durableAgents: 'off' },
  })
  const memory = new Memory({ storage: native.storage, options: PASSIVE_MEMORY_OPTIONS })
  return { ...native, mastra, memory }
}

function getRuntime() {
  runtime ??= (async () => {
    const connectionString = process.env.MASTRA_DATABASE_URL
    if (!connectionString)
      throw new Error('MASTRA_DATABASE_URL with scoped runtime credentials is required')
    const native = createNativeStorage(connectionString)
    try {
      await native.verifyCapabilities()
      return createRuntime(native)
    } catch (error) {
      await native.close()
      throw error
    }
  })().catch((error) => {
    runtime = undefined
    throw error
  })
  return runtime
}

export async function getMastra() {
  return (await getRuntime()).mastra
}

export async function getNativeMemory() {
  return (await getRuntime()).memory
}

export async function getNativeMemoryStore() {
  const domain = await (await getRuntime()).storage.getStore('memory')
  if (!domain) throw new Error('Native memory storage is unavailable')
  return domain
}

export async function getNativeWorkflowsStore() {
  const domain = await (await getRuntime()).storage.getStore('workflows')
  if (!domain) throw new Error('Native workflow ownership storage is unavailable')
  return domain
}

export async function closeNativeRuntime() {
  const active = runtime
  runtime = undefined
  if (active) await (await active).close()
}
