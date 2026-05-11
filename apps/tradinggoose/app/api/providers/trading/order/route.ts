import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuthType, checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { createTradingRequestId } from '@/lib/trading/context'
import { isTradingServiceError } from '@/lib/trading/errors'
import type { TradingOrderSubmitRequest } from '@/lib/trading/order-types'
import { submitTradingOrder } from '@/lib/trading/orders'

const positiveNumberSchema = z.number().positive().finite()
const nonEmptyStringSchema = z.string().trim().min(1)

const orderListingSchema = z
  .object({
    listing_type: z.enum(['default', 'crypto', 'currency']),
    listing_id: z.string().optional(),
    base_id: z.string().optional(),
    quote_id: z.string().optional(),
  })
  .passthrough()

const portfolioIdentitySchema = z
  .object({
    providerId: nonEmptyStringSchema,
    credentialId: nonEmptyStringSchema,
    credentialServiceId: nonEmptyStringSchema,
    accountId: nonEmptyStringSchema,
  })
  .passthrough()

const orderSchema = z
  .object({
    workspaceId: nonEmptyStringSchema,
    portfolioIdentity: portfolioIdentitySchema,
    listing: orderListingSchema,
    side: z.enum(['buy', 'sell']),
    quantity: positiveNumberSchema.optional(),
    notional: positiveNumberSchema.optional(),
    orderSizingMode: z.enum(['quantity', 'notional']).optional(),
    orderType: nonEmptyStringSchema.optional(),
    timeInForce: nonEmptyStringSchema.optional(),
    limitPrice: positiveNumberSchema.optional(),
    stopPrice: positiveNumberSchema.optional(),
    trailPrice: positiveNumberSchema.optional(),
    trailPercent: positiveNumberSchema.optional(),
    orderClass: nonEmptyStringSchema.optional(),
    accessToken: nonEmptyStringSchema.optional(),
    submissionSource: z.enum(['manual', 'copilot', 'workflow']).optional(),
    logId: nonEmptyStringSchema.optional(),
  })
  .strict()

const errorResponse = (error: string, status = 400) => NextResponse.json({ error }, { status })

const parseOrderRequest = async (
  request: Request
): Promise<TradingOrderSubmitRequest | Response> => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse('Invalid request data')
  }

  const parsed = orderSchema.safeParse(body)
  return parsed.success
    ? (parsed.data as TradingOrderSubmitRequest)
    : errorResponse('Invalid request data')
}

export async function POST(request: Request) {
  const requestId = createTradingRequestId('order')
  const requestData = await parseOrderRequest(request)
  if (requestData instanceof Response) return requestData

  const auth = await checkSessionOrInternalAuth(request as NextRequest, {
    requireWorkflowId: false,
  })
  if (!auth.success || !auth.userId) {
    return errorResponse(auth.error || 'Unauthorized', 401)
  }

  try {
    const response = await submitTradingOrder({
      accessToken: auth.authType === AuthType.INTERNAL_JWT ? requestData.accessToken : undefined,
      defaultSubmissionSource: auth.authType === AuthType.SESSION ? 'manual' : undefined,
      requestData,
      requestId,
      userId: auth.userId,
    })

    return NextResponse.json(response)
  } catch (error) {
    if (isTradingServiceError(error)) {
      return errorResponse(error.message, error.status)
    }
    return errorResponse(error instanceof Error ? error.message : 'Order submission failed')
  }
}
