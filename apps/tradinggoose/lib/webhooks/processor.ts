import { db, webhook, workflow } from '@tradinggoose/db'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getApiKeyOwnerUserId } from '@/lib/api-key/service'
import { checkServerSideUsageLimits } from '@/lib/billing'
import {
  enqueuePendingExecution,
  isPendingExecutionLimitError,
} from '@/lib/execution/pending-execution'
import { IdempotencyService } from '@/lib/idempotency'
import { createLogger } from '@/lib/logs/console/logger'
import { TriggerExecutionUnavailableError } from '@/lib/trigger/settings'
import {
  handleSlackChallenge,
  handleWhatsAppVerification,
  validateMicrosoftTeamsSignature,
  verifyProviderWebhook,
} from '@/lib/webhooks/utils'

const logger = createLogger('WebhookProcessor')

export interface WebhookProcessorOptions {
  requestId: string
  path?: string
  webhookId?: string
  testMode?: boolean
  executionTarget?: 'deployed' | 'live'
}

export type DispatchGateResult =
  | { allowed: true }
  | {
      allowed: false
      code: 'PINNED_API_KEY_REQUIRED' | 'USAGE_LIMIT_EXCEEDED'
      message: string
    }

export type QueueWebhookExecutionOptions = WebhookProcessorOptions

export function mapDispatchGateResultToHttpResponse(
  result: DispatchGateResult,
  provider: string
): NextResponse | null {
  if (result.allowed) {
    return null
  }

  if (result.code === 'PINNED_API_KEY_REQUIRED') {
    return NextResponse.json({ message: 'Pinned API key required' }, { status: 200 })
  }

  if (provider === 'microsoftteams') {
    return NextResponse.json({
      type: 'message',
      text: 'Usage limit exceeded. Please upgrade your billing tier to continue.',
    })
  }
  return NextResponse.json({ message: 'Usage limit exceeded' }, { status: 200 })
}

export async function parseWebhookBody(
  request: NextRequest,
  requestId: string
): Promise<{ body: any; rawBody: string } | NextResponse> {
  let rawBody: string | null = null
  try {
    const requestClone = request.clone()
    rawBody = await requestClone.text()

    if (!rawBody || rawBody.length === 0) {
      logger.warn(`[${requestId}] Rejecting request with empty body`)
      return new NextResponse('Empty request body', { status: 400 })
    }
  } catch (bodyError) {
    logger.error(`[${requestId}] Failed to read request body`, {
      error: bodyError instanceof Error ? bodyError.message : String(bodyError),
    })
    return new NextResponse('Failed to read request body', { status: 400 })
  }

  let body: any
  try {
    const contentType = request.headers.get('content-type') || ''

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = new URLSearchParams(rawBody)
      const payloadString = formData.get('payload')

      if (!payloadString) {
        logger.warn(`[${requestId}] No payload field found in form-encoded data`)
        return new NextResponse('Missing payload field', { status: 400 })
      }

      body = JSON.parse(payloadString)
      logger.debug(`[${requestId}] Parsed form-encoded GitHub webhook payload`)
    } else {
      body = JSON.parse(rawBody)
      logger.debug(`[${requestId}] Parsed JSON webhook payload`)
    }

    if (Object.keys(body).length === 0) {
      logger.warn(`[${requestId}] Rejecting empty JSON object`)
      return new NextResponse('Empty JSON payload', { status: 400 })
    }
  } catch (parseError) {
    logger.error(`[${requestId}] Failed to parse webhook body`, {
      error: parseError instanceof Error ? parseError.message : String(parseError),
      contentType: request.headers.get('content-type'),
      bodyPreview: `${rawBody?.slice(0, 100)}...`,
    })
    return new NextResponse('Invalid payload format', { status: 400 })
  }

  return { body, rawBody }
}

export async function handleProviderChallenges(
  body: any,
  request: NextRequest,
  requestId: string,
  path: string
): Promise<NextResponse | null> {
  const slackResponse = handleSlackChallenge(body)
  if (slackResponse) {
    return slackResponse
  }

  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  const whatsAppResponse = await handleWhatsAppVerification(requestId, path, mode, token, challenge)
  if (whatsAppResponse) {
    return whatsAppResponse
  }

  return null
}

