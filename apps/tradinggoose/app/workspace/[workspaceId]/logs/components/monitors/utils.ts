import { getMarketSeriesCapabilities } from '@/providers/market/providers'
import type { IndicatorMonitorRecord, MonitorDraft } from './types'

const toTrimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

export const parseErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = await response.json()
    if (typeof body?.error === 'string' && body.error.trim().length > 0) {
      return body.error
    }
  } catch {
    // ignore parse failures
  }
  return `Request failed (${response.status})`
}

export const formatListingLabel = (listing: IndicatorMonitorRecord['providerConfig']['monitor']['listing'] | null | undefined) => {
  if (!listing) return 'Select listing'

  if (listing.listing_type === 'default') {
    return listing.listing_id || 'Listing'
  }

  const base = listing.base_id || ''
  const quote = listing.quote_id || ''
  if (base && quote) return `${base}/${quote}`
  return base || quote || 'Listing'
}

const mapProviderParamsToDraftValues = (
  providerParams: Record<string, unknown> | undefined
): Record<string, string> => {
  if (!providerParams) return {}

  return Object.fromEntries(
    Object.entries(providerParams).map(([key, value]) => {
      if (typeof value === 'string') return [key, value]
      if (typeof value === 'number' || typeof value === 'boolean') return [key, String(value)]
      return [key, JSON.stringify(value)]
    })
  )
}

export const buildDraftFromMonitor = (monitor: IndicatorMonitorRecord): MonitorDraft => {
  const auth = monitor.providerConfig.monitor.auth

  return {
    workflowId: monitor.workflowId,
    blockId: monitor.blockId,
    providerId: monitor.providerConfig.monitor.providerId,
    interval: monitor.providerConfig.monitor.interval,
    indicatorId: monitor.providerConfig.monitor.indicatorId,
    listing: monitor.providerConfig.monitor.listing,
    secretValues: {},
    providerParamValues: mapProviderParamsToDraftValues(
      monitor.providerConfig.monitor.providerParams
    ),
    existingEncryptedSecretFieldIds: auth?.encryptedSecretFieldIds ?? [],
    isActive: monitor.isActive,
  }
}

export const buildDefaultDraft = ({
  providers,
}: {
  providers: Array<{ id: string }>
}): MonitorDraft => {
  const providerId = providers[0]?.id ?? 'alpaca'
  const interval = getMarketSeriesCapabilities(providerId)?.intervals?.[0] ?? '1m'

  return {
    workflowId: '',
    blockId: '',
    providerId,
    interval,
    indicatorId: '',
    listing: null,
    secretValues: {},
    providerParamValues: {},
    existingEncryptedSecretFieldIds: [],
    isActive: true,
  }
}

export { toTrimmed }
