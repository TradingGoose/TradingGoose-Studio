import { z } from 'zod'
import { ListingIdentitySchema } from '@/lib/listing/identity'
import {
  isPortfolioConditionOperatorCompatible,
  isPortfolioConditionValuelessOperator,
  PORTFOLIO_CONDITION_METRICS,
  PORTFOLIO_CONDITION_OPERATORS,
  type PortfolioFireCondition,
  portfolioConditionRequiresListing,
} from '@/lib/monitors/portfolio-conditions'
import { PORTFOLIO_MONITOR_PROVIDER, PORTFOLIO_MONITOR_TRIGGER_ID } from '@/lib/monitors/sources'
import type { TradingProviderId } from '@/providers/trading/types'

const nonEmptyString = z.string().trim().min(1)
const tradingProviderId = nonEmptyString.transform((value) => value as TradingProviderId)

const PortfolioConditionRuleSchema: z.ZodType<any> = z
  .object({
    id: z.string().optional(),
    metric: z.enum(PORTFOLIO_CONDITION_METRICS),
    operator: z.enum(PORTFOLIO_CONDITION_OPERATORS),
    value: z.union([z.number().finite(), z.string(), z.boolean(), z.null()]).optional(),
    listing: ListingIdentitySchema.nullish(),
  })
  .refine(
    (rule) =>
      isPortfolioConditionOperatorCompatible(rule.metric, rule.operator) &&
      (portfolioConditionRequiresListing(rule.metric)
        ? rule.listing != null
        : rule.listing == null),
    { message: 'Invalid portfolio condition rule' }
  )
  .transform((rule) => ({
    id: rule.id,
    metric: rule.metric,
    operator: rule.operator,
    value: isPortfolioConditionValuelessOperator(rule.operator) ? null : rule.value,
    listing: portfolioConditionRequiresListing(rule.metric) ? rule.listing : null,
  }))

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

export const PortfolioMonitorProviderConfigSchema = z
  .object({
    triggerId: z.literal(PORTFOLIO_MONITOR_TRIGGER_ID),
    version: z.literal(1),
    monitor: z
      .object({
        triggerBlockId: nonEmptyString,
        providerId: tradingProviderId,
        serviceId: nonEmptyString,
        credentialId: nonEmptyString,
        connectionOwnerUserId: nonEmptyString,
        accountId: nonEmptyString,
        condition: PortfolioFireConditionSchema,
        fireMode: z.enum(['edge', 'while_true']),
        cooldownSeconds: z.number().int().min(0).max(86_400),
        pollIntervalSeconds: z.number().int().min(15).max(3600),
      })
      .strict(),
    runtimeState: z
      .object({
        lastFiredAt: z.string().optional(),
        wasTrue: z.boolean().optional(),
      })
      .strip()
      .optional()
      .catch(undefined),
  })
  .strict()

export type PortfolioMonitorProviderConfig = z.infer<typeof PortfolioMonitorProviderConfigSchema>

export const normalizePortfolioMonitorConfig = (input: {
  triggerBlockId: string
  providerId: string
  serviceId: string
  credentialId: string
  connectionOwnerUserId: string
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
    connectionOwnerUserId: input.connectionOwnerUserId,
    accountId: input.accountId,
    condition: input.condition,
    fireMode: input.fireMode ?? 'edge',
    cooldownSeconds: input.cooldownSeconds ?? 300,
    pollIntervalSeconds: input.pollIntervalSeconds ?? 60,
  },
})

export const toPublicPortfolioMonitorProviderConfig = (config: PortfolioMonitorProviderConfig) => {
  const { connectionOwnerUserId: _connectionOwnerUserId, ...monitor } = config.monitor
  return {
    triggerId: config.triggerId,
    version: config.version,
    monitor,
  }
}
