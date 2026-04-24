import { BrowserStorage } from '@/lib/browser-storage'
import {
  DEFAULT_MONITOR_SHELL_WORKING_STATE,
  normalizeMonitorShellWorkingState,
  type MonitorShellWorkingState,
} from './view-config'

const MONITOR_WORKING_STATE_PREFIX = 'monitor-working-state'

const isValidPanelSizes = (value: unknown): value is [number, number] | null => {
  if (value === null) {
    return true
  }

  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((entry) => typeof entry === 'number' && Number.isFinite(entry) && entry > 0) &&
    Math.abs(value[0] + value[1] - 100) <= 1
  )
}

const isValidMonitorShellWorkingState = (value: unknown): value is MonitorShellWorkingState => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (
    keys.length !== 3 ||
    !keys.includes('isMonitorsPaneOpen') ||
    !keys.includes('outerPanelSizes') ||
    !keys.includes('innerPanelSizes')
  ) {
    return false
  }

  return (
    typeof record.isMonitorsPaneOpen === 'boolean' &&
    isValidPanelSizes(record.outerPanelSizes) &&
    isValidPanelSizes(record.innerPanelSizes)
  )
}

export const getMonitorWorkingStateKey = (workspaceId: string, userId: string) =>
  `${MONITOR_WORKING_STATE_PREFIX}:${workspaceId}:${userId}`

export const readMonitorWorkingState = (
  workspaceId: string,
  userId: string
): MonitorShellWorkingState => {
  if (!workspaceId || !userId) {
    return DEFAULT_MONITOR_SHELL_WORKING_STATE
  }

  const storageKey = getMonitorWorkingStateKey(workspaceId, userId)
  const rawValue = BrowserStorage.getItem<unknown | null>(storageKey, null)

  if (rawValue === null) {
    return DEFAULT_MONITOR_SHELL_WORKING_STATE
  }

  if (!isValidMonitorShellWorkingState(rawValue)) {
    BrowserStorage.removeItem(storageKey)
    return DEFAULT_MONITOR_SHELL_WORKING_STATE
  }

  return rawValue
}

export const writeMonitorWorkingState = (
  workspaceId: string,
  userId: string,
  state: MonitorShellWorkingState
) => {
  if (!workspaceId || !userId) return false

  return BrowserStorage.setItem(
    getMonitorWorkingStateKey(workspaceId, userId),
    normalizeMonitorShellWorkingState(state)
  )
}
