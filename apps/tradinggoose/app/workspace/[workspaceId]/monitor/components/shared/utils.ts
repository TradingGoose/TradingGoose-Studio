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
    indicatorInputs: { ...(monitor.providerConfig.monitor.indicatorInputs ?? {}) },
    existingEncryptedSecretFieldIds: auth?.encryptedSecretFieldIds ?? [],
    isActive: monitor.isActive,
  }
}

export const buildDefaultDraft = ({
  providerId,
  interval,
}: {
  providerId: string
  interval: string
}): MonitorDraft => {
  return {
    workflowId: '',
    blockId: '',
    providerId,
    interval,
    indicatorId: '',
    listing: null,
    secretValues: {},
    providerParamValues: {},
    indicatorInputs: {},
    existingEncryptedSecretFieldIds: [],
    isActive: false,
  }
}

export { toTrimmed }
