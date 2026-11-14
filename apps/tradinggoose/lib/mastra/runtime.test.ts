import { EventEmitter } from 'node:events'
import type { Mastra } from '@mastra/core/mastra'
import type { PostgresStore } from '@mastra/pg'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  memoryInit: vi.fn(),
  workflowInit: vi.fn(),
  end: vi.fn(),
  query: vi.fn(async () => ({ rows: [] })),
  release: vi.fn(),
  connect: vi.fn(),
  poolOptions: [] as unknown[],
  createAgent: vi.fn(),
  pubsubOptions: [] as unknown[],
}))
vi.mock('pg', async (importOriginal) => {
  const { EventEmitter } = await import('node:events')
  const { defaults, escapeIdentifier } = await importOriginal<typeof import('pg')>()
  class Pool extends EventEmitter {
    constructor(options: unknown) {
      super()
      fixture.poolOptions.push(options)
    }
    end = fixture.end
    connect = fixture.connect
  }
  const pg = { Pool, defaults, escapeIdentifier }
  return { ...pg, default: pg }
})
vi.mock('@mastra/redis-streams', async () => {
  const { EventEmitterPubSub } = await import('@mastra/core/events')
  return {
    RedisStreamsPubSub: class extends EventEmitterPubSub {
      constructor(options: unknown) {
        super()
        fixture.pubsubOptions.push(options)
      }
    },
  }
})
vi.mock('@/lib/copilot/agent/agent', () => ({ createCopilotAgent: fixture.createAgent }))

let runtime: typeof import('./runtime')
let postgres: typeof import('@mastra/pg')
const processRuntime = globalThis as typeof globalThis & {
  __studioMastraRuntime?: Promise<{ mastra: Mastra }>
}
beforeEach(async () => {
  processRuntime.__studioMastraRuntime = undefined
  vi.resetModules()
  vi.clearAllMocks()
  fixture.poolOptions.length = 0
  fixture.pubsubOptions.length = 0
  fixture.memoryInit.mockResolvedValue(undefined)
  fixture.workflowInit.mockResolvedValue(undefined)
  fixture.end.mockResolvedValue(undefined)
  fixture.connect.mockResolvedValue({ query: fixture.query, release: fixture.release })
  postgres = await import('@mastra/pg')
  vi.spyOn(postgres.MemoryPG.prototype, 'init').mockImplementation(fixture.memoryInit)
  vi.spyOn(postgres.WorkflowsPG.prototype, 'init').mockImplementation(fixture.workflowInit)
  vi.stubEnv('DATABASE_URL', 'postgresql://studio@studio-test.invalid/studio_test')
  vi.stubEnv('REDIS_URL', '')
  const { Agent } = await import('@mastra/core/agent')
  fixture.createAgent.mockImplementation(
    (memory) =>
      new Agent({ id: 'copilot', name: 'Copilot', instructions: '', model: 'openai/test', memory })
  )
  runtime = await import('./runtime')
})
afterEach(async () => {
  await (await processRuntime.__studioMastraRuntime)?.mastra.shutdown()
  vi.restoreAllMocks()
  processRuntime.__studioMastraRuntime = undefined
  vi.unstubAllEnvs()
})

