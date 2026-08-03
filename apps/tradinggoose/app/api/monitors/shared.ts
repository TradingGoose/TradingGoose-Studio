import { db } from '@tradinggoose/db'
import {
  pineIndicators,
  webhook,
  workflow,
  workflowDeploymentVersion,
} from '@tradinggoose/db/schema'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { DEFAULT_INDICATOR_RUNTIME_MAP } from '@/lib/indicators/default/runtime'
import { inferInputMetaFromPineCode } from '@/lib/indicators/input-meta'
import {
  type IndicatorMonitorProviderConfig,
  toPublicIndicatorMonitorProviderConfig,
} from '@/lib/indicators/monitor-config'
import { isIndicatorTriggerCapable } from '@/lib/indicators/trigger-detection'
import type { InputMetaMap } from '@/lib/indicators/types'
import { ListingIdentitySchema } from '@/lib/listing/identity'
import {
  type PortfolioMonitorProviderConfig,
  PortfolioMonitorProviderConfigSchema,
  toPublicPortfolioMonitorProviderConfig,
} from '@/lib/monitors/portfolio-config'
import {
  getMonitorTriggerIdForProvider,
  INDICATOR_MONITOR_PROVIDER,
  isMonitorProvider,
  isMonitorProviderConfigForProvider,
  MONITOR_WEBHOOK_PROVIDERS,
  type MonitorTriggerId,
  type MonitorWebhookProvider,
} from '@/lib/monitors/sources'
import {
  authorizeTradingConnectionRequest,
  resolveTradingProviderContext,
  resolveTradingProviderSelectedAccount,
} from '@/lib/trading/context'
import { isTradingServiceError } from '@/lib/trading/errors'

type WebhookRow = typeof webhook.$inferSelect

export class MonitorRequestError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'MonitorRequestError'
    this.status = status
  }
}

const MONITOR_CLIENT_ERROR_PATTERNS = [
  'Missing',
  'Invalid',
  'not found',
  'must be',
  'does not',
  'Unable to',
  'no active deployment',
]

export const isMonitorClientError = (message: string) =>
  MONITOR_CLIENT_ERROR_PATTERNS.some((pattern) =>
    message.toLowerCase().includes(pattern.toLowerCase())
  )

export const listMonitorRows = async ({
  workspaceId,
  workflowId,
  blockId,
  source,
}: {
  workspaceId: string
  workflowId?: string
  blockId?: string
  source?: MonitorWebhookProvider
}) => {
  const conditions = [
    eq(workflow.workspaceId, workspaceId),
    source
      ? eq(webhook.provider, source)
      : inArray(webhook.provider, [...MONITOR_WEBHOOK_PROVIDERS]),
  ]

  if (workflowId) {
    conditions.push(eq(webhook.workflowId, workflowId))
  }

  if (blockId) {
    conditions.push(sql`${webhook.providerConfig}->'monitor'->>'triggerBlockId' = ${blockId}`)
  }

  const rows = await db
    .select({
      webhook: webhook,
      workflow: {
        id: workflow.id,
        workspaceId: workflow.workspaceId,
      },
    })
    .from(webhook)
    .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
    .where(and(...conditions))
    .orderBy(desc(webhook.updatedAt))
  return rows
}

export const getMonitorRowById = async (id: string) => {
  const rows = await db
    .select({
      webhook: webhook,
      workflow: {
        id: workflow.id,
        workspaceId: workflow.workspaceId,
      },
    })
    .from(webhook)
    .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
    .where(and(eq(webhook.id, id), inArray(webhook.provider, [...MONITOR_WEBHOOK_PROVIDERS])))
    .limit(1)

  return rows[0] ?? null
}

