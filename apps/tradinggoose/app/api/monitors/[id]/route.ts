import { isDeepStrictEqual } from 'node:util'
import { db, webhook } from '@tradinggoose/db'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type IndicatorMonitorProviderConfig,
  IndicatorMonitorUpdateSchema,
  normalizeIndicatorMonitorConfig,
} from '@/lib/indicators/monitor-config'
import { createLogger } from '@/lib/logs/console/logger'
import {
  normalizePortfolioMonitorConfig,
  type PortfolioMonitorProviderConfig,
  PortfolioMonitorUpdateSchema,
} from '@/lib/monitors/portfolio-config'
import {
  getMonitorTriggerIdForProvider,
  MONITOR_WEBHOOK_PROVIDERS,
  type MonitorWebhookProvider,
  PORTFOLIO_MONITOR_PROVIDER,
} from '@/lib/monitors/sources'
import { generateRequestId } from '@/lib/utils'
import { authenticateIndicatorRequest, checkWorkspacePermission } from '@/app/api/indicators/utils'
import { notifyMonitorsReconcile } from '@/app/api/monitors/reconcile'
import { getTradingProviderOAuthServiceId } from '@/providers/trading/providers'
import type { TradingProviderId } from '@/providers/trading/types'
import {
  ensureMonitorTriggerBlockInDeployedState,
  ensureTriggerCapableIndicator,
  ensureWorkflowInWorkspace,
  getMonitorRowById,
  isMonitorClientError,
  loadIndicatorInputMetadata,
  MonitorRequestError,
  resolvePortfolioMonitorAccount,
  toMonitorRecord,
} from '../shared'

const logger = createLogger('MonitorByIdAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type IndicatorUpdatePayload = ReturnType<typeof IndicatorMonitorUpdateSchema.parse>
type PortfolioUpdatePayload = ReturnType<typeof PortfolioMonitorUpdateSchema.parse>
type MonitorUpdatePayload = IndicatorUpdatePayload | PortfolioUpdatePayload

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

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()

  try {
    const auth = await authenticateIndicatorRequest({
      request,
      requestId,
      logger,
      action: 'monitor read',
      responseShape: 'errorOnly',
    })
    if ('response' in auth) return auth.response

    const { id } = await params
    const row = await getMonitorRowById(id)
    if (!row) {
      return NextResponse.json({ error: 'Monitor not found' }, { status: 404 })
    }

    if (!row.workflow.workspaceId) {
      return NextResponse.json({ error: 'Monitor workspace is missing' }, { status: 400 })
    }

    const permission = await checkWorkspacePermission({
      userId: auth.userId,
      workspaceId: row.workflow.workspaceId,
      responseShape: 'errorOnly',
    })
    if (!permission.ok) return permission.response

    return NextResponse.json({ data: await toMonitorRecord(row.webhook) }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Failed to load monitor`, { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()

  try {
    const auth = await authenticateIndicatorRequest({
      request,
      requestId,
      logger,
      action: 'monitor update',
      responseShape: 'errorOnly',
    })
    if ('response' in auth) return auth.response

    const { id } = await params
    const row = await getMonitorRowById(id)
    if (!row) {
      return NextResponse.json({ error: 'Monitor not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const source = row.webhook.provider as MonitorWebhookProvider
    const payload = parseUpdatePayload(source, body)
    const workspaceId = row.workflow.workspaceId
    if (!workspaceId) {
      return NextResponse.json({ error: 'Monitor workspace is missing' }, { status: 400 })
    }
    if (payload.workspaceId !== workspaceId) {
      return NextResponse.json(
        { error: 'workspaceId does not match monitor workspace' },
        { status: 400 }
      )
    }

    const permission = await checkWorkspacePermission({
      userId: auth.userId,
      workspaceId,
      requireWrite: true,
      responseShape: 'errorOnly',
    })
    if (!permission.ok) return permission.response

    const existingConfig = row.webhook.providerConfig as
      | IndicatorMonitorProviderConfig
      | PortfolioMonitorProviderConfig
    const existingMonitor = existingConfig.monitor
    if (!existingMonitor) {
      return NextResponse.json({ error: 'Invalid existing monitor config' }, { status: 500 })
    }

    const nextWorkflowId = payload.workflowId ?? row.webhook.workflowId
    const nextTriggerBlockId = payload.blockId ?? existingMonitor.triggerBlockId
    if (!nextTriggerBlockId) {
      return NextResponse.json({ error: 'blockId is required' }, { status: 400 })
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
      payload.isActive === undefined
        ? row.webhook.isActive
        : payload.isActive && workflowRow.isDeployed

    const providerConfig = await buildProviderConfigForUpdate({
      source,
      payload,
      existingConfig,
      nextTriggerBlockId,
      workspaceId,
      userId: auth.userId,
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
          eq(webhook.id, id),
          eq(webhook.provider, source),
          eq(webhook.workflowId, row.workflow.id)
        )
      )
      .returning()

    void notifyMonitorsReconcile({ requestId, logger })

    if (!updatedMonitor) {
      return NextResponse.json({ error: 'Monitor not found' }, { status: 404 })
    }

    return NextResponse.json({ data: await toMonitorRecord(updatedMonitor) }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    logger.error(`[${requestId}] Failed to update monitor`, { error })
    if (error instanceof MonitorRequestError || isMonitorClientError(message)) {
      return NextResponse.json(
        {
          error: message,
        },
        {
          status: error instanceof MonitorRequestError ? error.status : 400,
        }
      )
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = generateRequestId()

  try {
    const auth = await authenticateIndicatorRequest({
      request,
      requestId,
      logger,
      action: 'monitor delete',
      responseShape: 'errorOnly',
    })
    if ('response' in auth) return auth.response

    const { id } = await params
    const row = await getMonitorRowById(id)
    if (!row) {
      return NextResponse.json({ error: 'Monitor not found' }, { status: 404 })
    }

    if (!row.workflow.workspaceId) {
      return NextResponse.json({ error: 'Monitor workspace is missing' }, { status: 400 })
    }

    const workspaceId = row.workflow.workspaceId
    const permission = await checkWorkspacePermission({
      userId: auth.userId,
      workspaceId,
      requireWrite: true,
      responseShape: 'errorOnly',
    })
    if (!permission.ok) return permission.response

    await db
      .delete(webhook)
      .where(and(eq(webhook.id, id), inArray(webhook.provider, [...MONITOR_WEBHOOK_PROVIDERS])))
    void notifyMonitorsReconcile({ requestId, logger })

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Failed to delete monitor`, { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
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
