import { isDeepStrictEqual } from 'node:util'
import { db, webhook } from '@tradinggoose/db'
import { and, eq } from 'drizzle-orm'
import {
  type IndicatorMonitorProviderConfig,
  IndicatorMonitorUpdateSchema,
  normalizeIndicatorMonitorConfig,
} from '@/lib/indicators/monitor-config'
import {
  normalizePortfolioMonitorConfig,
  type PortfolioMonitorProviderConfig,
  PortfolioMonitorUpdateSchema,
} from '@/lib/monitors/portfolio-config'
import {
  getMonitorTriggerIdForProvider,
  type MonitorWebhookProvider,
  PORTFOLIO_MONITOR_PROVIDER,
} from '@/lib/monitors/sources'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { getTradingProviderOAuthServiceId } from '@/providers/trading/providers'
import type { TradingProviderId } from '@/providers/trading/types'
import { notifyMonitorsReconcile } from '@/app/api/monitors/reconcile'
import {
  ensureMonitorTriggerBlockInDeployedState,
  ensureTriggerCapableIndicator,
  ensureWorkflowInWorkspace,
  getMonitorRowById,
  loadIndicatorInputMetadata,
  MonitorRequestError,
  resolvePortfolioMonitorAccount,
  toMonitorRecord,
} from './shared'

type IndicatorUpdatePayload = ReturnType<typeof IndicatorMonitorUpdateSchema.parse>
type PortfolioUpdatePayload = ReturnType<typeof PortfolioMonitorUpdateSchema.parse>
type MonitorUpdatePayload = IndicatorUpdatePayload | PortfolioUpdatePayload
type MonitorUpdateLogger = {
  warn: (message: string, ...args: unknown[]) => void
}

const parseUpdatePayload = (
  source: MonitorWebhookProvider,
  body: unknown
): MonitorUpdatePayload => {
  const parsed =
    source === PORTFOLIO_MONITOR_PROVIDER
      ? PortfolioMonitorUpdateSchema.safeParse(body)
      : IndicatorMonitorUpdateSchema.safeParse(body)

  if (!parsed.success) {
    throw new MonitorRequestError(parsed.error.errors[0]?.message ?? 'Invalid request')
  }

  return parsed.data
}

export async function updateMonitorForUser({
  monitorId,
  userId,
  body,
  requestId,
  logger,
}: {
  monitorId: string
  userId: string
  body: unknown
  requestId: string
  logger: MonitorUpdateLogger
}) {
  const row = await getMonitorRowById(monitorId)
  if (!row) {
    throw new MonitorRequestError('Monitor not found', 404)
  }

  const source = row.webhook.provider as MonitorWebhookProvider
  const payload = parseUpdatePayload(source, body)
  const workspaceId = row.workflow.workspaceId
  if (!workspaceId) {
    throw new MonitorRequestError('Monitor workspace is missing', 400)
  }
  if (payload.workspaceId !== workspaceId) {
    throw new MonitorRequestError('workspaceId does not match monitor workspace', 400)
  }

  const access = await checkWorkspaceAccess(workspaceId, userId)
  if (!access.exists || !access.hasAccess) {
    throw new MonitorRequestError('Access denied', 403)
  }
  if (!access.canWrite) {
    throw new MonitorRequestError('Write permission required', 403)
  }

  const existingConfig = row.webhook.providerConfig as
    | IndicatorMonitorProviderConfig
    | PortfolioMonitorProviderConfig
  const existingMonitor = existingConfig.monitor
  if (!existingMonitor) {
    throw new Error('Invalid existing monitor config')
  }

  const nextWorkflowId = payload.workflowId ?? row.webhook.workflowId
  const nextTriggerBlockId = payload.blockId ?? existingMonitor.triggerBlockId
  if (!nextTriggerBlockId) {
    throw new MonitorRequestError('blockId is required', 400)
  }

  const workflowRow = await ensureWorkflowInWorkspace(nextWorkflowId, workspaceId)
  if (
    payload.blockId !== undefined ||
    payload.workflowId !== undefined ||
    payload.isActive === true
  ) {
    await ensureMonitorTriggerBlockInDeployedState(
      nextWorkflowId,
      nextTriggerBlockId,
      getMonitorTriggerIdForProvider(source)
    )
  }
  const nextIsActive =
    payload.isActive === undefined ? row.webhook.isActive : payload.isActive && workflowRow.isDeployed

  const providerConfig = await buildProviderConfigForUpdate({
    source,
    payload,
    existingConfig,
    nextTriggerBlockId,
    workspaceId,
    userId,
    requestId,
    requireCompleteAuth: nextIsActive,
  })

  const [updatedMonitor] = await db
    .update(webhook)
    .set({
      workflowId: nextWorkflowId,
      blockId: null,
      providerConfig,
      isActive: nextIsActive,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(webhook.id, monitorId),
        eq(webhook.provider, source),
        eq(webhook.workflowId, row.workflow.id)
      )
    )
    .returning()

  void notifyMonitorsReconcile({ requestId, logger })

  if (!updatedMonitor) {
    throw new MonitorRequestError('Monitor not found', 404)
  }

  return toMonitorRecord(updatedMonitor)
}