export async function findWebhookAndWorkflow(
  options: WebhookProcessorOptions
): Promise<{ webhook: any; workflow: any } | null> {
  if (options.webhookId) {
    const results = await db
      .select({
        webhook: webhook,
        workflow: workflow,
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(and(eq(webhook.id, options.webhookId), eq(webhook.isActive, true)))
      .limit(1)

    if (results.length === 0) {
      logger.warn(`[${options.requestId}] No active webhook found for id: ${options.webhookId}`)
      return null
    }

    return { webhook: results[0].webhook, workflow: results[0].workflow }
  }

  if (options.path) {
    const results = await db
      .select({
        webhook: webhook,
        workflow: workflow,
      })
      .from(webhook)
      .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
      .where(and(eq(webhook.path, options.path), eq(webhook.isActive, true)))
      .limit(1)

    if (results.length === 0) {
      logger.warn(`[${options.requestId}] No active webhook found for path: ${options.path}`)
      return null
    }

    return { webhook: results[0].webhook, workflow: results[0].workflow }
  }

  return null
}

export async function verifyProviderAuth(
  foundWebhook: any,
  request: NextRequest,
  rawBody: string,
  requestId: string
): Promise<NextResponse | null> {
  if (foundWebhook.provider === 'microsoftteams') {
    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}

    if (providerConfig.hmacSecret) {
      const authHeader = request.headers.get('authorization')

      if (!authHeader || !authHeader.startsWith('HMAC ')) {
        logger.warn(
          `[${requestId}] Microsoft Teams outgoing webhook missing HMAC authorization header`
        )
        return new NextResponse('Unauthorized - Missing HMAC signature', { status: 401 })
      }

      const isValidSignature = validateMicrosoftTeamsSignature(
        providerConfig.hmacSecret,
        authHeader,
        rawBody
      )

      if (!isValidSignature) {
        logger.warn(`[${requestId}] Microsoft Teams HMAC signature verification failed`)
        return new NextResponse('Unauthorized - Invalid HMAC signature', { status: 401 })
      }

      logger.debug(`[${requestId}] Microsoft Teams HMAC signature verified successfully`)
    }
  }

  // Provider-specific verification (utils may return a response for some providers)
  const providerVerification = verifyProviderWebhook(foundWebhook, request, requestId)
  if (providerVerification) {
    return providerVerification
  }

  // Handle Google Forms shared-secret authentication (Apps Script forwarder)
  if (foundWebhook.provider === 'google_forms') {
    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
    const expectedToken = providerConfig.token as string | undefined
    const secretHeaderName = providerConfig.secretHeaderName as string | undefined

    if (expectedToken) {
      let isTokenValid = false

      if (secretHeaderName) {
        const headerValue = request.headers.get(secretHeaderName.toLowerCase())
        if (headerValue === expectedToken) {
          isTokenValid = true
        }
      } else {
        const authHeader = request.headers.get('authorization')
        if (authHeader?.toLowerCase().startsWith('bearer ')) {
          const token = authHeader.substring(7)
          if (token === expectedToken) {
            isTokenValid = true
          }
        }
      }

      if (!isTokenValid) {
        logger.warn(`[${requestId}] Google Forms webhook authentication failed`)
        return new NextResponse('Unauthorized - Invalid secret', { status: 401 })
      }
    }
  }

  // Generic webhook authentication
  if (foundWebhook.provider === 'generic') {
    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}

    if (providerConfig.requireAuth) {
      const configToken = providerConfig.token
      const secretHeaderName = providerConfig.secretHeaderName

      if (configToken) {
        let isTokenValid = false

        if (secretHeaderName) {
          // Check custom header (headers are case-insensitive)
          const headerValue = request.headers.get(secretHeaderName.toLowerCase())
          if (headerValue === configToken) {
            isTokenValid = true
          }
        } else {
          // Check Authorization: Bearer <token> (case-insensitive)
          const authHeader = request.headers.get('authorization')
          if (authHeader?.toLowerCase().startsWith('bearer ')) {
            const token = authHeader.substring(7)
            if (token === configToken) {
              isTokenValid = true
            }
          }
        }

        if (!isTokenValid) {
          return new NextResponse('Unauthorized - Invalid authentication token', { status: 401 })
        }
      } else {
        return new NextResponse('Unauthorized - Authentication required but not configured', {
          status: 401,
        })
      }
    }
  }

  return null
}

export async function checkUsageLimits(
  foundWorkflow: any,
  foundWebhook: any,
  requestId: string,
  testMode: boolean
): Promise<DispatchGateResult> {
  if (testMode) {
    logger.debug(`[${requestId}] Skipping usage limit check for test webhook`)
    return { allowed: true }
  }

  try {
    const actorUserId = await getApiKeyOwnerUserId(foundWorkflow.pinnedApiKeyId)

    if (!actorUserId) {
      logger.warn(`[${requestId}] Webhook requires pinned API key to attribute usage`)
      return {
        allowed: false,
        code: 'PINNED_API_KEY_REQUIRED',
        message: 'Pinned API key required',
      }
    }

    const usageCheck = await checkServerSideUsageLimits({
      userId: actorUserId,
      workflowId: foundWorkflow.id,
      workspaceId: foundWorkflow.workspaceId,
    })
    if (usageCheck.isExceeded) {
      logger.warn(
        `[${requestId}] Workspace billing subject has exceeded usage limits. Skipping webhook execution.`,
        {
          actorUserId,
          currentUsage: usageCheck.currentUsage,
          limit: usageCheck.limit,
          workflowId: foundWorkflow.id,
          provider: foundWebhook.provider,
        }
      )

      return {
        allowed: false,
        code: 'USAGE_LIMIT_EXCEEDED',
        message: 'Usage limit exceeded',
      }
    }

    logger.debug(`[${requestId}] Usage limit check passed for webhook`, {
      provider: foundWebhook.provider,
      currentUsage: usageCheck.currentUsage,
      limit: usageCheck.limit,
    })
  } catch (usageError) {
    logger.error(`[${requestId}] Error checking webhook usage limits:`, usageError)
  }

  return { allowed: true }
}

