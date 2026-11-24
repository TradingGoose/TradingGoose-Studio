import { createHmac } from 'crypto'
import { db } from '@tradinggoose/db'
import { workflowExecutionLogs, workflowLogWebhookDelivery } from '@tradinggoose/db/schema'
import { tasks } from '@trigger.dev/sdk'
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import type { BillingTierSummary } from '@/lib/billing/types'
import { createLogger } from '@/lib/logs/console/logger'
import { publicTraceSpans } from '@/lib/logs/public'
import type { WorkflowExecutionLog } from '@/lib/logs/types'
import { decryptSecret } from '@/lib/utils-server'
import type { logsWebhookDelivery } from './tasks/logs-webhook-delivery'

const logger = createLogger('LogsWebhookDelivery')

const MAX_ATTEMPTS = 5
const RETRY_DELAYS = [
  5 * 1000, // 5 seconds (1st retry)
  15 * 1000, // 15 seconds (2nd retry)
  60 * 1000, // 1 minute (3rd retry)
  3 * 60 * 1000, // 3 minutes (4th retry)
]

function getRetryDelayWithJitter(baseDelay: number): number {
  const jitter = Math.random() * 0.1 * baseDelay
  return Math.floor(baseDelay + jitter)
}

interface WebhookPayload {
  id: string
  type: 'workflow.execution.completed'
  timestamp: number
  data: {
    workflowId: string
    executionId: string
    status: 'success' | 'error'
    level: string
    trigger: string
    startedAt: string
    endedAt: string
    totalDurationMs: number
    cost?: any
    files?: any
    finalOutput?: any
    errorMessage?: string
    traceSpans?: any[]
    rateLimits?: {
      sync: {
        limit: number
        remaining: number
        resetAt: string
      }
      async: {
        limit: number
        remaining: number
        resetAt: string
      }
    }
    usage?: {
      currentPeriodCost: number
      limit: number
      tier: BillingTierSummary
      isExceeded: boolean
    }
  }
  links: {
    log: string
    execution: string
  }
}

type SubscriptionSnapshot = {
  url: string
  secret: string | null
  includeFinalOutput: boolean
  includeTraceSpans: boolean
  includeRateLimits: boolean
  includeUsageData: boolean
}

function generateSignature(secret: string, timestamp: number, body: string): string {
  const signatureBase = `${timestamp}.${body}`
  const hmac = createHmac('sha256', secret)
  hmac.update(signatureBase)
  return hmac.digest('hex')
}