const toTrimmedString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const getActiveDeployedState = async (workflowId: string) => {
  const rows = await db
    .select({ state: workflowDeploymentVersion.state })
    .from(workflowDeploymentVersion)
    .where(
      and(
        eq(workflowDeploymentVersion.workflowId, workflowId),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
    .limit(1)
  return rows[0]?.state as Record<string, unknown> | undefined
}

const getDeployedMonitorTriggerBlockIds = (
  deployedState: Record<string, unknown> | undefined,
  triggerId: MonitorTriggerId
) => {
  const blocks =
    deployedState && typeof deployedState === 'object'
      ? ((deployedState.blocks as Record<string, unknown> | undefined) ?? undefined)
      : undefined
  if (!blocks || typeof blocks !== 'object') return new Set<string>()

  const ids = Object.entries(blocks)
    .map(([blockId, blockData]) => {
      const block = blockData as { id?: unknown; type?: unknown } | undefined
      if (block?.type !== triggerId) return null
      return toTrimmedString(block?.id) ?? toTrimmedString(blockId)
    })
    .filter((value): value is string => Boolean(value))

  return new Set(ids)
}

export const ensureMonitorTriggerBlockInDeployedState = async (
  workflowId: string,
  blockId: string,
  triggerId: MonitorTriggerId
) => {
  const deployedState = await getActiveDeployedState(workflowId)
  if (!deployedState) {
    throw new Error('Target workflow has no active deployment.')
  }

  const triggerBlockIds = getDeployedMonitorTriggerBlockIds(deployedState, triggerId)
  if (!triggerBlockIds.has(blockId)) {
    throw new Error(`Target block must be a ${triggerId} block in the active deployment.`)
  }
}

export const ensureWorkflowInWorkspace = async (workflowId: string, workspaceId: string) => {
  const rows = await db
    .select({
      id: workflow.id,
      workspaceId: workflow.workspaceId,
      isDeployed: workflow.isDeployed,
    })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)

  const workflowRow = rows[0]
  if (!workflowRow) {
    throw new Error('Target workflow not found.')
  }
  if (workflowRow.workspaceId !== workspaceId) {
    throw new Error('Workflow does not belong to the provided workspace.')
  }

  return workflowRow
}

export const resolvePortfolioMonitorAccount = async ({
  userId,
  providerId,
  serviceId,
  credentialId,
  accountId,
  requestId,
}: {
  userId: string
  providerId: string
  serviceId?: string | null
  credentialId: string
  accountId: string
  requestId: string
}) => {
  const requestedServiceId = serviceId?.trim()
  if (!requestedServiceId) {
    throw new MonitorRequestError('Trading provider connection is required')
  }

  try {
    const connection = await authorizeTradingConnectionRequest({
      credentialId,
      userId,
    })
    const baseContext = await resolveTradingProviderContext({
      requestData: {
        provider: providerId,
        credentialId,
        serviceId: requestedServiceId,
      },
      requestId,
      userId,
      connectionOwnerUserId: connection.connectionOwnerUserId,
      tokenAccountId: connection.tokenAccountId,
      accountProviderId: connection.accountProviderId,
    })
    await resolveTradingProviderSelectedAccount({
      baseContext,
      accountId,
    })
    return {
      serviceId: baseContext.serviceId,
      connectionOwnerUserId: connection.connectionOwnerUserId,
    }
  } catch (error) {
    if (isTradingServiceError(error)) {
      throw new MonitorRequestError(error.message, error.status)
    }
    throw error
  }
}

export const ensureTriggerCapableIndicator = async (workspaceId: string, indicatorId: string) => {
  const defaultIndicator = DEFAULT_INDICATOR_RUNTIME_MAP.get(indicatorId)
  if (defaultIndicator) {
    if (!isIndicatorTriggerCapable(defaultIndicator.pineCode)) {
      throw new Error(`Indicator ${indicatorId} does not use trigger(...).`)
    }
    return
  }

  const customRows = await db
    .select({
      id: pineIndicators.id,
      workspaceId: pineIndicators.workspaceId,
      pineCode: pineIndicators.pineCode,
    })
    .from(pineIndicators)
    .where(and(eq(pineIndicators.id, indicatorId), eq(pineIndicators.workspaceId, workspaceId)))
    .limit(1)

  const customIndicator = customRows[0]
  if (!customIndicator) {
    throw new Error(`Indicator ${indicatorId} not found.`)
  }
  if (!isIndicatorTriggerCapable(customIndicator.pineCode)) {
    throw new Error(`Indicator ${indicatorId} does not use trigger(...).`)
  }
}

export const loadIndicatorInputMetadata = async (
  workspaceId: string,
  indicatorId: string
): Promise<{ id: string; inputMeta?: InputMetaMap }> => {
  const defaultIndicator = DEFAULT_INDICATOR_RUNTIME_MAP.get(indicatorId)
  if (defaultIndicator) {
    return {
      id: indicatorId,
      ...(defaultIndicator.inputMeta && Object.keys(defaultIndicator.inputMeta).length > 0
        ? { inputMeta: defaultIndicator.inputMeta }
        : {}),
    }
  }

  const rows = await db
    .select({
      id: pineIndicators.id,
      workspaceId: pineIndicators.workspaceId,
      pineCode: pineIndicators.pineCode,
    })
    .from(pineIndicators)
    .where(and(eq(pineIndicators.id, indicatorId), eq(pineIndicators.workspaceId, workspaceId)))
    .limit(1)

  const row = rows[0]
  if (!row) {
    throw new Error(`Indicator ${indicatorId} not found.`)
  }

  const inputMeta = inferInputMetaFromPineCode(row.pineCode)
  return {
    id: row.id,
    ...(inputMeta && Object.keys(inputMeta).length > 0 ? { inputMeta } : {}),
  }
}

const parseIndicatorProviderConfig = (
  providerConfig: WebhookRow['providerConfig']
): IndicatorMonitorProviderConfig => {
  if (!isMonitorProviderConfigForProvider(providerConfig, INDICATOR_MONITOR_PROVIDER)) {
    throw new Error('Invalid monitor provider config.')
  }
  const listing = ListingIdentitySchema.parse(providerConfig.monitor.listing)
  return {
    ...providerConfig,
    monitor: { ...providerConfig.monitor, listing },
  } as IndicatorMonitorProviderConfig
}

const parsePortfolioProviderConfig = (
  providerConfig: WebhookRow['providerConfig']
): PortfolioMonitorProviderConfig => {
  return PortfolioMonitorProviderConfigSchema.parse(providerConfig)
}

const getTriggerBlockIdFromMonitorConfig = (
  providerConfig: WebhookRow['providerConfig'],
  provider: MonitorWebhookProvider
) => {
  if (!isMonitorProviderConfigForProvider(providerConfig, provider)) return null
  return toTrimmedString(providerConfig.monitor.triggerBlockId)
}

const toIndicatorProviderRecord = (webhookRow: WebhookRow) => {
  const providerConfig = parseIndicatorProviderConfig(webhookRow.providerConfig)
  const publicProviderConfig = toPublicIndicatorMonitorProviderConfig(providerConfig)

  return {
    monitorId: webhookRow.id,
    source: INDICATOR_MONITOR_PROVIDER,
    workflowId: webhookRow.workflowId,
    blockId: providerConfig.monitor.triggerBlockId,
    isActive: webhookRow.isActive,
    providerConfig: publicProviderConfig,
    createdAt: webhookRow.createdAt.toISOString(),
    updatedAt: webhookRow.updatedAt.toISOString(),
  }
}

export const toMonitorRecord = (webhookRow: WebhookRow) => {
  if (!isMonitorProvider(webhookRow.provider)) {
    throw new Error('Unsupported monitor provider.')
  }

  if (webhookRow.provider === INDICATOR_MONITOR_PROVIDER) {
    return toIndicatorProviderRecord(webhookRow)
  }

  const providerConfig = parsePortfolioProviderConfig(webhookRow.providerConfig)
  const publicProviderConfig = toPublicPortfolioMonitorProviderConfig(providerConfig)

  return {
    monitorId: webhookRow.id,
    source: webhookRow.provider,
    workflowId: webhookRow.workflowId,
    blockId: providerConfig.monitor.triggerBlockId,
    isActive: webhookRow.isActive,
    providerConfig: publicProviderConfig,
    createdAt: webhookRow.createdAt.toISOString(),
    updatedAt: webhookRow.updatedAt.toISOString(),
  }
}

export const pauseMonitorsMissingDeployedTrigger = async (workflowId: string) => {
  const deployedState = await getActiveDeployedState(workflowId)
  const deployedTriggerBlockIdsByProvider = Object.fromEntries(
    MONITOR_WEBHOOK_PROVIDERS.map((provider) => [
      provider,
      getDeployedMonitorTriggerBlockIds(deployedState, getMonitorTriggerIdForProvider(provider)),
    ])
  ) as Record<MonitorWebhookProvider, Set<string>>
  const rows = await db
    .select({
      id: webhook.id,
      provider: webhook.provider,
      isActive: webhook.isActive,
      providerConfig: webhook.providerConfig,
    })
    .from(webhook)
    .where(
      and(
        eq(webhook.workflowId, workflowId),
        inArray(webhook.provider, [...MONITOR_WEBHOOK_PROVIDERS])
      )
    )

  const now = new Date()
  for (const row of rows) {
    if (!isMonitorProvider(row.provider)) continue
    const triggerBlockId = getTriggerBlockIdFromMonitorConfig(row.providerConfig, row.provider)
    if (!triggerBlockId) continue
    if (deployedTriggerBlockIdsByProvider[row.provider].has(triggerBlockId)) continue
    if (!row.isActive) continue

    await db
      .update(webhook)
      .set({
        isActive: false,
        updatedAt: now,
      })
      .where(eq(webhook.id, row.id))
  }
}
