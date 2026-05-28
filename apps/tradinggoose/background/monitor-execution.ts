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

export type MonitorExecutionPayload =
  | IndicatorMonitorExecutionPayload
  | PortfolioMonitorExecutionPayload

const monitorExecutionHandlers = {
  [INDICATOR_MONITOR_PROVIDER]: {
    isPayload: isIndicatorMonitorExecutionPayload,
    execute: executeIndicatorMonitorJob,
  },
  [PORTFOLIO_MONITOR_PROVIDER]: {
    isPayload: isPortfolioMonitorExecutionPayload,
    execute: executePortfolioMonitorJob,
  },
} as const

export function isMonitorExecutionPayload(value: unknown): value is MonitorExecutionPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const source = (value as { source?: unknown }).source
  const handler =
    source === INDICATOR_MONITOR_PROVIDER || source === PORTFOLIO_MONITOR_PROVIDER
      ? monitorExecutionHandlers[source]
      : null
  return handler ? handler.isPayload(value) : false
}

export async function executeMonitorJob(payload: MonitorExecutionPayload) {
  const handler = monitorExecutionHandlers[payload.source]
  return handler.execute(payload as never)
}
