import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import {
  checkRateLimits,
  findWebhookAndWorkflow,
  handleProviderChallenges,
  mapDispatchGateResultToHttpResponse,
  parseWebhookBody,
  queueWebhookExecution,
  verifyProviderAuth,
} from '@/lib/webhooks/processor'
import { verifyTestWebhookToken } from '@/lib/webhooks/test-tokens'

const logger = createLogger('WebhookTestReceiverAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const webhookId = (await params).id

  logger.info(`[${requestId}] Test webhook request received for webhook ${webhookId}`)

  const url = new URL(request.url)
  const token = url.searchParams.get('token')

  if (!token) {
    logger.warn(`[${requestId}] Test webhook request missing token`)
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const isValid = await verifyTestWebhookToken(token, webhookId)
  if (!isValid) {
    logger.warn(`[${requestId}] Invalid test webhook token`)
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const result = await findWebhookAndWorkflow({ requestId, webhookId })
  if (!result) {
    logger.warn(`[${requestId}] No active webhook found for id: ${webhookId}`)
    return new NextResponse('Webhook not found', { status: 404 })
  }

  const { webhook: foundWebhook, workflow: foundWorkflow } = result

  if (foundWebhook.provider === 'indicator') {
    logger.warn(`[${requestId}] Blocked external test-receiver request for indicator webhook`, {
      webhookId: foundWebhook.id,
    })
    return new NextResponse('Forbidden', { status: 403 })
  }

  const parseResult = await parseWebhookBody(request, requestId)
  if (parseResult instanceof NextResponse) {
    return parseResult
  }

  const { body, rawBody } = parseResult

  const challengeResponse = await handleProviderChallenges(body, request, requestId, '')
  if (challengeResponse) {
    return challengeResponse
  }

  const authError = await verifyProviderAuth(foundWebhook, request, rawBody, requestId)
  if (authError) {
    return authError
  }

  const rateLimitResult = await checkRateLimits(foundWorkflow, foundWebhook, requestId)
  const rateLimitError = mapDispatchGateResultToHttpResponse(rateLimitResult, foundWebhook.provider)
  if (rateLimitError) {
    return rateLimitError
  }

  logger.info(
    `[${requestId}] Executing TEST webhook for ${foundWebhook.provider} (workflow: ${foundWorkflow.id})`
  )

  return queueWebhookExecution(
    foundWebhook,
    foundWorkflow,
    body,
    request,
    {
      requestId,
      path: foundWebhook.path,
      testMode: true,
      executionTarget: 'live',
    }
  )
}
