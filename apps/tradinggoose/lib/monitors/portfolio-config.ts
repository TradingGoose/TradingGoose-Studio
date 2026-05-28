import { z } from 'zod'
import {
  PORTFOLIO_CONDITION_METRICS,
  PORTFOLIO_CONDITION_OPERATORS,
  type PortfolioFireCondition,
} from '@/lib/monitors/portfolio-conditions'
import { PORTFOLIO_MONITOR_PROVIDER, PORTFOLIO_MONITOR_TRIGGER_ID } from '@/lib/monitors/sources'
import type { TradingProviderId } from '@/providers/trading/types'

const nonEmptyString = z.string().trim().min(1)

const PortfolioConditionRuleSchema: z.ZodType<any> = z.object({
  id: z.string().optional(),
  metric: z.enum(PORTFOLIO_CONDITION_METRICS),
  operator: z.enum(PORTFOLIO_CONDITION_OPERATORS),
  value: z.union([z.number().finite(), z.string(), z.boolean(), z.null()]).optional(),
  symbol: z.string().nullable().optional(),
})

const PortfolioConditionNodeSchema: z.ZodType<any> = z.lazy(() =>
  z.union([
    PortfolioConditionRuleSchema,
    z.object({
      id: z.string().optional(),
      combinator: z.enum(['and', 'or']),
      rules: z.array(PortfolioConditionNodeSchema).min(1),
    }),
  ])
)

export const PortfolioFireConditionSchema: z.ZodType<PortfolioFireCondition> = z.object({
  root: z.object({
    id: z.string().optional(),
    combinator: z.enum(['and', 'or']),
    rules: z.array(PortfolioConditionNodeSchema).min(1),
  }),
})

export const PortfolioMonitorCreateSchema = z.object({
  source: z.literal(PORTFOLIO_MONITOR_PROVIDER),
  workspaceId: nonEmptyString,
  workflowId: nonEmptyString,
  blockId: nonEmptyString,
  providerId: nonEmptyString,
  serviceId: nonEmptyString,
  credentialId: nonEmptyString,
  accountId: nonEmptyString,
  condition: PortfolioFireConditionSchema,
  fireMode: z.enum(['edge', 'while_true']).default('edge'),
  cooldownSeconds: z.number().int().min(0).max(86_400).default(300),
  pollIntervalSeconds: z.number().int().min(15).max(3600).default(60),
  isActive: z.boolean().optional(),
})

export const PortfolioMonitorUpdateSchema = z.object({
  source: z.literal(PORTFOLIO_MONITOR_PROVIDER).optional(),
  workspaceId: nonEmptyString,
  workflowId: nonEmptyString.optional(),
  blockId: nonEmptyString.optional(),
  providerId: nonEmptyString.optional(),
  serviceId: nonEmptyString.optional(),
  credentialId: nonEmptyString.optional(),
  accountId: nonEmptyString.optional(),
  condition: PortfolioFireConditionSchema.optional(),
  fireMode: z.enum(['edge', 'while_true']).optional(),
  cooldownSeconds: z.number().int().min(0).max(86_400).optional(),
  pollIntervalSeconds: z.number().int().min(15).max(3600).optional(),
  isActive: z.boolean().optional(),
})

export type PortfolioMonitorProviderConfig = {
  triggerId: typeof PORTFOLIO_MONITOR_TRIGGER_ID
  version: 1
  monitor: {
    triggerBlockId: string
    providerId: TradingProviderId
    serviceId: string
    credentialId: string
    accountId: string
    condition: PortfolioFireCondition
    fireMode: 'edge' | 'while_true'
    cooldownSeconds: number
    pollIntervalSeconds: number
  }
  runtimeState?: {
    lastEvaluatedAt?: string
    lastFiredAt?: string
    wasTrue?: boolean
    previousSnapshot?: unknown
  }
}

export const normalizePortfolioMonitorConfig = (input: {
  triggerBlockId: string
  providerId: string
  serviceId: string
  credentialId: string
  accountId: string
  condition: PortfolioFireCondition
  fireMode?: 'edge' | 'while_true'
  cooldownSeconds?: number
  pollIntervalSeconds?: number
}): PortfolioMonitorProviderConfig => ({
  triggerId: PORTFOLIO_MONITOR_TRIGGER_ID,
  version: 1,
  monitor: {
    triggerBlockId: input.triggerBlockId,
    providerId: input.providerId as TradingProviderId,
    serviceId: input.serviceId,
    credentialId: input.credentialId,
    accountId: input.accountId,
    condition: input.condition,
    fireMode: input.fireMode ?? 'edge',
    cooldownSeconds: input.cooldownSeconds ?? 300,
    pollIntervalSeconds: input.pollIntervalSeconds ?? 60,
  },
})

export const toPublicPortfolioMonitorProviderConfig = (
  config: PortfolioMonitorProviderConfig
): PortfolioMonitorProviderConfig => ({
  triggerId: config.triggerId,
  version: config.version,
  monitor: config.monitor,
})
