import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  init: vi.fn(),
  close: vi.fn(),
  stores: [] as unknown[],
  agent: {},
  createAgent: vi.fn(),
}))
vi.mock('@mastra/pg', () => ({
  PostgresStore: class {
    constructor(options: unknown) {
      fixture.stores.push(options)
    }
    init = fixture.init
    close = fixture.close
  },
}))
vi.mock('@mastra/core/mastra', () => ({ Mastra: class {} }))
vi.mock('@mastra/memory', () => ({ Memory: class {} }))
vi.mock('@/lib/copilot/agent/agent', () => ({ createCopilotAgent: fixture.createAgent }))
vi.mock('./connections', () => ({ getConfiguredGateways: () => ({}) }))

let runtime: typeof import('./runtime')
beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  fixture.stores.length = 0
  fixture.init.mockResolvedValue(undefined)
  fixture.close.mockResolvedValue(undefined)
  vi.stubEnv('DATABASE_URL', 'postgresql://studio@localhost/studio_disposable')
  fixture.createAgent.mockReturnValue(fixture.agent)
  runtime = await import('./runtime')
})
afterEach(() => vi.unstubAllEnvs())

it('initializes one shared adapter and Memory for Studio Agents', async () => {
  await runtime.getMastra()
  expect(await runtime.getCopilotAgent()).toBe(fixture.agent)
  expect(fixture.createAgent).toHaveBeenCalledWith(await runtime.getAgentMemory())
  expect(fixture.stores).toEqual([
    {
      id: 'studio',
      schemaName: 'mastra',
      connectionString: process.env.DATABASE_URL,
    },
  ])
  expect(fixture.init).toHaveBeenCalledOnce()
})
it('closes failed initialization and permits a subsequent attempt', async () => {
  fixture.init.mockRejectedValueOnce(new Error('database unavailable'))
  await expect(runtime.getMastra()).rejects.toThrow('database unavailable')
  expect(fixture.close).toHaveBeenCalledOnce()
  await expect(runtime.getMastra()).resolves.toBeDefined()
  expect(fixture.stores).toHaveLength(2)
})
it('requires the Studio database before constructing storage', async () => {
  vi.stubEnv('DATABASE_URL', '')
  await expect(runtime.getMastra()).rejects.toThrow('DATABASE_URL is required')
  expect(fixture.stores).toHaveLength(0)
})
