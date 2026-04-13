/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

describe('trigger execution settings', () => {
  it('enables execution only when system settings and credentials are both ready', async () => {
    vi.resetModules()
    vi.doMock('@/lib/env', () => ({
      env: {
        TRIGGER_PROJECT_ID: 'proj_123',
        TRIGGER_SECRET_KEY: 'tr_dev_123',
      },
    }))
    vi.doMock('@/lib/system-settings/service', () => ({
      getResolvedSystemSettings: vi.fn().mockResolvedValue({
        triggerDevEnabled: true,
      }),
    }))

    const { getTriggerExecutionState, isTriggerExecutionEnabled } = await import(
      '@/lib/trigger/settings'
    )

    await expect(getTriggerExecutionState()).resolves.toEqual({
      configurationReady: true,
      triggerDevEnabled: true,
      executionEnabled: true,
    })
    await expect(isTriggerExecutionEnabled()).resolves.toBe(true)
  })

  it('keeps execution disabled when credentials exist but the system toggle is off', async () => {
    vi.resetModules()
    vi.doMock('@/lib/env', () => ({
      env: {
        TRIGGER_PROJECT_ID: 'proj_123',
        TRIGGER_SECRET_KEY: 'tr_dev_123',
      },
    }))
    vi.doMock('@/lib/system-settings/service', () => ({
      getResolvedSystemSettings: vi.fn().mockResolvedValue({
        triggerDevEnabled: false,
      }),
    }))

    const { getTriggerExecutionState, isTriggerExecutionEnabled } = await import(
      '@/lib/trigger/settings'
    )

    await expect(getTriggerExecutionState()).resolves.toEqual({
      configurationReady: true,
      triggerDevEnabled: false,
      executionEnabled: false,
    })
    await expect(isTriggerExecutionEnabled()).resolves.toBe(false)
  })
})
