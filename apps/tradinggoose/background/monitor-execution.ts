import { INDICATOR_MONITOR_PROVIDER } from '@/lib/monitors/sources'
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

export function isMonitorExecutionPayload(value: unknown): value is MonitorExecutionPayload {
  return isIndicatorMonitorExecutionPayload(value) || isPortfolioMonitorExecutionPayload(value)
}

export async function executeMonitorJob(
  payload: MonitorExecutionPayload & { executionId: string }
) {
  return payload.source === INDICATOR_MONITOR_PROVIDER
    ? executeIndicatorMonitorJob(payload)
    : executePortfolioMonitorJob(payload)
}
