export const INDICATOR_MONITOR_PROVIDER = 'indicator' as const
export const PORTFOLIO_MONITOR_PROVIDER = 'portfolio' as const

export const INDICATOR_MONITOR_TRIGGER_ID = 'indicator_trigger' as const
export const PORTFOLIO_MONITOR_TRIGGER_ID = 'portfolio_state_trigger' as const

export const MONITOR_WEBHOOK_PROVIDERS = [
  INDICATOR_MONITOR_PROVIDER,
  PORTFOLIO_MONITOR_PROVIDER,
] as const

export const MONITOR_TRIGGER_IDS = [
  INDICATOR_MONITOR_TRIGGER_ID,
  PORTFOLIO_MONITOR_TRIGGER_ID,
] as const

export type MonitorWebhookProvider = (typeof MONITOR_WEBHOOK_PROVIDERS)[number]
export type MonitorTriggerId = (typeof MONITOR_TRIGGER_IDS)[number]
export type MonitorProviderConfigEnvelope = {
  triggerId: MonitorTriggerId
  version: 1
  monitor: Record<string, unknown>
  runtimeState?: unknown
}

const MONITOR_TRIGGER_BY_PROVIDER: Record<MonitorWebhookProvider, MonitorTriggerId> = {
  [INDICATOR_MONITOR_PROVIDER]: INDICATOR_MONITOR_TRIGGER_ID,
  [PORTFOLIO_MONITOR_PROVIDER]: PORTFOLIO_MONITOR_TRIGGER_ID,
}

const MONITOR_PROVIDER_BY_TRIGGER: Record<MonitorTriggerId, MonitorWebhookProvider> = {
  [INDICATOR_MONITOR_TRIGGER_ID]: INDICATOR_MONITOR_PROVIDER,
  [PORTFOLIO_MONITOR_TRIGGER_ID]: PORTFOLIO_MONITOR_PROVIDER,
}

const MONITOR_PROVIDER_SET = new Set<string>(MONITOR_WEBHOOK_PROVIDERS)
const MONITOR_TRIGGER_ID_SET = new Set<string>(MONITOR_TRIGGER_IDS)
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
  providerConfig.triggerId === MONITOR_TRIGGER_BY_PROVIDER[provider] &&
  providerConfig.version === 1 &&
  isRecord(providerConfig.monitor)

export const getMonitorProviderForTriggerId = (
  triggerId: MonitorTriggerId
): MonitorWebhookProvider => MONITOR_PROVIDER_BY_TRIGGER[triggerId]

export const getMonitorTriggerIdForProvider = (
  provider: MonitorWebhookProvider
): MonitorTriggerId => MONITOR_TRIGGER_BY_PROVIDER[provider]