export async function queueWebhookExecution(
  foundWebhook: any,
  foundWorkflow: any,
  body: any,
  request: NextRequest,
  options: QueueWebhookExecutionOptions
): Promise<NextResponse> {
  try {
    const actorUserId = await getApiKeyOwnerUserId(foundWorkflow.pinnedApiKeyId)
    if (!actorUserId) {
      logger.warn(`[${options.requestId}] Webhook requires pinned API key to attribute usage`)
      return (
        mapDispatchGateResultToHttpResponse(
          {
            allowed: false,
            code: 'PINNED_API_KEY_REQUIRED',
            message: 'Pinned API key required',
          },
          foundWebhook.provider
        ) ?? NextResponse.json({ message: 'Pinned API key required' }, { status: 200 })
      )
    }

    const headers = Object.fromEntries(request.headers.entries())

    // For Microsoft Teams Graph notifications, extract unique identifiers for idempotency
    if (
      foundWebhook.provider === 'microsoftteams' &&
      body?.value &&
      Array.isArray(body.value) &&
      body.value.length > 0
    ) {
      const notification = body.value[0]
      const subscriptionId = notification.subscriptionId
      const messageId = notification.resourceData?.id

      if (subscriptionId && messageId) {
        headers['x-teams-notification-id'] = `${subscriptionId}:${messageId}`
      }
    }

    const payload = {
      webhookId: foundWebhook.id,
      workflowId: foundWorkflow.id,
      userId: actorUserId,
      provider: foundWebhook.provider,
      body,
      headers,
      blockId: foundWebhook.blockId,
      testMode: options.testMode,
      executionTarget: options.executionTarget,
    }

    const pendingExecutionId = `webhook_execution:${IdempotencyService.createWebhookIdempotencyKey(
      foundWebhook.id,
      headers,
    )}`

    const handle = await enqueuePendingExecution({
      executionType: 'webhook',
      pendingExecutionId,
      workflowId: foundWorkflow.id,
      workspaceId: foundWorkflow.workspaceId ?? null,
      userId: actorUserId,
      source: `webhook:${foundWebhook.provider}`,
      requestId: options.requestId,
      payload: {
        ...payload,
        executionId: pendingExecutionId,
      },
    })

    logger.info(
      `[${options.requestId}] Queued ${options.testMode ? 'TEST ' : ''}webhook execution ${
        handle.pendingExecutionId
      } for ${foundWebhook.provider} webhook`,
    )
  } catch (error: any) {
    if (error instanceof TriggerExecutionUnavailableError) {
      logger.warn(`[${options.requestId}] Webhook execution blocked`, {
        provider: foundWebhook.provider,
        error: error.message,
      })

      if (foundWebhook.provider === 'microsoftteams') {
        return NextResponse.json(
          {
            type: 'message',
            text: error.message,
          },
          { status: 503 }
        )
      }

      return NextResponse.json({ message: error.message }, { status: 503 })
    }

    if (isPendingExecutionLimitError(error)) {
      logger.warn(`[${options.requestId}] Webhook backlog full`, {
        provider: foundWebhook.provider,
        pendingCount: error.details.pendingCount,
        maxPendingCount: error.details.maxPendingCount,
      })

      if (foundWebhook.provider === 'microsoftteams') {
        return NextResponse.json({
          type: 'message',
          text: 'Webhook processing failed',
        })
      }

      return NextResponse.json({ message: 'Internal server error' }, { status: 200 })
    }

    logger.error(`[${options.requestId}] Failed to queue webhook execution:`, error)

    if (foundWebhook.provider === 'microsoftteams') {
      return NextResponse.json({
        type: 'message',
        text: 'Webhook processing failed',
      })
    }

    return NextResponse.json({ message: 'Internal server error' }, { status: 200 })
  }

  if (foundWebhook.provider === 'microsoftteams') {
    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
    const triggerId = providerConfig.triggerId as string | undefined

    if (triggerId === 'microsoftteams_chat_subscription') {
      return new NextResponse(null, { status: 202 })
    }

    return NextResponse.json({
      type: 'message',
      text: 'TradingGoose',
    })
  }

  return NextResponse.json({ message: 'Webhook processed' })
}
