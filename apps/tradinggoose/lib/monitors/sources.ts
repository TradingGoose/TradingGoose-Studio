import { MARKET_ASSET_CLASSES } from '@/providers/market/types'

export const INDICATOR_MONITOR_PROVIDER = 'indicator' as const
export const PORTFOLIO_MONITOR_PROVIDER = 'portfolio' as const

export const INDICATOR_MONITOR_TRIGGER_ID = 'indicator_trigger' as const
export const PORTFOLIO_MONITOR_TRIGGER_ID = 'portfolio_state_trigger' as const

export const MONITOR_SOURCES = [
  {
    provider: INDICATOR_MONITOR_PROVIDER,
    triggerId: INDICATOR_MONITOR_TRIGGER_ID,
  },
  {
    provider: PORTFOLIO_MONITOR_PROVIDER,
    triggerId: PORTFOLIO_MONITOR_TRIGGER_ID,
  },
] as const

export const MONITOR_WEBHOOK_PROVIDERS = MONITOR_SOURCES.map((source) => source.provider)
export const MONITOR_TRIGGER_IDS = MONITOR_SOURCES.map((source) => source.triggerId)
export const MONITOR_ASSET_TYPES = [...MARKET_ASSET_CLASSES, 'portfolio', 'unknown'] as const

export type MonitorWebhookProvider = (typeof MONITOR_WEBHOOK_PROVIDERS)[number]
export type MonitorTriggerId = (typeof MONITOR_TRIGGER_IDS)[number]
export type MonitorAssetType = (typeof MONITOR_ASSET_TYPES)[number]
export type MonitorSourceDefinition = (typeof MONITOR_SOURCES)[number]

export const MONITOR_ASSET_TYPE_LABELS: Record<MonitorAssetType, string> = {
  stock: 'Stock',
  etf: 'ETF',
  indice: 'Index',
  mutualfund: 'Mutual Fund',
  future: 'Future',
  crypto: 'Crypto',
  currency: 'Currency',
  portfolio: 'Portfolio',
  unknown: 'Unknown',
}
export type MonitorProviderConfigEnvelope = {
  triggerId: MonitorTriggerId
  version: 1
  monitor: Record<string, unknown>
  runtimeState?: unknown
}

const MONITOR_PROVIDER_SET = new Set<string>(MONITOR_WEBHOOK_PROVIDERS)
const MONITOR_TRIGGER_ID_SET = new Set<string>(MONITOR_TRIGGER_IDS)
const MONITOR_SOURCE_BY_PROVIDER = new Map(
  MONITOR_SOURCES.map((source) => [source.provider, source])
)
const MONITOR_SOURCE_BY_TRIGGER = new Map(
  MONITOR_SOURCES.map((source) => [source.triggerId, source])
)
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

export const isMonitorProvider = (provider: unknown): provider is MonitorWebhookProvider =>
  typeof provider === 'string' && MONITOR_PROVIDER_SET.has(provider)

export const isMonitorTriggerId = (triggerId: unknown): triggerId is MonitorTriggerId =>
  typeof triggerId === 'string' && MONITOR_TRIGGER_ID_SET.has(triggerId)

export const isMonitorProviderConfigForProvider = (
  providerConfig: unknown,
  provider: MonitorWebhookProvider
): providerConfig is MonitorProviderConfigEnvelope =>
  isRecord(providerConfig) &&
  providerConfig.triggerId === getMonitorTriggerIdForProvider(provider) &&
  providerConfig.version === 1 &&
  isRecord(providerConfig.monitor)

export const getMonitorSourceByProvider = (
  provider: MonitorWebhookProvider
): MonitorSourceDefinition => MONITOR_SOURCE_BY_PROVIDER.get(provider)!

export const getMonitorSourceByTriggerId = (triggerId: MonitorTriggerId): MonitorSourceDefinition =>
  MONITOR_SOURCE_BY_TRIGGER.get(triggerId)!

export const getMonitorProviderForTriggerId = (
  triggerId: MonitorTriggerId
): MonitorWebhookProvider => getMonitorSourceByTriggerId(triggerId).provider

export const getMonitorTriggerIdForProvider = (
  provider: MonitorWebhookProvider
): MonitorTriggerId => getMonitorSourceByProvider(provider).triggerId
