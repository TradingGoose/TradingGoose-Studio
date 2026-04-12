import { getCopilotStoreForToolCall } from '@/stores/copilot/store'

export type ListMonitorArgs = {
  workflowId?: string
  blockId?: string
}

export type ReadMonitorArgs = {
  entityId: string
}

export type EditMonitorArgs = ReadMonitorArgs & {
  entityDocument: string
  documentFormat?: string
}

export type IndicatorMonitorRecord = {
  monitorId: string
  workflowId: string
  blockId: string
  isActive: boolean
  providerConfig: {
    monitor: {
      providerId: string
      interval: string
      listing: Record<string, unknown>
      indicatorId: string
      auth?: {
        secretReferences?: Record<string, string>
      }
      providerParams?: Record<string, unknown>
    }
  }
  createdAt: string
  updatedAt: string
}

export function readStoredToolArgs<TArgs>(toolCallId: string): TArgs | undefined {
  try {
    const { toolCallsById } = getCopilotStoreForToolCall(toolCallId).getState()
    return toolCallsById[toolCallId]?.params as TArgs | undefined
  } catch {
    return undefined
  }
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

export function buildMonitorName(record: IndicatorMonitorRecord): string {
  const indicatorId = record.providerConfig.monitor.indicatorId || 'indicator'
  const interval = record.providerConfig.monitor.interval || 'interval'
  const listingLabel = getListingLabel(record.providerConfig.monitor.listing)
  return `${indicatorId} on ${listingLabel} (${interval})`
}

export function toMonitorDocumentFields(record: IndicatorMonitorRecord) {
  const authSecrets = record.providerConfig.monitor.auth?.secretReferences
  return {
    workflowId: record.workflowId,
    blockId: record.blockId,
    providerId: record.providerConfig.monitor.providerId,
    interval: record.providerConfig.monitor.interval,
    indicatorId: record.providerConfig.monitor.indicatorId,
    listing: record.providerConfig.monitor.listing,
    isActive: record.isActive,
    ...(record.providerConfig.monitor.providerParams
      ? { providerParams: record.providerConfig.monitor.providerParams }
      : {}),
    ...(authSecrets ? { auth: { secrets: authSecrets } } : {}),
  }
}

export async function fetchMonitorById(entityId: string): Promise<IndicatorMonitorRecord> {
  const response = await fetch(`/api/indicator-monitors/${encodeURIComponent(entityId)}`)
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload?.error || `Failed to fetch monitor: ${response.status}`)
  }

  if (!payload?.data || typeof payload.data !== 'object') {
    throw new Error('Invalid monitor response')
  }

  return payload.data as IndicatorMonitorRecord
}
