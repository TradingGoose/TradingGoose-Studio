/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  env: {
    NODE_ENV: 'development',
    REDIS_URL: undefined as string | undefined,
    TRIGGER_PROJECT_ID: undefined as string | undefined,
    TRIGGER_SECRET_KEY: undefined as string | undefined,
  },
  getResolvedSystemSettings: vi.fn(),
  environment: {
    isHosted: false,
  },
}))

vi.mock('@/lib/env', () => ({ env: mocks.env }))
vi.mock('@/lib/environment', () => mocks.environment)
vi.mock('@/lib/system-settings/service', () => ({
  getResolvedSystemSettings: mocks.getResolvedSystemSettings,
}))

describe('trigger execution settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.env.NODE_ENV = 'development'
    mocks.env.REDIS_URL = undefined
    mocks.env.TRIGGER_PROJECT_ID = undefined
    mocks.env.TRIGGER_SECRET_KEY = undefined
    mocks.environment.isHosted = false
    mocks.getResolvedSystemSettings.mockResolvedValue({ triggerDevEnabled: false })
  })

  it('selects Trigger mode only when the setting and credentials are ready', async () => {
    mocks.env.TRIGGER_PROJECT_ID = 'proj_123'
    mocks.env.TRIGGER_SECRET_KEY = 'tr_dev_123'
    mocks.getResolvedSystemSettings.mockResolvedValue({ triggerDevEnabled: true })
    const { getTriggerExecutionState } = await import('./settings')

    await expect(getTriggerExecutionState()).resolves.toEqual({ mode: 'trigger' })
  })

  it('uses the unlimited local mode when Trigger is disabled in development', async () => {
    const { getTriggerExecutionState } = await import('./settings')

    await expect(getTriggerExecutionState()).resolves.toEqual({ mode: 'local' })
  })

  it('fails closed on the hosted service when Trigger is disabled', async () => {
    mocks.environment.isHosted = true
    const { getTriggerExecutionState } = await import('./settings')

    await expect(getTriggerExecutionState()).resolves.toMatchObject({ mode: 'unavailable' })
  })

  it('keeps non-hosted production unlimited without Trigger or Redis', async () => {
    mocks.env.NODE_ENV = 'production'
    const { getTriggerExecutionState } = await import('./settings')

    await expect(getTriggerExecutionState()).resolves.toMatchObject({ mode: 'local' })
  })

  it('fails closed when Trigger is enabled without credentials', async () => {
    mocks.getResolvedSystemSettings.mockResolvedValue({ triggerDevEnabled: true })
    const { getTriggerExecutionState } = await import('./settings')

    await expect(getTriggerExecutionState()).resolves.toMatchObject({ mode: 'unavailable' })
  })
})
