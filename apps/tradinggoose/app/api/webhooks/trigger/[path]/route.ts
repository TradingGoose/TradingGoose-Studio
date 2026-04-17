import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import {
  checkRateLimits,
  checkUsageLimits,
  findWebhookAndWorkflow,
  handleProviderChallenges,
  mapDispatchGateResultToHttpResponse,
  parseWebhookBody,
  queueWebhookExecution,
  verifyProviderAuth,
} from '@/lib/webhooks/processor'
import { blockExistsInDeployment } from '@/lib/workflows/db-helpers'

const logger = createLogger('WebhookTriggerAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string }> }) {
  const requestId = generateRequestId()
  const { path } = await params

  const findResult = await findWebhookAndWorkflow({ requestId, path })
  if (!findResult) {
    logger.warn(`[${requestId}] Webhook or workflow not found for path: ${path}`)
    return new NextResponse('Not Found', { status: 404 })
  }

  const { webhook: foundWebhook } = findResult

  if (foundWebhook.provider === 'indicator') {
    logger.warn(`[${requestId}] Blocked external trigger request for indicator webhook`, {
      path,
      webhookId: foundWebhook.id,
    })
    return new NextResponse('Forbidden', { status: 403 })
  }

  const url = new URL(request.url)
  const validationToken = url.searchParams.get('validationToken')
  if (validationToken) {
    logger.info(`[${requestId}] Microsoft Graph subscription validation for path: ${path}`)
    return new NextResponse(validationToken, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  const challengeResponse = await handleProviderChallenges({}, request, requestId, path)
  if (challengeResponse) {
    return challengeResponse
  }

  return new NextResponse('Method not allowed', { status: 405 })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string }> }
) {
  const requestId = generateRequestId()
  const { path } = await params

  const findResult = await findWebhookAndWorkflow({ requestId, path })

  if (!findResult) {
    logger.warn(`[${requestId}] Webhook or workflow not found for path: ${path}`)
    return new NextResponse('Not Found', { status: 404 })
  }

  const { webhook: foundWebhook, workflow: foundWorkflow } = findResult

  if (foundWebhook.provider === 'indicator') {
    logger.warn(`[${requestId}] Blocked external trigger request for indicator webhook`, {
      path,
      webhookId: foundWebhook.id,
    })
    return new NextResponse('Forbidden', { status: 403 })
  }

  try {
    const url = new URL(request.url)
    const validationToken = url.searchParams.get('validationToken')
    if (validationToken) {
      logger.info(`[${requestId}] Microsoft Graph subscription validation (POST) for path: ${path}`)
      return new NextResponse(validationToken, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }
  } catch {
    // ignore URL parsing errors; proceed to standard body processing
  }

  const parseResult = await parseWebhookBody(request, requestId)
  if (parseResult instanceof NextResponse) {
    return parseResult
  }

  const { body, rawBody } = parseResult

  const challengeResponse = await handleProviderChallenges(body, request, requestId, path)
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

  const usageLimitResult = await checkUsageLimits(foundWorkflow, foundWebhook, requestId, false)
  const usageLimitError = mapDispatchGateResultToHttpResponse(
    usageLimitResult,
    foundWebhook.provider
  )
  if (usageLimitError) {
    return usageLimitError
  }

  if (foundWebhook.blockId) {
    const blockExists = await blockExistsInDeployment(foundWorkflow.id, foundWebhook.blockId)
    if (!blockExists) {
      logger.warn(
        `[${requestId}] Trigger block ${foundWebhook.blockId} not found in deployment for workflow ${foundWorkflow.id}`
      )
      return new NextResponse('Trigger block not deployed', { status: 404 })
    }
  }

  return queueWebhookExecution(
    foundWebhook,
    foundWorkflow,
    body,
    request,
    {
      requestId,
      path,
      testMode: false,
      executionTarget: 'deployed',
    }
  )
}
