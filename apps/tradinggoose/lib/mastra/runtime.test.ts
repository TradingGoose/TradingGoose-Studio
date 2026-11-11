import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  memoryInit: vi.fn(),
  workflowInit: vi.fn(),
  end: vi.fn(),
  pools: [] as unknown[],
  poolOptions: [] as unknown[],
  domains: [] as Array<{ name: string; options: unknown }>,
  storage: undefined as unknown as import('@mastra/core/storage').MastraCompositeStore,
  agent: {},
  createAgent: vi.fn(),
}))
vi.mock('pg', () => ({
  Pool: class {
    constructor(options: unknown) {
      fixture.poolOptions.push(options)
      fixture.pools.push(this)
    }
    end = fixture.end
  },
}))
vi.mock('@mastra/pg', () => ({
  MemoryPG: class {
    constructor(options: unknown) {
      fixture.domains.push({ name: 'memory', options })
    }
    init = fixture.memoryInit
  },
  WorkflowsPG: class {
    constructor(options: unknown) {
      fixture.domains.push({ name: 'workflows', options })
    }
    init = fixture.workflowInit
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
    }
    getAgent(id: string) {
      return this.config.agents[id]
    }
  },
}))
vi.mock('@mastra/memory', () => ({ Memory: class {} }))
vi.mock('@/lib/copilot/agent/agent', () => ({ createCopilotAgent: fixture.createAgent }))
vi.mock('./connections', () => ({ getConfiguredGateways: () => ({}) }))

let runtime: typeof import('./runtime')
beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  fixture.pools.length = 0
  fixture.poolOptions.length = 0
  fixture.domains.length = 0
  fixture.memoryInit.mockResolvedValue(undefined)
  fixture.workflowInit.mockResolvedValue(undefined)
  fixture.end.mockResolvedValue(undefined)
  vi.stubEnv('DATABASE_URL', 'postgresql://studio@localhost/studio_disposable')
  fixture.createAgent.mockReturnValue(fixture.agent)
  runtime = await import('./runtime')
})
afterEach(() => vi.unstubAllEnvs())

it('initializes only native memory and workflow domains on one shared pool', async () => {
  await runtime.getMastra()
  expect(await runtime.getCopilotAgent()).toBe(fixture.agent)
  expect(fixture.createAgent).toHaveBeenCalledWith(await runtime.getAgentMemory())
  expect(fixture.poolOptions).toEqual([{ connectionString: process.env.DATABASE_URL, max: 20 }])
  expect(fixture.domains).toEqual(
    ['memory', 'workflows'].map((name) => ({
      name,
      options: { pool: fixture.pools[0], schemaName: 'mastra' },
    }))
  )
  expect(
    Object.entries(fixture.storage.stores!)
      .filter(([, value]) => value)
      .map(([name]) => name)
  ).toEqual(['memory', 'workflows'])
  expect(fixture.memoryInit).toHaveBeenCalledOnce()
  expect(fixture.workflowInit).toHaveBeenCalledOnce()
  expect(await runtime.getNativeMemoryStore()).toBe(fixture.storage.stores?.memory)
  expect(await runtime.getNativeWorkflowsStore()).toBe(fixture.storage.stores?.workflows)
  expect(fixture.poolOptions).toHaveLength(1)
  expect(fixture.end).not.toHaveBeenCalled()
})
it('ends the pool after failed initialization and permits a subsequent attempt', async () => {
  fixture.memoryInit.mockRejectedValueOnce(new Error('database unavailable'))
  await expect(runtime.getMastra()).rejects.toThrow('database unavailable')
  expect(fixture.end).toHaveBeenCalledOnce()
  await expect(runtime.getMastra()).resolves.toBeDefined()
  expect(fixture.poolOptions).toHaveLength(2)
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
