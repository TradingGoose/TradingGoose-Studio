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

const MONITOR_PROVIDER_SET = new Set<string>(MONITOR_WEBHOOK_PROVIDERS)
const MONITOR_TRIGGER_ID_SET = new Set<string>(MONITOR_TRIGGER_IDS)

export const isMonitorProvider = (provider: unknown): provider is MonitorWebhookProvider =>
  typeof provider === 'string' && MONITOR_PROVIDER_SET.has(provider)

export const isMonitorTriggerId = (triggerId: unknown): triggerId is MonitorTriggerId =>
  typeof triggerId === 'string' && MONITOR_TRIGGER_ID_SET.has(triggerId)

export const getMonitorProviderForTriggerId = (
  triggerId: MonitorTriggerId
): MonitorWebhookProvider =>
  triggerId === PORTFOLIO_MONITOR_TRIGGER_ID
    ? PORTFOLIO_MONITOR_PROVIDER
    : INDICATOR_MONITOR_PROVIDER

export const getMonitorTriggerIdForProvider = (
  provider: MonitorWebhookProvider
): MonitorTriggerId =>
  provider === PORTFOLIO_MONITOR_PROVIDER
    ? PORTFOLIO_MONITOR_TRIGGER_ID
    : INDICATOR_MONITOR_TRIGGER_ID
