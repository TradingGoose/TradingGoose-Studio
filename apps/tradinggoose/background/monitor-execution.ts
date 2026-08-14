import { INDICATOR_MONITOR_PROVIDER, PORTFOLIO_MONITOR_PROVIDER } from '@/lib/monitors/sources'
import {
  executeIndicatorMonitorJob,
  type IndicatorMonitorExecutionPayload,
  isIndicatorMonitorExecutionPayload,
} from './indicator-monitor-execution'
import {
  executePortfolioMonitorJob,
  isPortfolioMonitorExecutionPayload,
  type PortfolioMonitorExecutionPayload,
} from './portfolio-monitor-execution'
import type { WorkflowExecutionAttemptOptions } from './workflow-execution'

export type MonitorExecutionPayload =
  | IndicatorMonitorExecutionPayload
  | PortfolioMonitorExecutionPayload

const monitorExecutionHandlers = {
  [INDICATOR_MONITOR_PROVIDER]: isIndicatorMonitorExecutionPayload,
  [PORTFOLIO_MONITOR_PROVIDER]: isPortfolioMonitorExecutionPayload,
} as const

export function isMonitorExecutionPayload(value: unknown): value is MonitorExecutionPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const source = (value as { source?: unknown }).source
  if (typeof source !== 'string') return false
  if (!Object.hasOwn(monitorExecutionHandlers, source)) return false
  return monitorExecutionHandlers[source as keyof typeof monitorExecutionHandlers](value)
}

export async function executeMonitorJob(
  payload: MonitorExecutionPayload,
  options?: WorkflowExecutionAttemptOptions
) {
  if (payload.source === INDICATOR_MONITOR_PROVIDER) {
    return executeIndicatorMonitorJob(payload)
  }
  if (!options) {
    throw new Error('Portfolio monitor execution is missing its captured time policy')
  }
  return executePortfolioMonitorJob(payload, options)
}
