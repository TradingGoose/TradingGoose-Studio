import { db, webhook, workflow } from '@tradinggoose/db'
import { tasks } from '@trigger.dev/sdk'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getApiKeyOwnerUserId } from '@/lib/api-key/service'
import { checkServerSideUsageLimits } from '@/lib/billing'
import { isBillingEnabledForRuntime } from '@/lib/billing/settings'
import { resolveWorkspaceBillingContext } from '@/lib/billing/workspace-billing'
import { env, isTruthy } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import {
  handleSlackChallenge,
  handleWhatsAppVerification,
  validateMicrosoftTeamsSignature,
  verifyProviderWebhook,
} from '@/lib/webhooks/utils'
import { executeWebhookJob } from '@/background/webhook-execution'
import { RateLimiter } from '@/services/queue'

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
      code: 'PINNED_API_KEY_REQUIRED' | 'RATE_LIMIT_EXCEEDED' | 'USAGE_LIMIT_EXCEEDED'
      message: string
    }

export type QueueWebhookExecutionContext =
  | { kind: 'http'; request: NextRequest }
  | { kind: 'internal'; headers?: Record<string, string> }

export type QueueWebhookExecutionOptions = WebhookProcessorOptions & {
  headerOverrides?: Record<string, string>
}

export type QueueWebhookExecutionInternalResult =
  | { queued: true }
  | {
      queued: false
      code: 'PINNED_API_KEY_REQUIRED' | 'QUEUE_FAILED'
      message: string
    }

const resolveBaseHeaders = (context: QueueWebhookExecutionContext): Record<string, string> => {
  if (context.kind === 'http') {
    return Object.fromEntries(context.request.headers.entries())
  }
  return { ...(context.headers ?? {}) }
}

