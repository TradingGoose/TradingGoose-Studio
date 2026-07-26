import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { isBillingEnabledForRuntime } from '@/lib/billing/settings'
import {
  calculateCopilotReservationUsdFromEstimate,
  recordCopilotCompletionUsage,
} from '@/lib/copilot/completion-usage-billing'
import { COPILOT_RUNTIME_MODELS } from '@/lib/copilot/runtime-models'
import { COPILOT_RUNTIME_PROVIDER_IDS } from '@/lib/copilot/runtime-provider'
import { buildCopilotRuntimeProviderConfig } from '@/lib/copilot/runtime-provider.server'
import {
  commitCopilotUsageReservation,
  releaseCopilotUsageReservation,
  reserveCopilotUsage,
} from '@/lib/copilot/usage-reservations'
import { checkInternalApiKey } from '@/lib/copilot/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { getCopilotApiUrl, proxyCopilotRequest } from '@/app/api/copilot/proxy'

const BILLING_DISABLED_RESERVATION_ID = 'billing-disabled'
const logger = createLogger('CopilotUsageAPI')

const ContextUsageRequestSchema = z.object({
  kind: z.literal('context'),
  conversationId: z.string(),
  model: z.enum(COPILOT_RUNTIME_MODELS),
  workflowId: z.string().optional(),
  workspaceId: z.string().optional(),
  provider: z.enum(COPILOT_RUNTIME_PROVIDER_IDS).optional(),
})

const UsageEstimateSchema = z.object({
  model: z.string().min(1, 'model is required'),
  estimatedPromptTokens: z.number().int().nonnegative(),
  reservedCompletionTokens: z.number().int().nonnegative(),
})

const ReserveUsageUsdRequestSchema = z.object({
  action: z.literal('reserve'),
  userId: z.string().min(1, 'userId is required'),
  workflowId: z.string().min(1).optional(),
  requestedUsd: z.number().positive('requestedUsd must be positive'),
  reason: z.string().min(1).optional(),
})

const ReserveUsageEstimatedRequestSchema = z
  .object({
    action: z.literal('reserve'),
    userId: z.string().min(1, 'userId is required'),
    workflowId: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
  })
  .merge(UsageEstimateSchema)

const ReserveUsageRequestSchema = z.union([
  ReserveUsageUsdRequestSchema,
  ReserveUsageEstimatedRequestSchema,
])

const CompletionCommitRequestSchema = z.object({
  action: z.literal('commit'),
  kind: z.literal('completion'),
  userId: z.string().min(1, 'userId is required'),
  model: z.string().min(1, 'model is required'),
  usage: z.unknown(),
  remoteModel: z.string().optional(),
  completionId: z.string().min(1).optional(),
  workflowId: z.string().min(1).optional(),
  reservationId: z.string().min(1).optional(),
})

const ReleaseUsageRequestSchema = z.object({
  action: z.literal('release'),
  reservationId: z.string().min(1, 'reservationId is required'),
})

