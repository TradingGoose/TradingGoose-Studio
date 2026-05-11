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
    keys.length !== 4 ||
    !keys.includes('activeMode') ||
    !keys.includes('activeViewIdsByMode') ||
    !keys.includes('executionPanelSizes') ||
    !keys.includes('configPanelSizes')
  ) {
    return false
  }

  if (record.activeMode !== 'executions' && record.activeMode !== 'config') {
    return false
  }

  if (!record.activeViewIdsByMode || typeof record.activeViewIdsByMode !== 'object') {
    return false
  }

  const activeIds = record.activeViewIdsByMode as Record<string, unknown>
  const activeIdKeys = Object.keys(activeIds)
  if (activeIdKeys.some((key) => key !== 'executions' && key !== 'config')) {
    return false
  }

  const activeIdsAreValid = activeIdKeys.every((key) => {
    const value = activeIds[key]
    return value === null || typeof value === 'string'
  })

  return (
    activeIdsAreValid &&
    isValidPanelSizes(record.executionPanelSizes) &&
    isValidPanelSizes(record.configPanelSizes)
  )
}

export const readMonitorWorkingStateKey = (workspaceId: string, userId: string) =>
  `${MONITOR_WORKING_STATE_PREFIX}:${workspaceId}:${userId}`

export const readMonitorWorkingState = (
  workspaceId: string,
  userId: string
): MonitorShellWorkingState => {
  if (!workspaceId || !userId) {
    return DEFAULT_MONITOR_SHELL_WORKING_STATE
  }

  const storageKey = readMonitorWorkingStateKey(workspaceId, userId)
  const rawValue = BrowserStorage.getItem<unknown | null>(storageKey, null)

  if (rawValue === null) {
    return DEFAULT_MONITOR_SHELL_WORKING_STATE
  }

  if (!isValidMonitorShellWorkingState(rawValue)) {
    BrowserStorage.removeItem(storageKey)
    return DEFAULT_MONITOR_SHELL_WORKING_STATE
  }

  return normalizeMonitorShellWorkingState(rawValue)
}

export const writeMonitorWorkingState = (
  workspaceId: string,
  userId: string,
  state: unknown
) => {
  if (!workspaceId || !userId) return false

  return BrowserStorage.setItem(
    readMonitorWorkingStateKey(workspaceId, userId),
    normalizeMonitorShellWorkingState(state)
  )
}