const mergeHeadersWithOverrides = (
  baseHeaders: Record<string, string>,
  headerOverrides?: Record<string, string>
) => {
  if (!headerOverrides) {
    return baseHeaders
  }
  return {
    ...baseHeaders,
    ...headerOverrides,
  }
}

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

  if (result.code === 'RATE_LIMIT_EXCEEDED') {
    if (provider === 'microsoftteams') {
      return NextResponse.json({
        type: 'message',
        text: 'Rate limit exceeded. Please try again later.',
      })
    }
    return NextResponse.json({ message: 'Rate limit exceeded' }, { status: 200 })
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

export async function checkRateLimits(
  foundWorkflow: any,
  foundWebhook: any,
  requestId: string
): Promise<DispatchGateResult> {
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

    if (!(await isBillingEnabledForRuntime())) {
      return { allowed: true }
    }

    const billingContext = await resolveWorkspaceBillingContext({
      workspaceId: foundWorkflow.workspaceId,
      actorUserId,
    })
    const billingScope = {
      scopeType: billingContext.scopeType,
      scopeId: billingContext.scopeId,
      organizationId:
        billingContext.scopeType === 'organization_member' ||
        billingContext.scopeType === 'organization'
          ? billingContext.billingOwner.type === 'organization'
            ? billingContext.billingOwner.organizationId
            : null
          : null,
      userId:
        billingContext.scopeType === 'organization_member'
          ? actorUserId
          : billingContext.scopeType === 'user'
            ? billingContext.billingUserId
            : null,
    }

    const rateLimiter = new RateLimiter()
    const rateLimitCheck = await rateLimiter.checkRateLimitWithSubscription(
      billingContext.billingUserId,
      billingContext.subscription,
      'webhook',
      true,
      billingScope
    )

    if (!rateLimitCheck.allowed) {
      logger.warn(`[${requestId}] Rate limit exceeded for webhook billing subject`, {
        provider: foundWebhook.provider,
        actorUserId,
        billingUserId: billingContext.billingUserId,
        remaining: rateLimitCheck.remaining,
        resetAt: rateLimitCheck.resetAt,
      })

      return {
        allowed: false,
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded',
      }
    }

    logger.debug(`[${requestId}] Rate limit check passed for webhook`, {
      provider: foundWebhook.provider,
      remaining: rateLimitCheck.remaining,
      resetAt: rateLimitCheck.resetAt,
    })
  } catch (rateLimitError) {
    logger.error(`[${requestId}] Error checking webhook rate limits:`, rateLimitError)
  }

  return { allowed: true }
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

    if (!(await isBillingEnabledForRuntime())) {
      return { allowed: true }
    }

    const usageCheck = await checkServerSideUsageLimits({
      userId: actorUserId,
      workflowId: foundWorkflow.id,
      workspaceId: foundWorkflow.workspaceId,
    })
    if (usageCheck.isExceeded) {
      const billingUserId = (
        await resolveWorkspaceBillingContext({
          workspaceId: foundWorkflow.workspaceId,
          actorUserId,
        })
      ).billingUserId
      logger.warn(
        `[${requestId}] Workspace billing subject has exceeded usage limits. Skipping webhook execution.`,
        {
          actorUserId,
          billingUserId,
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
  context: QueueWebhookExecutionContext,
  options: QueueWebhookExecutionOptions
): Promise<NextResponse> {
  const queueResult = await queueWebhookExecutionInternal(
    foundWebhook,
    foundWorkflow,
    body,
    context,
    options
  )

  if (!queueResult.queued) {
    if (queueResult.code === 'PINNED_API_KEY_REQUIRED') {
      return (
        mapDispatchGateResultToHttpResponse(
          {
            allowed: false,
            code: 'PINNED_API_KEY_REQUIRED',
            message: queueResult.message,
          },
          foundWebhook.provider
        ) ?? NextResponse.json({ message: queueResult.message }, { status: 200 })
      )
    }

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

    // Chat subscription (Graph API) returns 202
    if (triggerId === 'microsoftteams_chat_subscription') {
      return new NextResponse(null, { status: 202 })
    }

    // Channel webhook (outgoing webhook) returns message response
    return NextResponse.json({
      type: 'message',
      text: 'TradingGoose',
    })
  }

  return NextResponse.json({ message: 'Webhook processed' })
}

export async function queueWebhookExecutionInternal(
  foundWebhook: any,
  foundWorkflow: any,
  body: any,
  context: QueueWebhookExecutionContext,
  options: QueueWebhookExecutionOptions
): Promise<QueueWebhookExecutionInternalResult> {
  try {
    const actorUserId = await getApiKeyOwnerUserId(foundWorkflow.pinnedApiKeyId)
    if (!actorUserId) {
      logger.warn(`[${options.requestId}] Webhook requires pinned API key to attribute usage`)
      return {
        queued: false,
        code: 'PINNED_API_KEY_REQUIRED',
        message: 'Pinned API key required',
      }
    }

    const baseHeaders = resolveBaseHeaders(context)

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
        baseHeaders['x-teams-notification-id'] = `${subscriptionId}:${messageId}`
      }
    }

    const headers = mergeHeadersWithOverrides(baseHeaders, options.headerOverrides)

    // Extract credentialId from webhook config for credential-based webhooks
    const providerConfig = (foundWebhook.providerConfig as Record<string, any>) || {}
    const credentialId = providerConfig.credentialId as string | undefined

    const payload = {
      webhookId: foundWebhook.id,
      workflowId: foundWorkflow.id,
      userId: actorUserId,
      provider: foundWebhook.provider,
      body,
      headers,
      path: options.path || foundWebhook.path,
      blockId: foundWebhook.blockId,
      testMode: options.testMode,
      executionTarget: options.executionTarget,
      ...(credentialId ? { credentialId } : {}),
    }

    const useTrigger = isTruthy(env.TRIGGER_DEV_ENABLED)

    if (useTrigger) {
      const handle = await tasks.trigger('webhook-execution', payload)
      logger.info(
        `[${options.requestId}] Queued ${options.testMode ? 'TEST ' : ''}webhook execution task ${
          handle.id
        } for ${foundWebhook.provider} webhook`
      )
    } else {
      void executeWebhookJob(payload).catch((error) => {
        logger.error(`[${options.requestId}] Direct webhook execution failed`, error)
      })
      logger.info(
        `[${options.requestId}] Queued direct ${
          options.testMode ? 'TEST ' : ''
        }webhook execution for ${foundWebhook.provider} webhook (Trigger.dev disabled)`
      )
    }

    return { queued: true }
  } catch (error: any) {
    logger.error(`[${options.requestId}] Failed to queue webhook execution:`, error)
    return {
      queued: false,
      code: 'QUEUE_FAILED',
      message: 'Failed to queue webhook execution',
    }
  }
}
