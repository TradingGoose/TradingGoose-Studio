/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserStorage } from '@/lib/browser-storage'
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

  it('persists shell working state by workspace and user', () => {
    writeMonitorWorkingState('workspace-1', 'user-1', {
      isMonitorsPaneOpen: false,
      outerPanelSizes: [24, 76],
      innerPanelSizes: [60, 40],
    })

    expect(readMonitorWorkingState('workspace-1', 'user-1')).toEqual({
      isMonitorsPaneOpen: false,
      outerPanelSizes: [24, 76],
      innerPanelSizes: [60, 40],
    })
  })

  it('clears invalid shell working state blobs instead of normalizing them', () => {
    const key = getMonitorWorkingStateKey('workspace-1', 'user-1')
    storage.set(key, {
      layout: 'kanban',
      outerPanelSizes: [24, 76],
    })

    expect(readMonitorWorkingState('workspace-1', 'user-1')).toEqual({
      isMonitorsPaneOpen: true,
      outerPanelSizes: null,
      innerPanelSizes: null,
    })
    expect(storage.has(key)).toBe(false)
  })

  it('clears shell state when panel sizes are non-positive or impossible', () => {
    const key = getMonitorWorkingStateKey('workspace-1', 'user-1')
    storage.set(key, {
      isMonitorsPaneOpen: true,
      outerPanelSizes: [0, 100],
      innerPanelSizes: [-10, 110],
    })

    expect(readMonitorWorkingState('workspace-1', 'user-1')).toEqual({
      isMonitorsPaneOpen: true,
      outerPanelSizes: null,
      innerPanelSizes: null,
    })
    expect(storage.has(key)).toBe(false)
  })
})
