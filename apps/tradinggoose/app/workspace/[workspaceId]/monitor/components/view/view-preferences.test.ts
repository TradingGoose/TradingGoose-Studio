/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserStorage } from '@/lib/browser-storage'
import { DEFAULT_MONITOR_SHELL_WORKING_STATE, type MonitorShellWorkingState } from './view-config'
import {
  getMonitorWorkingStateKey,
  readMonitorWorkingState,
  writeMonitorWorkingState,
} from './view-preferences'

describe('monitor view preferences', () => {
  const storage = new Map<string, unknown>()

  beforeEach(() => {
    storage.clear()
    vi.spyOn(BrowserStorage, 'getItem').mockImplementation((key, defaultValue) =>
      storage.has(key) ? (storage.get(key) as any) : defaultValue
    )
    vi.spyOn(BrowserStorage, 'setItem').mockImplementation((key, value) => {
      storage.set(key, value)
      return true
    })
    vi.spyOn(BrowserStorage, 'removeItem').mockImplementation((key) => {
      storage.delete(key)
      return true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('persists mode-aware shell working state by workspace and user', () => {
    const state: MonitorShellWorkingState = {
      activeMode: 'config',
      activeViewIdsByMode: { executions: 'exec-view', config: 'config-view' },
      executionPanelSizes: [60, 40],
      configPanelSizes: [70, 30],
    }

    writeMonitorWorkingState('workspace-1', 'user-1', state)

    expect(readMonitorWorkingState('workspace-1', 'user-1')).toEqual(state)
    expect(readMonitorWorkingState('workspace-1', 'user-2')).toEqual(
      DEFAULT_MONITOR_SHELL_WORKING_STATE
    )
  })

  it('does not write shell working state without a workspace and user scope', () => {
    const state: MonitorShellWorkingState = {
      activeMode: 'config',
      activeViewIdsByMode: { config: 'config-view' },
      executionPanelSizes: [60, 40],
      configPanelSizes: [70, 30],
    }

    expect(writeMonitorWorkingState('', 'user-1', state)).toBe(false)
    expect(writeMonitorWorkingState('workspace-1', '', state)).toBe(false)
    expect(BrowserStorage.setItem).not.toHaveBeenCalled()
    expect(storage.size).toBe(0)
  })

  it('removes legacy shell working state blobs instead of translating them', () => {
    const key = getMonitorWorkingStateKey('workspace-1', 'user-1')
    storage.set(key, {
      isMonitorsPaneOpen: false,
      outerPanelSizes: [24, 76],
      innerPanelSizes: [60, 40],
    })

    expect(readMonitorWorkingState('workspace-1', 'user-1')).toEqual(
      DEFAULT_MONITOR_SHELL_WORKING_STATE
    )
    expect(storage.has(key)).toBe(false)
  })

  it('clears malformed new shell state blobs', () => {
    const key = getMonitorWorkingStateKey('workspace-1', 'user-1')
    storage.set(key, {
      activeMode: 'config',
      activeViewIdsByMode: { config: 'config-view', other: 'bad' },
      executionPanelSizes: [0, 100],
      configPanelSizes: [-10, 110],
    })

    expect(readMonitorWorkingState('workspace-1', 'user-1')).toEqual(
      DEFAULT_MONITOR_SHELL_WORKING_STATE
    )
    expect(storage.has(key)).toBe(false)
  })
})