export async function executeLogsWebhookDelivery(
  params: { deliveryId: string },
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  const { deliveryId } = params

  try {
    const [delivery] = await db
      .update(workflowLogWebhookDelivery)
      .set({
        status: 'in_progress',
        attempts: sql`${workflowLogWebhookDelivery.attempts} + 1`,
        lastAttemptAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(workflowLogWebhookDelivery.id, deliveryId),
          eq(workflowLogWebhookDelivery.status, 'pending'),
          or(
            isNull(workflowLogWebhookDelivery.nextAttemptAt),
            lte(workflowLogWebhookDelivery.nextAttemptAt, new Date())
          )
        )
      )
      .returning()

    if (!delivery) {
      logger.info(`Delivery ${deliveryId} not claimable (already in progress or not due)`)
      return
    }

    const attempts = delivery.attempts
    const workflowSummary = delivery.workflowSummary as WorkflowExecutionLog['workflowSummary']
    const subscriptionSnapshot = delivery.subscriptionSnapshot as SubscriptionSnapshot | null

    if (!subscriptionSnapshot) {
      await db
        .update(workflowLogWebhookDelivery)
        .set({
          status: 'failed',
          attempts,
          lastAttemptAt: new Date(),
          failureReason: 'Webhook delivery is missing subscription snapshot',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workflowLogWebhookDelivery.id, deliveryId),
            eq(workflowLogWebhookDelivery.status, 'in_progress')
          )
        )

      logger.error(
        `Webhook delivery ${deliveryId} failed because subscription snapshot is missing`,
        {
          executionId: delivery.executionId,
          workspaceId: delivery.workspaceId,
        }
      )
      return { success: false }
    }

    const [log] = await db
      .select()
      .from(workflowExecutionLogs)
      .where(
        and(
          eq(workflowExecutionLogs.executionId, delivery.executionId),
          eq(workflowExecutionLogs.workspaceId, delivery.workspaceId)
        )
      )
      .limit(1)

    if (!log) {
      await db
        .update(workflowLogWebhookDelivery)
        .set({
          status: 'failed',
          attempts,
          lastAttemptAt: new Date(),
          failureReason: 'Workflow execution log not found',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workflowLogWebhookDelivery.id, deliveryId),
            eq(workflowLogWebhookDelivery.status, 'in_progress')
          )
        )

      logger.error(`Webhook delivery ${deliveryId} failed because log row was missing`, {
        executionId: delivery.executionId,
        workspaceId: delivery.workspaceId,
      })
      return { success: false }
    }

    if (!log.endedAt) throw new Error('Completion publication requires a terminal workflow outcome')
    if ((log.workflowId ?? (log.workflowSummary as { id?: string })?.id) !== workflowSummary.id)
      throw new Error('Completion publication workflow scope differs')
    const executionData = log.executionData as WorkflowExecutionLog['executionData']
    const timestamp = Date.now()

    const payload: WebhookPayload = {
      id: `evt_${uuidv4()}`,
      type: 'workflow.execution.completed',
      timestamp,
      data: {
        workflowId: log.workflowId ?? workflowSummary.id,
        executionId: log.executionId,
        status: log.level === 'error' ? 'error' : 'success',
        level: log.level,
        trigger: log.trigger,
        startedAt: log.startedAt.toISOString(),
        endedAt: log.endedAt.toISOString(),
        totalDurationMs: log.totalDurationMs ?? 0,
        cost: log.cost,
        files: log.files ?? undefined,
        ...((subscriptionSnapshot.includeFinalOutput || subscriptionSnapshot.includeTraceSpans) &&
        typeof executionData.errorMessage === 'string'
          ? { errorMessage: executionData.errorMessage }
          : {}),
        ...(subscriptionSnapshot.includeFinalOutput && executionData.finalOutput !== undefined
          ? { finalOutput: executionData.finalOutput }
          : {}),
        ...(subscriptionSnapshot.includeTraceSpans && executionData.traceSpans
          ? { traceSpans: publicTraceSpans(executionData.traceSpans) }
          : {}),
      },
      links: {
        log: `/v1/logs/${log.id}`,
        execution: `/v1/logs/executions/${log.executionId}`,
      },
    }

    if (
      (subscriptionSnapshot.includeRateLimits || subscriptionSnapshot.includeUsageData) &&
      workflowSummary.userId
    ) {
      const { getUserLimits } = await import('@/app/api/v1/logs/meta')
      try {
        const limits = await getUserLimits(workflowSummary.userId)
        if (subscriptionSnapshot.includeRateLimits) {
          payload.data.rateLimits = limits.executionRateLimit
        }
        if (subscriptionSnapshot.includeUsageData) {
          payload.data.usage = limits.usage
        }
      } catch (error) {
        logger.warn('Failed to fetch limits/usage for webhook', { error })
      }
    }

    const body = JSON.stringify(payload)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'tradinggoose-event': 'workflow.execution.completed',
      'tradinggoose-timestamp': timestamp.toString(),
      'tradinggoose-delivery-id': deliveryId,
      'Idempotency-Key': deliveryId,
    }

    if (subscriptionSnapshot.secret) {
      const { decrypted } = await decryptSecret(subscriptionSnapshot.secret)
      const signature = generateSignature(decrypted, timestamp, body)
      headers['tradinggoose-signature'] = `t=${timestamp},v1=${signature}`
    }

    const [currentDelivery] = await db
      .select({ status: workflowLogWebhookDelivery.status })
      .from(workflowLogWebhookDelivery)
      .where(eq(workflowLogWebhookDelivery.id, deliveryId))
      .limit(1)

    if (currentDelivery?.status !== 'in_progress') {
      logger.info(`Webhook delivery ${deliveryId} skipped before send`, {
        status: currentDelivery?.status ?? 'missing',
        executionId: log.executionId,
      })
      return { success: false }
    }

    logger.info(`Attempting webhook delivery ${deliveryId} (attempt ${attempts})`, {
      url: subscriptionSnapshot.url,
      executionId: log.executionId,
    })

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)

    try {
      const response = await fetch(subscriptionSnapshot.url, {
        method: 'POST',
        headers,
        body,
        signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      })

      let truncatedBody = ''
      const reader = response.body?.getReader()
      try {
        const decoder = new TextDecoder()
        while (reader && truncatedBody.length < 1000) {
          const { done, value } = await reader.read()
          if (done) {
            truncatedBody = (truncatedBody + decoder.decode()).slice(0, 1000)
            break
          }
          truncatedBody = (
            truncatedBody +
            decoder.decode(value.subarray(0, 4 * (1000 - truncatedBody.length) + 3), {
              stream: true,
            })
          ).slice(0, 1000)
        }
      } catch (error) {
        logger.warn('Failed to read webhook response body', { deliveryId, error })
      } finally {
        await reader?.cancel().catch(() => {})
        reader?.releaseLock()
        clearTimeout(timeoutId)
      }
      signal?.throwIfAborted()

      if (response.ok) {
        await db
          .update(workflowLogWebhookDelivery)
          .set({
            status: 'success',
            attempts,
            lastAttemptAt: new Date(),
            responseStatus: response.status,
            responseBody: truncatedBody,
            failureReason: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(workflowLogWebhookDelivery.id, deliveryId),
              eq(workflowLogWebhookDelivery.status, 'in_progress')
            )
          )

        logger.info(`Webhook delivery ${deliveryId} succeeded`, {
          status: response.status,
          executionId: log.executionId,
        })

        return { success: true }
      }

      const isRetryable = response.status >= 500 || response.status === 429

      if (!isRetryable || attempts >= MAX_ATTEMPTS) {
        await db
          .update(workflowLogWebhookDelivery)
          .set({
            status: 'failed',
            attempts,
            lastAttemptAt: new Date(),
            responseStatus: response.status,
            responseBody: truncatedBody,
            failureReason: `HTTP ${response.status}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(workflowLogWebhookDelivery.id, deliveryId),
              eq(workflowLogWebhookDelivery.status, 'in_progress')
            )
          )

        logger.warn(`Webhook delivery ${deliveryId} failed permanently`, {
          status: response.status,
          attempts,
          executionId: log.executionId,
        })

        return { success: false }
      }

      const baseDelay = RETRY_DELAYS[Math.min(attempts - 1, RETRY_DELAYS.length - 1)]
      const delayWithJitter = getRetryDelayWithJitter(baseDelay)
      const nextAttemptAt = new Date(Date.now() + delayWithJitter)

      await db
        .update(workflowLogWebhookDelivery)
        .set({
          status: 'pending',
          attempts,
          lastAttemptAt: new Date(),
          nextAttemptAt,
          responseStatus: response.status,
          responseBody: truncatedBody,
          failureReason: `HTTP ${response.status} - will retry`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workflowLogWebhookDelivery.id, deliveryId),
            eq(workflowLogWebhookDelivery.status, 'in_progress')
          )
        )

      await tasks.trigger<typeof logsWebhookDelivery>(
        'logs-webhook-delivery',
        { deliveryId },
        { delay: nextAttemptAt }
      )

      return { success: false, retrying: true }
    } catch (error: any) {
      clearTimeout(timeoutId)
      signal?.throwIfAborted()
      const message =
        error.name === 'AbortError' ? 'Request timeout after 30 seconds' : error.message

      if (error.name === 'AbortError') {
        logger.error(`Webhook delivery ${deliveryId} timed out`, {
          executionId: log.executionId,
          attempts,
        })
      }

      const baseDelay = RETRY_DELAYS[Math.min(attempts - 1, RETRY_DELAYS.length - 1)]
      const delayWithJitter = getRetryDelayWithJitter(baseDelay)
      const nextAttemptAt = new Date(Date.now() + delayWithJitter)

      await db
        .update(workflowLogWebhookDelivery)
        .set({
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          attempts,
          lastAttemptAt: new Date(),
          nextAttemptAt: attempts >= MAX_ATTEMPTS ? null : nextAttemptAt,
          failureReason: message,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workflowLogWebhookDelivery.id, deliveryId),
            eq(workflowLogWebhookDelivery.status, 'in_progress')
          )
        )

      if (attempts >= MAX_ATTEMPTS) {
        logger.error(`Webhook delivery ${deliveryId} failed after ${attempts} attempts`, {
          error: message,
          executionId: log.executionId,
        })
        return { success: false }
      }

      await tasks.trigger<typeof logsWebhookDelivery>(
        'logs-webhook-delivery',
        { deliveryId },
        { delay: nextAttemptAt }
      )

      return { success: false, retrying: true }
    }
  } catch (error: any) {
    logger.error(`Webhook delivery ${deliveryId} encountered unexpected error`, {
      error: error.message,
      stack: error.stack,
    })

    await db
      .update(workflowLogWebhookDelivery)
      .set({
        status: 'failed',
        failureReason: `Unexpected error: ${error.message}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(workflowLogWebhookDelivery.id, deliveryId),
          eq(workflowLogWebhookDelivery.status, 'in_progress')
        )
      )

    return { success: false, error: error.message }
  }
}
