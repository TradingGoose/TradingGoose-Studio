import { afterAll, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'

global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  })
) as any

// Mock localStorage and sessionStorage for Zustand persist middleware
const storageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  key: vi.fn(),
  length: 0,
}

global.localStorage = storageMock as any
global.sessionStorage = storageMock as any

// Mock drizzle-orm sql template literal globally for tests
vi.mock('drizzle-orm', () => ({
  sql: vi.fn((strings, ...values) => ({
    strings,
    values,
    type: 'sql',
    _: { brand: 'SQL' },
  })),
  eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
  and: vi.fn((...conditions) => ({ type: 'and', conditions })),
  desc: vi.fn((field) => ({ field, type: 'desc' })),
  or: vi.fn((...conditions) => ({ type: 'or', conditions })),
  InferSelectModel: {},
  InferInsertModel: {},
}))

vi.mock('@/lib/logs/console/logger', () => {
  const createLogger = vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  }))

  return { createLogger }
})

vi.mock('@/stores/console/store', () => ({
  useConsoleStore: {
    getState: vi.fn().mockReturnValue({
      addConsole: vi.fn(),
    }),
  },
}))

vi.mock('@/stores/execution/store', () => ({
  useExecutionStore: {
    getState: vi.fn().mockReturnValue({
      setIsExecuting: vi.fn(),
      setIsDebugging: vi.fn(),
      setPendingBlocks: vi.fn(),
      reset: vi.fn(),
      setActiveBlocks: vi.fn(),
    }),
  },
}))

vi.mock('@/blocks/registry', () => {
  const fallbackBlock = {
    name: 'Mock Block',
    description: 'Mock block description',
    icon: () => null,
    category: 'blocks',
    subBlocks: [],
    outputs: {},
  }

  const registry = {
    agent: { ...fallbackBlock, name: 'Mock Agent' },
    condition: { ...fallbackBlock, name: 'Mock Condition' },
    generic_webhook: { ...fallbackBlock, name: 'Mock Webhook', category: 'triggers' },
  }

  const getBlock = vi.fn((type: string) => {
    const candidate = (registry as Record<string, any>)[type]
    if (candidate) {
      return candidate
    }

    return { ...fallbackBlock, name: `Mock ${type}` }
  })

  const getAllBlocks = vi.fn(() => Object.values(registry))
  const getBlocksByCategory = vi.fn((category: string) =>
    Object.values(registry).filter((block) => block.category === category)
  )
  const getAllBlockTypes = vi.fn(() => Object.keys(registry))
  const isValidBlockType = vi.fn((type: string) =>
    Object.prototype.hasOwnProperty.call(registry, type)
  )

  return {
    registry,
    getBlock,
    getAllBlocks,
    getBlocksByCategory,
    getAllBlockTypes,
    isValidBlockType,
  }
})

const originalConsoleError = console.error
const originalConsoleWarn = console.warn

console.error = (...args: any[]) => {
  if (args[0] === 'Workflow execution failed:' && args[1]?.message === 'Test error') {
    return
  }
  if (typeof args[0] === 'string' && args[0].includes('[zustand persist middleware]')) {
    return
  }
  originalConsoleError(...args)
}

console.warn = (...args: any[]) => {
  if (typeof args[0] === 'string' && args[0].includes('[zustand persist middleware]')) {
    return
  }
  originalConsoleWarn(...args)
}

afterAll(() => {
  console.error = originalConsoleError
  console.warn = originalConsoleWarn
})
