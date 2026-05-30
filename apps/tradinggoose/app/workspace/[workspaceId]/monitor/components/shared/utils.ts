import type { MarketProviderParamDefinition } from '@/providers/market/providers'
import type { MonitorDraft, MonitorRecord } from './types'

const toTrimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

export const DEFAULT_PORTFOLIO_FIRE_CONDITION = {
  root: {
    combinator: 'and' as const,
    rules: [
      {
        metric: 'summary.totalPortfolioValue' as const,
        operator: 'gt' as const,
        value: 0,
      },
    ],
  },
}

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

export const buildDraftFromMonitor = (monitor: MonitorRecord): MonitorDraft => {
  const auth = monitor.providerConfig.monitor.auth
  const monitorConfig = monitor.providerConfig.monitor

  return {
    source: monitor.source,
    workflowId: monitor.workflowId,
    blockId: monitor.blockId,
    providerId: monitorConfig.providerId,
    interval: monitorConfig.interval ?? '',
    indicatorId: monitorConfig.indicatorId ?? '',
    listing: monitorConfig.listing ?? null,
    serviceId: monitorConfig.serviceId ?? '',
    credentialId: monitorConfig.credentialId ?? '',
    accountId: monitorConfig.accountId ?? '',
    condition: monitorConfig.condition ?? DEFAULT_PORTFOLIO_FIRE_CONDITION,
    fireMode: monitorConfig.fireMode ?? 'edge',
    cooldownSeconds: monitorConfig.cooldownSeconds ?? 300,
    pollIntervalSeconds: monitorConfig.pollIntervalSeconds ?? 60,
    secretValues: {},
    providerParamValues: mapProviderParamsToDraftValues(monitorConfig.providerParams),
    indicatorInputs: { ...(monitorConfig.indicatorInputs ?? {}) },
    existingEncryptedSecretFieldIds: auth?.encryptedSecretFieldIds ?? [],
    isActive: monitor.isActive,
  }
}

export const buildDefaultDraft = ({
  source = 'indicator',
  providerId,
  interval,
}: {
  source?: MonitorDraft['source']
  providerId: string
  interval: string
}): MonitorDraft => {
  return {
    source,
    workflowId: '',
    blockId: '',
    providerId,
    interval,
    indicatorId: '',
    listing: null,
    serviceId: '',
    credentialId: '',
    accountId: '',
    condition: DEFAULT_PORTFOLIO_FIRE_CONDITION,
    fireMode: 'edge',
    cooldownSeconds: 300,
    pollIntervalSeconds: 60,
    secretValues: {},
    providerParamValues: {},
    indicatorInputs: {},
    existingEncryptedSecretFieldIds: [],
    isActive: false,
  }
}

export { toTrimmed }
