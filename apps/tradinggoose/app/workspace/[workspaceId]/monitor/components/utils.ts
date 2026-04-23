import { getMarketSeriesCapabilities } from '@/providers/market/providers'
import type { MarketProviderParamDefinition } from '@/providers/market/providers'
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

export const isAuthParamDefinition = (definition: MarketProviderParamDefinition) => {
  if (definition.password) return true
  const normalizedId = definition.id.replace(/\s+/g, '').toLowerCase()
  const normalizedTitle = (definition.title ?? '').replace(/\s+/g, '').toLowerCase()
  const normalized = `${normalizedId} ${normalizedTitle}`

  return [
    'apikey',
    'api_key',
    'api-key',
    'secretkey',
    'secret_key',
    'secret-key',
    'token',
    'access_token',
    'auth_token',
    'secret',
    'password',
  ].some((pattern) => normalized.includes(pattern))
}

export const parseIntervalDurationMs = (interval: string | null | undefined): number | null => {
  if (!interval) return null

  const trimmed = interval.trim().toLowerCase()
  if (!trimmed) return null

  const match = /^(\d+)(m|h|d|w|mo)$/.exec(trimmed)
  if (!match) return null

  const amount = Number.parseInt(match[1] ?? '', 10)
  if (!Number.isFinite(amount) || amount <= 0) return null

  const unit = match[2]
  const unitMs =
    unit === 'm'
      ? 60 * 1000
      : unit === 'h'
        ? 60 * 60 * 1000
        : unit === 'd'
          ? 24 * 60 * 60 * 1000
          : unit === 'w'
            ? 7 * 24 * 60 * 60 * 1000
            : 30 * 24 * 60 * 60 * 1000

  return amount * unitMs
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
    secretValues: { ...(auth?.secretReferences ?? {}) },
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
