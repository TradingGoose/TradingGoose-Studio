import { EventEmitter } from 'node:events'
import { MemoryPG, PostgresStore, WorkflowsPG } from '@mastra/pg'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  memoryInit: vi.fn(),
  workflowInit: vi.fn(),
  end: vi.fn(),
  query: vi.fn(async () => ({ rows: [] })),
  release: vi.fn(),
  connect: vi.fn(),
  error: vi.fn(),
  pools: [] as EventEmitter[],
  poolOptions: [] as unknown[],
  storage: undefined as unknown as PostgresStore,
  agent: {},
  createAgent: vi.fn(),
  pubsubOptions: [] as unknown[],
  config: {} as Record<string, unknown>,
}))
vi.mock('pg', () => ({
  Pool: class extends EventEmitter {
    constructor(options: unknown) {
      super()
      fixture.poolOptions.push(options)
      fixture.pools.push(this)
    }
    end = fixture.end
    connect = fixture.connect
  },
}))
vi.mock('@mastra/core/mastra', () => ({
  Mastra: class {
    constructor(
      private config: {
        agents: Record<string, unknown>
        storage: typeof fixture.storage
      }
    ) {
      fixture.storage = config.storage
      fixture.config = config
    }
    getAgent(id: string) {
      return this.config.agents[id]
    }
  },
}))
vi.mock('@mastra/redis-streams', () => ({
  RedisStreamsPubSub: class {
    constructor(options: unknown) {
      fixture.pubsubOptions.push(options)
    }
  },
}))
vi.mock('@mastra/memory', () => ({ Memory: class {} }))
vi.mock('@/lib/copilot/agent/agent', () => ({ createCopilotAgent: fixture.createAgent }))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ error: fixture.error }),
}))

let runtime: typeof import('./runtime')
const processRuntime = globalThis as typeof globalThis & { __studioMastraRuntime?: unknown }
beforeEach(async () => {
  processRuntime.__studioMastraRuntime = undefined
  vi.resetModules()
  vi.clearAllMocks()
  fixture.pools.length = 0
  fixture.poolOptions.length = 0
  fixture.pubsubOptions.length = 0
  fixture.memoryInit.mockResolvedValue(undefined)
  fixture.workflowInit.mockResolvedValue(undefined)
  fixture.end.mockResolvedValue(undefined)
  fixture.connect.mockResolvedValue({ query: fixture.query, release: fixture.release })
  vi.spyOn(MemoryPG.prototype, 'init').mockImplementation(fixture.memoryInit)
  vi.spyOn(WorkflowsPG.prototype, 'init').mockImplementation(fixture.workflowInit)
  vi.stubEnv('DATABASE_URL', 'postgresql://studio@localhost/studio_disposable')
  vi.stubEnv('REDIS_URL', '')
  fixture.createAgent.mockReturnValue(fixture.agent)
  runtime = await import('./runtime')
})
afterEach(() => {
  vi.restoreAllMocks()
  processRuntime.__studioMastraRuntime = undefined
  vi.unstubAllEnvs()
})

it('initializes only native memory and workflow domains on one shared pool', async () => {
  const [first, second] = await Promise.all([runtime.getMastra(), runtime.getMastra()])
  expect(first).toBe(second)
  expect(await runtime.getCopilotAgent()).toBe(fixture.agent)
  expect(fixture.createAgent).toHaveBeenCalledWith(await runtime.getAgentMemory())
  expect(fixture.poolOptions).toEqual([{ connectionString: process.env.DATABASE_URL, max: 20 }])
  expect(fixture.storage).toBeInstanceOf(PostgresStore)
  expect(
    Object.entries(fixture.storage.stores!)
      .filter(([, value]) => value)
      .map(([name]) => name)
  ).toEqual(['memory', 'workflows'])
  expect(fixture.memoryInit).toHaveBeenCalledOnce()
  expect(fixture.workflowInit).toHaveBeenCalledOnce()
  expect(fixture.connect).toHaveBeenCalledOnce()
  expect(fixture.release).toHaveBeenCalledOnce()
  expect(await runtime.getNativeMemoryStore()).toBe(fixture.storage.stores?.memory)
  expect(await runtime.getNativeWorkflowsStore()).toBe(fixture.storage.stores?.workflows)
  expect(fixture.poolOptions).toHaveLength(1)
  expect(fixture.end).not.toHaveBeenCalled()
  expect(fixture.config).toMatchObject({ recovery: { workflows: 'off', durableAgents: 'off' } })
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
  expect(fixture.config.pubsub).toBeDefined()
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
it('handles idle connection errors without crashing or replacing the shared pool', async () => {
  const mastra = await runtime.getMastra()
  const error = new Error('Idle connection disconnected')
  expect(() => fixture.pools[0].emit('error', error)).not.toThrow()
  expect(fixture.error).toHaveBeenCalledWith('Unexpected Mastra PostgreSQL pool error', error)
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
