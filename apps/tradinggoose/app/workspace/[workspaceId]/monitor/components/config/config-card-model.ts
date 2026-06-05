import type { ListingIdentity } from '@/lib/listing/identity'
import { PORTFOLIO_MONITOR_PROVIDER } from '@/lib/monitors/sources'
import type { MonitorExecutionOutcome } from '../data/execution-ordering'
import type { MonitorExecutionSummary } from '../data/use-monitor-execution-summaries'
import type { MonitorRecord, MonitorReferenceData } from '../shared/types'
import type { ConfigMonitorDimensionField, ConfigMonitorStatus } from '../view/view-config'
import { canonicalizeListingValue } from './config-filter-values'

export type ConfigMonitorCard = {
  monitorId: string
  source: MonitorRecord['source']
  workflowId: string
  blockId: string
  workflowTargetKey: string
  workflowName: string
  workflowTargetLabel: string
  indicatorId: string
  indicatorName: string
  providerId: string
  providerLabel: string
  interval: string
  listing: ListingIdentity | null
  listingValue: string
  listingLabel: string
  isActive: boolean
  status: ConfigMonitorStatus
  createdAt: string
  updatedAt: string
  indicatorInputs: Record<string, unknown>
  auth: MonitorRecord['providerConfig']['monitor']['auth']
  providerParams: MonitorRecord['providerConfig']['monitor']['providerParams']
  lastExecutionAt: string | null
  lastOutcome: MonitorExecutionOutcome | null
  lastExecutionLogId: string | null
  sourceMonitor: MonitorRecord
}

export type ConfigAxisValue = {
  id: string
  label: string
  sortValue: string
}

const VALID_OUTCOMES = new Set<MonitorExecutionOutcome>([
  'running',
  'success',
  'error',
  'skipped',
  'unknown',
])

const readWorkflowTargetKey = (workflowId: string, blockId: string) => `${workflowId}:${blockId}`

const formatListingLabel = (listing: unknown, unknownListingLabel = 'Unknown listing') => {
  const record = listing as Partial<ListingIdentity> | null | undefined
  if (!record) return unknownListingLabel

  if (record.listing_type === 'default') {
    return record.listing_id || unknownListingLabel
  }

  const pair = [record.base_id, record.quote_id].filter(Boolean).join('/')
  return pair || record.listing_id || unknownListingLabel
}

const normalizeSummaryOutcome = (value: unknown): MonitorExecutionOutcome | null =>
  typeof value === 'string' && VALID_OUTCOMES.has(value as MonitorExecutionOutcome)
    ? (value as MonitorExecutionOutcome)
    : null

const normalizeSummaryString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value : null

const getSummaryFields = (summary: MonitorExecutionSummary | undefined) => ({
  lastExecutionAt: normalizeSummaryString(summary?.lastExecutionAt),
  lastExecutionLogId: normalizeSummaryString(summary?.lastExecutionLogId),
  lastOutcome: normalizeSummaryOutcome(summary?.lastOutcome),
})

export const buildConfigMonitorCards = (
  monitors: MonitorRecord[],
  referenceData: MonitorReferenceData,
  summariesByMonitorId: Record<string, MonitorExecutionSummary>,
  options?: {
    unknownListingLabel?: string
  }
): ConfigMonitorCard[] =>
  monitors.map((monitor) => {
    const monitorConfig = monitor.providerConfig.monitor
    const isPortfolio = monitor.source === PORTFOLIO_MONITOR_PROVIDER
    const workflowTargetKey = readWorkflowTargetKey(monitor.workflowId, monitor.blockId)
    const workflowTarget = referenceData.workflowTargetByKey[workflowTargetKey]
    const indicator = monitorConfig.indicatorId
      ? referenceData.indicatorById[monitorConfig.indicatorId]
      : undefined
    const provider = isPortfolio
      ? referenceData.tradingProviderById[monitorConfig.providerId]
      : referenceData.marketProviderById[monitorConfig.providerId]
    const listingValue = isPortfolio
      ? `portfolio:${monitorConfig.serviceId ?? ''}:${monitorConfig.accountId ?? ''}`
      : (canonicalizeListingValue(monitorConfig.listing) ?? '')
    const summary = getSummaryFields(summariesByMonitorId[monitor.monitorId])

    return {
      monitorId: monitor.monitorId,
      source: monitor.source,
      workflowId: monitor.workflowId,
      blockId: monitor.blockId,
      workflowTargetKey,
      workflowName: workflowTarget?.workflowName ?? monitor.workflowId,
      workflowTargetLabel: workflowTarget?.label ?? workflowTargetKey,
      indicatorId: monitorConfig.indicatorId ?? 'portfolio_state',
      indicatorName: isPortfolio
        ? 'Portfolio state'
        : (indicator?.name ?? monitorConfig.indicatorId ?? 'Indicator'),
      providerId: monitorConfig.providerId,
      providerLabel: provider?.name ?? monitorConfig.providerId,
      interval: monitorConfig.interval ?? `${monitorConfig.pollIntervalSeconds ?? 60}s poll`,
      listing: monitorConfig.listing ?? null,
      listingValue,
      listingLabel: isPortfolio
        ? (monitorConfig.accountId ?? 'Portfolio account')
        : formatListingLabel(monitorConfig.listing, options?.unknownListingLabel),
      isActive: monitor.isActive,
      status: monitor.isActive ? 'active' : 'paused',
      createdAt: monitor.createdAt,
      updatedAt: monitor.updatedAt,
      indicatorInputs: { ...(monitorConfig.indicatorInputs ?? {}) },
      auth: monitorConfig.auth,
      providerParams: monitorConfig.providerParams,
      ...summary,
      sourceMonitor: monitor,
    }
  })

export const getConfigCardAxisValue = (
  card: ConfigMonitorCard,
  field: ConfigMonitorDimensionField
): ConfigAxisValue => {
  switch (field) {
    case 'workflowTarget':
      return {
        id: card.workflowTargetKey,
        label: card.workflowTargetLabel,
        sortValue: card.workflowTargetLabel,
      }
    case 'indicator':
      return {
        id: card.indicatorId,
        label: card.indicatorName,
        sortValue: card.indicatorName,
      }
    case 'listing':
      return {
        id: card.listingValue,
        label: card.listingLabel,
        sortValue: card.listingLabel,
      }
    case 'provider':
      return {
        id: card.providerId,
        label: card.providerLabel,
        sortValue: card.providerLabel,
      }
    case 'interval':
      return {
        id: card.interval,
        label: card.interval,
        sortValue: card.interval,
      }
  }
}