async function buildProviderConfigForUpdate({
  source,
  payload,
  existingConfig,
  nextTriggerBlockId,
  workspaceId,
  userId,
  requestId,
  requireCompleteAuth,
}: {
  source: MonitorWebhookProvider
  payload: MonitorUpdatePayload
  existingConfig: IndicatorMonitorProviderConfig | PortfolioMonitorProviderConfig
  nextTriggerBlockId: string
  workspaceId: string
  userId: string
  requestId: string
  requireCompleteAuth: boolean
}) {
  if (source === PORTFOLIO_MONITOR_PROVIDER) {
    const portfolioPayload = payload as PortfolioUpdatePayload
    const portfolioConfig = existingConfig as PortfolioMonitorProviderConfig
    const existingMonitor = portfolioConfig.monitor
    const nextProviderId = portfolioPayload.providerId ?? existingMonitor.providerId
    const nextCredentialId = portfolioPayload.credentialId ?? existingMonitor.credentialId
    const nextAccountId = portfolioPayload.accountId ?? existingMonitor.accountId
    const requestedServiceId = portfolioPayload.serviceId ?? existingMonitor.serviceId
    const requestedOAuthServiceId = getTradingProviderOAuthServiceId(
      nextProviderId as TradingProviderId,
      requestedServiceId
    )
    if (!requestedOAuthServiceId) {
      throw new MonitorRequestError('Trading provider connection is required')
    }
    const connectionChanged =
      nextProviderId !== existingMonitor.providerId ||
      requestedOAuthServiceId !== existingMonitor.serviceId ||
      nextCredentialId !== existingMonitor.credentialId ||
      nextAccountId !== existingMonitor.accountId
    const connection =
      requireCompleteAuth || connectionChanged
        ? await resolvePortfolioMonitorAccount({
            userId,
            providerId: nextProviderId,
            serviceId: requestedOAuthServiceId,
            credentialId: nextCredentialId,
            accountId: nextAccountId,
            requestId,
          })
        : {
            serviceId: existingMonitor.serviceId,
            connectionOwnerUserId: existingMonitor.connectionOwnerUserId,
          }

    const providerConfig = normalizePortfolioMonitorConfig({
      triggerBlockId: nextTriggerBlockId,
      providerId: nextProviderId,
      serviceId: connection.serviceId,
      credentialId: nextCredentialId,
      connectionOwnerUserId: connection.connectionOwnerUserId,
      accountId: nextAccountId,
      condition: portfolioPayload.condition ?? existingMonitor.condition,
      fireMode: portfolioPayload.fireMode ?? existingMonitor.fireMode,
      cooldownSeconds: portfolioPayload.cooldownSeconds ?? existingMonitor.cooldownSeconds,
      pollIntervalSeconds:
        portfolioPayload.pollIntervalSeconds ?? existingMonitor.pollIntervalSeconds,
    })
    const shouldPreserveRuntimeState = isDeepStrictEqual(
      providerConfig.monitor,
      portfolioConfig.monitor
    )
    if (shouldPreserveRuntimeState && portfolioConfig.runtimeState !== undefined) {
      providerConfig.runtimeState = portfolioConfig.runtimeState
    }
    return providerConfig
  }

  const indicatorPayload = payload as IndicatorUpdatePayload
  const existingMonitor = (existingConfig as IndicatorMonitorProviderConfig).monitor
  const nextProviderId = indicatorPayload.providerId ?? existingMonitor.providerId
  const providerChanged = nextProviderId !== existingMonitor.providerId
  const nextIndicatorId = indicatorPayload.indicatorId ?? existingMonitor.indicatorId
  const indicatorChanged = nextIndicatorId !== existingMonitor.indicatorId
  const authProvided = Object.hasOwn(indicatorPayload, 'auth')
  const providerParamsProvided = Object.hasOwn(indicatorPayload, 'providerParams')
  const indicatorInputsProvided = Object.hasOwn(indicatorPayload, 'indicatorInputs')
  const shouldNormalizeIndicatorInputs = indicatorInputsProvided || indicatorChanged

  await ensureTriggerCapableIndicator(workspaceId, nextIndicatorId)
  const indicatorMetadata = shouldNormalizeIndicatorInputs
    ? await loadIndicatorInputMetadata(workspaceId, nextIndicatorId)
    : null
  const nextProviderParams = providerChanged
    ? providerParamsProvided
      ? (indicatorPayload.providerParams ?? {})
      : undefined
    : providerParamsProvided
      ? (indicatorPayload.providerParams ?? {})
      : existingMonitor.providerParams
  const nextIndicatorInputs = shouldNormalizeIndicatorInputs
    ? indicatorInputsProvided
      ? (indicatorPayload.indicatorInputs ?? {})
      : {}
    : undefined

  const providerConfig = await normalizeIndicatorMonitorConfig({
    triggerBlockId: nextTriggerBlockId,
    providerId: nextProviderId,
    interval: indicatorPayload.interval ?? existingMonitor.interval,
    listingInput: indicatorPayload.listing ?? existingMonitor.listing,
    indicatorId: nextIndicatorId,
    authInput: authProvided ? indicatorPayload.auth : undefined,
    providerParams: nextProviderParams,
    indicatorInputs: nextIndicatorInputs,
    indicatorInputMeta: indicatorMetadata?.inputMeta,
    previousAuth: providerChanged ? undefined : existingMonitor.auth,
    requireCompleteAuth,
  })
  if (!shouldNormalizeIndicatorInputs && typeof existingMonitor.indicatorInputs !== 'undefined') {
    providerConfig.monitor.indicatorInputs = existingMonitor.indicatorInputs
  }
  return providerConfig
}
