import { vi } from 'vitest'

// Mock common dependencies used across executor handler tests

// Logger
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}))

// Blocks
vi.mock('@/blocks/index', () => ({
  getBlock: vi.fn(),
}))

// Tools
vi.mock('@/tools/utils', () => ({
  getTool: vi.fn(),
  formatRequestParams: vi.fn(),
  transformTable: vi.fn(),
  createParamSchema: vi.fn(),
  getClientEnvVars: vi.fn(),
  createCustomToolRequestBody: vi.fn(),
  validateRequiredParametersAfterMerge: vi.fn(),
}))

// Utils
vi.mock('@/lib/utils', () => ({
  isHosted: vi.fn().mockReturnValue(false),
}))

// Tools
vi.mock('@/tools')

// Native model calls are mocked by the tests that exercise them.

// Executor utilities
vi.mock('@/executor/path')
vi.mock('@/executor/resolver', () => ({
  InputResolver: vi.fn(),
}))

// Specific block utilities (like router prompt generator)
vi.mock('@/blocks/blocks/router')

// Mock blocks - needed by agent handler for transformBlockTool
vi.mock('@/blocks')

// Mock fetch for server requests
global.fetch = Object.assign(vi.fn(), { preconnect: vi.fn() }) as typeof fetch

// Mock process.env
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