async function fetchContextUsageFromCopilot(params: {
  conversationId: string
  model: z.infer<typeof ContextUsageRequestSchema>['model']
  workflowId?: string
  workspaceId?: string
  provider?: z.infer<typeof ContextUsageRequestSchema>['provider']
  userId: string
}) {
  const { conversationId, model, workflowId, workspaceId, provider, userId } = params
  const { providerConfig } = await buildCopilotRuntimeProviderConfig({
    model,
    provider,
  })

  const requestPayload = {
    conversationId,
    model,
    userId,
    ...(workflowId ? { workflowId } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    provider: providerConfig,
  }

  logger.info('[Usage API] Calling copilot for context usage', {
    url: await getCopilotApiUrl('/api/get-context-usage'),
    payload: requestPayload,
  })

  return proxyCopilotRequest({
    endpoint: '/api/get-context-usage',
    body: requestPayload,
  })
}

async function handleContextUsage(
  payload: z.infer<typeof ContextUsageRequestSchema>
): Promise<NextResponse> {
  const { conversationId, model, workflowId, workspaceId, provider } = payload
  const session = await getSession()
  const userId = session?.user?.id

  if (!userId) {
    logger.warn('[Usage API] No session/user ID for context usage')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const simAgentResponse = await fetchContextUsageFromCopilot({
    conversationId,
    model,
    workflowId,
    workspaceId,
    provider,
    userId,
  })

  if (!simAgentResponse.ok) {
    const errorText = await simAgentResponse.text().catch(() => '')
    logger.warn('[Usage API] TradingGoose agent request failed', {
      status: simAgentResponse.status,
      error: errorText,
    })
    return NextResponse.json(
      { error: 'Failed to fetch context usage from copilot' },
      { status: simAgentResponse.status }
    )
  }

  const data = await simAgentResponse.json()
  return NextResponse.json(data)
}

function buildBillingDisabledReservation(params: { userId: string; reservationId?: string }) {
  return {
    allowed: true,
    status: 200,
    reservationId: params.reservationId ?? BILLING_DISABLED_RESERVATION_ID,
    reservedUsd: 0,
    currentUsage: 0,
    limit: Number.MAX_SAFE_INTEGER,
    remaining: Number.MAX_SAFE_INTEGER,
    activeReservedUsd: 0,
    scopeType: 'user' as const,
    scopeId: params.userId,
  }
}

async function handleReserveUsage(
  req: NextRequest,
  payload: z.infer<typeof ReserveUsageRequestSchema>
): Promise<NextResponse> {
  const auth = checkInternalApiKey(req)
  if (!auth.success) {
    return new NextResponse(null, { status: 401 })
  }

  if (!(await isBillingEnabledForRuntime())) {
    return NextResponse.json(buildBillingDisabledReservation({ userId: payload.userId }))
  }

  const requestedUsd =
    'requestedUsd' in payload
      ? payload.requestedUsd
      : await calculateCopilotReservationUsdFromEstimate({
          userId: payload.userId,
          workflowId: payload.workflowId,
          model: payload.model,
          estimatedPromptTokens: payload.estimatedPromptTokens,
          reservedCompletionTokens: payload.reservedCompletionTokens,
        })

  const result = await reserveCopilotUsage({
    userId: payload.userId,
    workflowId: payload.workflowId,
    requestedUsd,
    reason: payload.reason,
  })

  return NextResponse.json(result, { status: result.status })
}

async function handleCompletionCommit(
  payload: z.infer<typeof CompletionCommitRequestSchema>
): Promise<NextResponse> {
  return await commitCopilotUsageReservation({
    userId: payload.userId,
    workflowId: payload.workflowId,
    reservationId:
      payload.reservationId === BILLING_DISABLED_RESERVATION_ID ? undefined : payload.reservationId,
    operation: async () => {
      if (!(await isBillingEnabledForRuntime())) {
        return NextResponse.json({
          success: true,
          billing: { billed: false, reason: 'billing_disabled' },
        })
      }

      const billing = await recordCopilotCompletionUsage({
        userId: payload.userId,
        workflowId: payload.workflowId,
        usage: payload.usage,
        billingModel: payload.model,
        billingKeyId: payload.completionId,
      })

      return NextResponse.json({
        success: true,
        billing,
      })
    },
  })
}

async function handleReleaseUsage(
  req: NextRequest,
  payload: z.infer<typeof ReleaseUsageRequestSchema>
): Promise<NextResponse> {
  const auth = checkInternalApiKey(req)
  if (!auth.success) {
    return new NextResponse(null, { status: 401 })
  }

  if (payload.reservationId === BILLING_DISABLED_RESERVATION_ID) {
    return NextResponse.json({
      released: true,
      reservationId: payload.reservationId,
    })
  }

  const result = await releaseCopilotUsageReservation({
    reservationId: payload.reservationId,
  })

  return NextResponse.json(result)
}

/**
 * POST /api/copilot/usage
 * Unified copilot usage endpoint for context inspection, reservation control, and completion billing.
 */
export async function POST(req: NextRequest) {
  try {
    const text = await req.text()
    if (!text) {
      return NextResponse.json({ error: 'Empty request body' }, { status: 400 })
    }

    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const action =
      body && typeof body === 'object' ? (body as Record<string, unknown>).action : null
    if (action === 'reserve') {
      const parsed = ReserveUsageRequestSchema.safeParse(body)
      if (!parsed.success) {
        logger.warn('Invalid copilot usage reserve request', { errors: parsed.error.issues })
        return NextResponse.json(
          {
            error: 'Invalid request body',
            details: parsed.error.issues,
          },
          { status: 400 }
        )
      }
      return await handleReserveUsage(req, parsed.data)
    }

    if (action === 'commit') {
      const auth = checkInternalApiKey(req)
      if (!auth.success) {
        return new NextResponse(null, { status: 401 })
      }

      const parsed = CompletionCommitRequestSchema.safeParse(body)
      if (!parsed.success) {
        logger.warn('Invalid copilot usage commit request', { errors: parsed.error.issues })
        return NextResponse.json(
          {
            error: 'Invalid request body',
            details: parsed.error.issues,
          },
          { status: 400 }
        )
      }

      return await handleCompletionCommit(parsed.data)
    }

    if (action === 'release') {
      const parsed = ReleaseUsageRequestSchema.safeParse(body)
      if (!parsed.success) {
        logger.warn('Invalid copilot usage release request', { errors: parsed.error.issues })
        return NextResponse.json(
          {
            error: 'Invalid request body',
            details: parsed.error.issues,
          },
          { status: 400 }
        )
      }
      return await handleReleaseUsage(req, parsed.data)
    }

    const parsed = ContextUsageRequestSchema.safeParse(body)

    if (!parsed.success) {
      logger.warn('Invalid copilot usage request', { errors: parsed.error.issues })
      return NextResponse.json(
        {
          error: 'Invalid request body',
          details: parsed.error.issues,
        },
        { status: 400 }
      )
    }

    return await handleContextUsage(parsed.data)
  } catch (error) {
    logger.error('Failed to process copilot usage request', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
