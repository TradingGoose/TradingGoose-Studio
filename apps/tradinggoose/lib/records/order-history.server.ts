import { db, orderHistoryTable } from '@tradinggoose/db'
import { workflowExecutionLogs } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'

export const ORDER_SUBMISSION_SOURCES = ['manual', 'copilot', 'workflow'] as const
export type OrderSubmissionSource = (typeof ORDER_SUBMISSION_SOURCES)[number]

export const isOrderSubmissionSource = (value: string): value is OrderSubmissionSource =>
  (ORDER_SUBMISSION_SOURCES as readonly string[]).includes(value)

type OrderHistoryInput = {
  workspaceId: string
  provider: string
  environment?: string | null
  recordedAt?: string
  submissionSource: OrderSubmissionSource
  logId?: string | null
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

export async function recordOrderHistory(input: OrderHistoryInput) {
  let recordedAt: Date | undefined
  if (input.recordedAt) {
    const parsed = new Date(input.recordedAt)
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false as const, error: 'recordedAt must be a valid ISO timestamp' }
    }
    recordedAt = parsed
  }

  const resolvedOrderLog = await resolveOrderLogId({
    workspaceId: input.workspaceId,
    logId: input.logId,
  })

  if (!resolvedOrderLog.ok) {
    return { ok: false as const, error: resolvedOrderLog.error }
  }

  const [record] = await db
    .insert(orderHistoryTable)
    .values({
      workspaceId: input.workspaceId,
      provider: input.provider,
      environment: input.environment,
      recordedAt,
      submissionSource: input.submissionSource,
      logId: resolvedOrderLog.logId,
      listingIdentity: input.listingIdentity,
      request: input.request,
      response: input.response,
      normalizedOrder: input.normalizedOrder,
    })
    .returning()

  return { ok: true as const, record }
}
