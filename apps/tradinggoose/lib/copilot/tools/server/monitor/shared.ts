import {
  MONITOR_DOCUMENT_FORMAT,
  readMonitorDocumentName,
  serializeMonitorDocument,
} from '@/lib/copilot/monitor/monitor-documents'
import {
  INDICATOR_MONITOR_PROVIDER,
  type MonitorWebhookProvider,
  PORTFOLIO_MONITOR_PROVIDER,
} from '@/lib/monitors/sources'

export type MonitorRecord = {
  monitorId: string
  source: MonitorWebhookProvider
  workflowId: string
  blockId: string
  isActive: boolean
  providerConfig: {
    monitor: {
      providerId: string
      interval?: string
      listing?: Record<string, unknown>
      indicatorId?: string
      serviceId?: string
      credentialId?: string
      accountId?: string
      condition?: unknown
      fireMode?: 'edge' | 'while_true'
      cooldownSeconds?: number
      pollIntervalSeconds?: number
      auth?: {
        hasEncryptedSecrets?: boolean
        encryptedSecretFieldIds?: string[]
      }
      providerParams?: Record<string, unknown>
    }
  }
  createdAt: string
  updatedAt: string
}

function getListingLabel(listing: Record<string, unknown> | null | undefined): string {
  if (!listing || typeof listing !== 'object') {
    return 'listing'
  }

  const name = typeof listing.name === 'string' ? listing.name.trim() : ''
  if (name) return name

  const listingType = typeof listing.listing_type === 'string' ? listing.listing_type : ''
  if (listingType === 'default') {
    const listingId = typeof listing.listing_id === 'string' ? listing.listing_id.trim() : ''
    return listingId || 'listing'
  }

  const baseId = typeof listing.base_id === 'string' ? listing.base_id.trim() : ''
  const quoteId = typeof listing.quote_id === 'string' ? listing.quote_id.trim() : ''
  return baseId && quoteId ? `${baseId}/${quoteId}` : baseId || quoteId || 'listing'
}

export function buildMonitorName(record: MonitorRecord): string {
  if (record.source === PORTFOLIO_MONITOR_PROVIDER) {
    return `Portfolio state (${record.providerConfig.monitor.accountId || 'account'})`
  }

  const indicatorId = record.providerConfig.monitor.indicatorId || 'indicator'
  const interval = record.providerConfig.monitor.interval || 'interval'
  const listingLabel = getListingLabel(record.providerConfig.monitor.listing)
  return `${indicatorId} on ${listingLabel} (${interval})`
}

export function toMonitorDocumentFields(record: MonitorRecord) {
  const monitor = record.providerConfig.monitor
  if (record.source === PORTFOLIO_MONITOR_PROVIDER) {
    return {
      source: PORTFOLIO_MONITOR_PROVIDER,
      workflowId: record.workflowId,
      blockId: record.blockId,
      providerId: monitor.providerId,
      serviceId: monitor.serviceId,
      credentialId: monitor.credentialId,
      accountId: monitor.accountId,
      condition: monitor.condition,
      fireMode: monitor.fireMode,
      cooldownSeconds: monitor.cooldownSeconds,
      pollIntervalSeconds: monitor.pollIntervalSeconds,
      isActive: record.isActive,
    }
  }

  return {
    source: INDICATOR_MONITOR_PROVIDER,
    workflowId: record.workflowId,
    blockId: record.blockId,
    providerId: monitor.providerId,
    interval: monitor.interval,
    indicatorId: monitor.indicatorId,
    listing: monitor.listing,
    isActive: record.isActive,
    ...(monitor.providerParams ? { providerParams: monitor.providerParams } : {}),
  }
}

export function buildMonitorDocumentEnvelope(record: MonitorRecord, success?: boolean) {
  const fields = toMonitorDocumentFields(record)
  return {
    ...(success === undefined ? {} : { success }),
    surfaceKind: 'monitor' as const,
    monitorId: record.monitorId,
    monitorName: readMonitorDocumentName(fields),
    documentFormat: MONITOR_DOCUMENT_FORMAT,
    monitorDocument: serializeMonitorDocument(fields),
  }
}

export function buildMonitorListEntry(record: MonitorRecord) {
  const monitor = record.providerConfig.monitor
  return {
    monitorId: record.monitorId,
    monitorName: buildMonitorName(record),
    monitorDescription: `Workflow ${record.workflowId}, block ${record.blockId}`,
    workflowId: record.workflowId,
    blockId: record.blockId,
    source: record.source,
    providerId: monitor.providerId,
    ...(monitor.indicatorId ? { indicatorId: monitor.indicatorId } : {}),
    ...(monitor.interval ? { interval: monitor.interval } : {}),
    ...(monitor.serviceId ? { serviceId: monitor.serviceId } : {}),
    ...(monitor.credentialId ? { credentialId: monitor.credentialId } : {}),
    ...(monitor.accountId ? { accountId: monitor.accountId } : {}),
    isActive: record.isActive,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}
