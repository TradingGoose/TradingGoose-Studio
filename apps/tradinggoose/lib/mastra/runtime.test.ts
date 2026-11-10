import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeNativeRuntime, createNativeStorage, getMastra } from './runtime'

const state = vi.hoisted(() => ({
  pools: [] as Array<{ end: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn> }>,
  constructorFailure: false,
  close: vi.fn(async () => {}),
  listThreads: vi.fn(async () => ({ threads: [] })),
}))
vi.mock('pg', () => ({
  Pool: class {
    end = vi.fn(async () => {})
    query = vi.fn(async () => ({ rows: [] }))
    constructor() {
      state.pools.push(this)
    }
  },
}))
vi.mock('@mastra/pg', () => ({
  PostgresStore: class {
    constructor() {
      if (state.constructorFailure) throw new Error('store setup failed')
    }
    close = state.close
    async getStore(domain: string) {
      return domain === 'memory'
        ? {
            supportsRunFencing: async () => true,
            listThreads: state.listThreads,
            listMessages: async () => ({ messages: [] }),
            getResourceById: async () => null,
            getObservationalMemory: async () => null,
          }
        : {
            supportsRunFencing: async () => true,
            listWorkflowRuns: async () => ({ runs: [] }),
            getRunOwnership: async () => null,
          }
    }
  },
}))
vi.mock('@mastra/core/mastra', () => ({ Mastra: class {} }))
vi.mock('@mastra/memory', () => ({ Memory: class {} }))
vi.mock('./connections', () => ({ getConfiguredGateways: () => ({}) }))

beforeEach(() => {
  vi.clearAllMocks()
  state.pools.length = 0
  state.constructorFailure = false
  state.close.mockResolvedValue(undefined)
  state.listThreads.mockResolvedValue({ threads: [] })
  vi.stubEnv('MASTRA_DATABASE_URL', 'postgresql://scoped-runtime@localhost/native_fixture')
})
afterEach(async () => {
  await closeNativeRuntime()
  vi.unstubAllEnvs()
})

describe('native runtime failure cleanup', () => {
  it('closes both supplied pools when public store construction fails', async () => {
    state.constructorFailure = true
    expect(() => createNativeStorage('postgresql://fixture@localhost/native_fixture')).toThrow(
      'store setup failed'
    )
    await Promise.resolve()
    expect(state.pools).toHaveLength(2)
    for (const pool of state.pools) expect(pool.end).toHaveBeenCalledTimes(1)
  })

  it('closes both pools once even when public store close fails', async () => {
    const native = createNativeStorage('postgresql://fixture@localhost/native_fixture')
    state.close.mockRejectedValue(new Error('store close failed'))
    await expect(native.close()).rejects.toThrow('store close failed')
    await expect(native.close()).rejects.toThrow('store close failed')
    expect(state.close).toHaveBeenCalledTimes(1)
    for (const pool of state.pools) expect(pool.end).toHaveBeenCalledTimes(1)
  })

  it('cleans up failed readiness and creates a fresh runtime only after a subsequent check succeeds', async () => {
    state.listThreads.mockRejectedValueOnce(new Error('required native reads unavailable'))
    await expect(getMastra()).rejects.toThrow('required native reads unavailable')
    for (const pool of state.pools) expect(pool.end).toHaveBeenCalledTimes(1)
    await expect(getMastra()).resolves.toBeDefined()
    expect(state.pools).toHaveLength(4)
    expect(state.listThreads).toHaveBeenCalledTimes(2)
    await closeNativeRuntime()
    for (const pool of state.pools) expect(pool.end).toHaveBeenCalledTimes(1)
  })

  it('requires scoped runtime credentials even when an application owner connection is configured', async () => {
    vi.stubEnv('MASTRA_DATABASE_URL', '')
    vi.stubEnv('DATABASE_URL', 'postgresql://deployment-owner@localhost/application_fixture')
    await expect(getMastra()).rejects.toThrow(
      'MASTRA_DATABASE_URL with scoped runtime credentials is required'
    )
    expect(state.pools).toHaveLength(0)
  })
})
