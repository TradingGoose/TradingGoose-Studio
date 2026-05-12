import { db, orderHistoryTable, workflowExecutionLogs } from '@tradinggoose/db'
import { and, eq, gte, lte } from 'drizzle-orm'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { TradingServiceError } from '@/lib/trading/errors'
import { serializeOrderRecord } from '@/lib/trading/order-records'

export const ORDER_SUBMISSION_SOURCES = ['manual', 'copilot', 'workflow'] as const
export type OrderSubmissionSource = (typeof ORDER_SUBMISSION_SOURCES)[number]

export const isOrderSubmissionSource = (value: string): value is OrderSubmissionSource =>
  (ORDER_SUBMISSION_SOURCES as readonly string[]).includes(value)

type OrderHistoryInput = {
  workspaceId: string
  provider: string
  environment?: string | null
  submissionSource: OrderSubmissionSource
  logId: string | null
  listingIdentity?: unknown
  request: Record<string, unknown>
  response: Record<string, unknown>
  normalizedOrder?: Record<string, unknown>
}

async function resolveOrderLogId(params: { workspaceId: string; logId?: string | null }) {
  if (!params.logId) return { ok: true as const, logId: null }

  const [log] = await db
    .select({ id: workflowExecutionLogs.id, workspaceId: workflowExecutionLogs.workspaceId })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.id, params.logId))
    .limit(1)

  if (!log || log.workspaceId !== params.workspaceId) {
    return { ok: false as const, error: 'logId does not belong to the workspace' }
  }

  return { ok: true as const, logId: log.id }
}

export async function resolveOrderHistoryContext({
  logId,
  submissionSource,
  workspaceId,
}: {
  logId?: string | null
  submissionSource?: string
  workspaceId: string
}): Promise<{ submissionSource: OrderSubmissionSource; logId: string | null }> {
  const source = submissionSource?.trim()
  if (!source || !isOrderSubmissionSource(source)) {
    throw new TradingServiceError('submissionSource is required')
  }

  const resolvedOrderLog = await resolveOrderLogId({ workspaceId, logId })
  if (!resolvedOrderLog.ok) {
    throw new TradingServiceError(resolvedOrderLog.error)
  }

  return { submissionSource: source, logId: resolvedOrderLog.logId }
}

export async function recordOrderHistory(input: OrderHistoryInput) {
  const [record] = await db
    .insert(orderHistoryTable)
    .values({
      workspaceId: input.workspaceId,
      provider: input.provider,
      environment: input.environment,
      submissionSource: input.submissionSource,
      logId: input.logId,
      listingIdentity: input.listingIdentity,
      request: input.request,
      response: input.response,
      normalizedOrder: input.normalizedOrder,
    })
    .returning()

  return record
}

export async function listTradingOrderHistory({
  endDate,
  startDate,
  userId,
  workspaceId,
}: {
  endDate?: string | null
  startDate?: string | null
  userId: string
  workspaceId?: string | null
}) {
  if (!workspaceId) {
    throw new TradingServiceError('workspaceId is required')
  }

  const access = await checkWorkspaceAccess(workspaceId, userId)
  if (!access.exists || !access.hasAccess) {
    throw new TradingServiceError('Not found', 404)
  }

  if (!startDate || !endDate) {
    throw new TradingServiceError('startDate and endDate are required')
  }

  const start = new Date(startDate)
  const end = new Date(endDate)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new TradingServiceError('startDate and endDate must be valid ISO timestamps')
  }

  const history = await db
    .select()
    .from(orderHistoryTable)
    .where(
      and(
        eq(orderHistoryTable.workspaceId, workspaceId),
        gte(orderHistoryTable.recordedAt, start),
        lte(orderHistoryTable.recordedAt, end)
      )
    )
    .orderBy(orderHistoryTable.recordedAt)

  return {
    history: history.map((row) => serializeOrderRecord(row)),
    count: history.length,
    workspaceId,
    startDate,
    endDate,
  }
}
