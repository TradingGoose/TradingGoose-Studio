import { db, webhook } from '@tradinggoose/db'
import { nanoid } from 'nanoid'
import { type NextRequest, NextResponse } from 'next/server'
import {
  IndicatorMonitorCreateSchema,
  normalizeIndicatorMonitorConfig,
} from '@/lib/indicators/monitor-config'
import { createLogger } from '@/lib/logs/console/logger'
import {
  normalizePortfolioMonitorConfig,
  PortfolioMonitorCreateSchema,
} from '@/lib/monitors/portfolio-config'
import {
  getMonitorTriggerIdForProvider,
  isMonitorProvider,
  type MonitorWebhookProvider,
  PORTFOLIO_MONITOR_PROVIDER,
} from '@/lib/monitors/sources'
import { generateRequestId } from '@/lib/utils'
import { authenticateIndicatorRequest, checkWorkspacePermission } from '@/app/api/indicators/utils'
import { notifyMonitorsReconcile } from '@/app/api/monitors/reconcile'
import {
  ensureMonitorTriggerBlockInDeployedState,
  ensureTriggerCapableIndicator,
  ensureWorkflowInWorkspace,
  isMonitorClientError,
  listMonitorRows,
  loadIndicatorInputMetadata,
  MonitorRequestError,
  resolvePortfolioMonitorAccount,
  toMonitorRecord,
} from './shared'

const logger = createLogger('MonitorsAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type IndicatorCreatePayload = ReturnType<typeof IndicatorMonitorCreateSchema.parse>
type PortfolioCreatePayload = ReturnType<typeof PortfolioMonitorCreateSchema.parse>
type MonitorCreatePayload = IndicatorCreatePayload | PortfolioCreatePayload

const parseCreatePayload = (
  source: MonitorWebhookProvider,
  body: unknown
): MonitorCreatePayload => {
  const parsed =
    source === PORTFOLIO_MONITOR_PROVIDER
      ? PortfolioMonitorCreateSchema.safeParse(body)
      : IndicatorMonitorCreateSchema.safeParse(body)

  if (!parsed.success) {
    throw new MonitorRequestError(parsed.error.issues[0]?.message ?? 'Invalid request')
  }

  return parsed.data
}

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const auth = await authenticateIndicatorRequest({
      request,
      requestId,
      logger,
      action: 'monitor list',
      responseShape: 'errorOnly',
    })
    if ('response' in auth) return auth.response

    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get('workspaceId')?.trim()
    const workflowId = searchParams.get('workflowId')?.trim() || undefined
    const blockId = searchParams.get('blockId')?.trim() || undefined
    const source = searchParams.get('source')?.trim() || undefined

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    const permission = await checkWorkspacePermission({
      userId: auth.userId,
      workspaceId,
      responseShape: 'errorOnly',
    })
    if (!permission.ok) return permission.response

    if (source && !isMonitorProvider(source)) {
      return NextResponse.json({ error: 'Invalid monitor source' }, { status: 400 })
    }

    const rows = await listMonitorRows({
      workspaceId,
      workflowId,
      blockId,
      source: source as MonitorWebhookProvider | undefined,
    })
    return NextResponse.json(
      {
        data: await Promise.all(rows.map((row) => toMonitorRecord(row.webhook))),
      },
      { status: 200 }
    )
  } catch (error) {
    logger.error(`[${requestId}] Failed to list monitors`, { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const auth = await authenticateIndicatorRequest({
      request,
      requestId,
      logger,
      action: 'monitor create',
      responseShape: 'errorOnly',
    })
    if ('response' in auth) return auth.response

    const body = await request.json().catch(() => ({}))
    const source = body && typeof body === 'object' ? (body as { source?: unknown }).source : null
    if (!isMonitorProvider(source)) {
      return NextResponse.json({ error: 'source is required' }, { status: 400 })
    }

    const payload = parseCreatePayload(source, body)
    const permission = await checkWorkspacePermission({
      userId: auth.userId,
      workspaceId: payload.workspaceId,
      requireWrite: true,
      responseShape: 'errorOnly',
    })
    if (!permission.ok) return permission.response

    const workflowRow = await ensureWorkflowInWorkspace(payload.workflowId, payload.workspaceId)
    await ensureMonitorTriggerBlockInDeployedState(
      payload.workflowId,
      payload.blockId,
      getMonitorTriggerIdForProvider(source)
    )
    const nextIsActive = (payload.isActive ?? true) && workflowRow.isDeployed === true
    const providerConfig = await buildProviderConfigForCreate({
      source,
      payload,
      userId: auth.userId,
      requestId,
      requireCompleteAuth: nextIsActive,
    })

    const monitorId = nanoid()
    const monitorPath = `monitor-${monitorId}`

    const [createdMonitor] = await db
      .insert(webhook)
      .values({
        id: monitorId,
        workflowId: payload.workflowId,
        blockId: null,
        path: monitorPath,
        provider: source,
        providerConfig,
        isActive: nextIsActive,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    void notifyMonitorsReconcile({ requestId, logger })

    return NextResponse.json({ data: await toMonitorRecord(createdMonitor) }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    logger.error(`[${requestId}] Failed to create monitor`, { error })
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

async function buildProviderConfigForCreate({
  source,
  payload,
  userId,
  requestId,
  requireCompleteAuth,
}: {
  source: MonitorWebhookProvider
  payload: MonitorCreatePayload
  userId: string
  requestId: string
  requireCompleteAuth: boolean
}) {
  if (source === PORTFOLIO_MONITOR_PROVIDER) {
    const portfolioPayload = payload as PortfolioCreatePayload
    const connection = await resolvePortfolioMonitorAccount({
      userId,
      providerId: portfolioPayload.providerId,
      serviceId: portfolioPayload.serviceId,
      credentialId: portfolioPayload.credentialId,
      accountId: portfolioPayload.accountId,
      requestId,
    })

    return normalizePortfolioMonitorConfig({
      triggerBlockId: portfolioPayload.blockId,
      providerId: portfolioPayload.providerId,
      serviceId: connection.serviceId,
      credentialId: portfolioPayload.credentialId,
      connectionOwnerUserId: connection.connectionOwnerUserId,
      accountId: portfolioPayload.accountId,
      condition: portfolioPayload.condition,
      fireMode: portfolioPayload.fireMode,
      cooldownSeconds: portfolioPayload.cooldownSeconds,
      pollIntervalSeconds: portfolioPayload.pollIntervalSeconds,
    })
  }

  const indicatorPayload = payload as IndicatorCreatePayload
  await ensureTriggerCapableIndicator(indicatorPayload.workspaceId, indicatorPayload.indicatorId)
  const indicatorMetadata = await loadIndicatorInputMetadata(
    indicatorPayload.workspaceId,
    indicatorPayload.indicatorId
  )

  return normalizeIndicatorMonitorConfig({
    triggerBlockId: indicatorPayload.blockId,
    providerId: indicatorPayload.providerId,
    interval: indicatorPayload.interval,
    listingInput: indicatorPayload.listing,
    indicatorId: indicatorPayload.indicatorId,
    authInput: indicatorPayload.auth,
    providerParams: indicatorPayload.providerParams,
    indicatorInputs: indicatorPayload.indicatorInputs,
    indicatorInputMeta: indicatorMetadata.inputMeta,
    requireCompleteAuth,
  })
}
