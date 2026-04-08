import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ExecutionLogger } from '@/lib/logs/execution/logger'

vi.mock('@tradinggoose/db', () => ({
  db: {},
}))

vi.mock('@tradinggoose/db/schema', () => ({
  member: {},
  organization: {},
  userStats: {},
  user: {},
  workflow: {},
  workflowExecutionLogs: {},
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: vi.fn(),
}))

vi.mock('@/lib/billing/core/usage', () => ({
  checkUsageStatus: vi.fn(),
  maybeSendUsageThresholdEmail: vi.fn(),
}))

vi.mock('@/lib/billing/threshold-billing', () => ({
  checkAndBillOverageThreshold: vi.fn(),
}))

vi.mock('@/lib/environment', () => ({
  isBillingEnabled: vi.fn(() => false),
}))

vi.mock('@/lib/logs/events', () => ({
  emitWorkflowExecutionCompleted: vi.fn(),
}))

vi.mock('@/lib/logs/execution/snapshot/service', () => ({
  snapshotService: {},
}))

describe('ExecutionLogger', () => {
  let logger: ExecutionLogger

  beforeEach(() => {
    logger = new ExecutionLogger()
  })

  describe('class instantiation', () => {
    test('should create logger instance', () => {
      expect(logger).toBeDefined()
      expect(logger).toBeInstanceOf(ExecutionLogger)
    })
  })
})