it('initializes only native memory and workflow domains on one shared pool', async () => {
  const [first, second] = await Promise.all([runtime.getMastra(), runtime.getMastra()])
  const storage = first.getStorage() as PostgresStore
  const { BackgroundTasksInMemory } = await import('@mastra/core/storage')
  expect(first).toBe(second)
  expect(await runtime.getCopilotAgent()).toBe(first.getAgent('copilot'))
  expect(await first.getAgent('copilot').getMemory()).toBe(await runtime.getAgentMemory())
  expect(fixture.createAgent).toHaveBeenCalledWith(await runtime.getAgentMemory())
  expect(fixture.poolOptions).toEqual([
    expect.objectContaining({
      host: 'studio-test.invalid',
      database: 'studio_test',
      user: 'studio',
    }),
  ])
  expect(storage).toBeInstanceOf(postgres.PostgresStore)
  expect(
    Object.entries(storage.stores!)
      .filter(([, value]) => value)
      .map(([name]) => name)
  ).toEqual(['memory', 'workflows', 'backgroundTasks'])
  expect(storage.stores.backgroundTasks).toBeInstanceOf(BackgroundTasksInMemory)
  expect(fixture.memoryInit).toHaveBeenCalledOnce()
  expect(fixture.workflowInit).toHaveBeenCalledOnce()
  expect(fixture.connect).toHaveBeenCalledOnce()
  expect(fixture.release).toHaveBeenCalledOnce()
  expect(await runtime.getNativeMemoryStore()).toBe(storage.stores.memory)
  expect(await runtime.getNativeWorkflowsStore()).toBe(storage.stores.workflows)
  expect(fixture.poolOptions).toHaveLength(1)
  expect(fixture.end).not.toHaveBeenCalled()
  expect(first.recoveryConfig).toMatchObject({ workflows: 'off', durableAgents: 'off' })
  expect(fixture.pubsubOptions).toEqual([])
})
it.each(['memoryInit', 'workflowInit'] as const)(
  'recovers a wrapped PostgreSQL deadlock in %s through native initialization',
  async (domain) => {
    fixture[domain].mockRejectedValueOnce(
      new Error('Schema update failed', {
        cause: Object.assign(new Error('deadlock detected'), { code: '40P01' }),
      })
    )
    await expect(runtime.getMastra()).resolves.toBeDefined()
    expect(fixture[domain]).toHaveBeenCalledTimes(2)
    expect(fixture.connect).toHaveBeenCalledOnce()
    expect(fixture.release).toHaveBeenCalledOnce()
    expect(fixture.end).not.toHaveBeenCalled()
  }
)
it('shares configured Redis transport and the active runtime across module reloads', async () => {
  vi.stubEnv('REDIS_URL', 'redis://studio-test.invalid:6379')
  const mastra = await runtime.getMastra()
  vi.resetModules()
  const reloaded = await import('./runtime')
  expect(await reloaded.getMastra()).toBe(mastra)
  expect(fixture.pubsubOptions).toEqual([{ url: 'redis://studio-test.invalid:6379' }])
  expect(mastra.pubsub).toBeDefined()
  expect(fixture.poolOptions).toHaveLength(1)
  expect(fixture.createAgent).toHaveBeenCalledOnce()
})
it.each(['08006', '40P01'])(
  'releases connections after initialization fails with %s and permits another attempt',
  async (code) => {
    const attempts = code === '40P01' ? 3 : 1
    for (let attempt = 0; attempt < attempts; attempt++)
      fixture.memoryInit.mockRejectedValueOnce(
        Object.assign(new Error('database unavailable'), { code })
      )
    await expect(runtime.getMastra()).rejects.toThrow('database unavailable')
    expect(fixture.memoryInit).toHaveBeenCalledTimes(attempts)
    expect(fixture.release).toHaveBeenCalledOnce()
    expect(fixture.end).toHaveBeenCalledOnce()
    await expect(runtime.getMastra()).resolves.toBeDefined()
    expect(fixture.poolOptions).toHaveLength(2)
  }
)
it('handles idle and transactional client errors through the native pool guards', async () => {
  const mastra = await runtime.getMastra()
  const storage = mastra.getStorage() as PostgresStore
  const error = new Error('Connection disconnected')
  const client = Object.assign(new EventEmitter(), {
    query: fixture.query,
    release: fixture.release,
  })
  fixture.connect.mockResolvedValueOnce(client)
  storage.pool.emit('connect', client)
  storage.pool.emit('acquire', client)
  await expect(
    storage.db.tx(async () => {
      expect(() => client.emit('error', error)).not.toThrow()
      throw error
    })
  ).rejects.toBe(error)
  expect(fixture.query).toHaveBeenCalledWith('ROLLBACK')
  storage.pool.emit('release', undefined, client)
  expect(() => storage.pool.emit('error', error)).not.toThrow()
  expect(await runtime.getMastra()).toBe(mastra)
  expect(fixture.poolOptions).toHaveLength(1)
  expect(fixture.end).not.toHaveBeenCalled()
})
it('ends the pool when Agent construction fails after domain initialization', async () => {
  fixture.createAgent.mockImplementationOnce(() => {
    throw new Error('agent unavailable')
  })
  await expect(runtime.getMastra()).rejects.toThrow('agent unavailable')
  expect(fixture.memoryInit).toHaveBeenCalledOnce()
  expect(fixture.workflowInit).toHaveBeenCalledOnce()
  expect(fixture.end).toHaveBeenCalledOnce()
})
it('requires the Studio database before constructing storage', async () => {
  vi.stubEnv('DATABASE_URL', '')
  await expect(runtime.getMastra()).rejects.toThrow('DATABASE_URL is required')
  expect(fixture.poolOptions).toHaveLength(0)
})
