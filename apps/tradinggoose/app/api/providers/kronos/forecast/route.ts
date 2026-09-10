import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuthType, checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { isKronosEnabled, callKronosForecast, KronosError, KronosErrorCode } from '@/lib/kronos'
import { ForecastRequest } from '@/lib/kronos/types'

const logger = createLogger('KronosForecastRoute')

const nonEmptyStringSchema = z.string().trim().min(1)

const forecastRequestSchema = z
  .object({
    workspaceId: nonEmptyStringSchema,
    idempotencyKey: nonEmptyStringSchema,
    listing: z.unknown(),
    marketSeries: z.unknown(),
    interval: nonEmptyStringSchema,
    timezone: nonEmptyStringSchema,
    normalizationMode: nonEmptyStringSchema.optional(),
    horizonBars: z.number().int().positive().finite(),
    parameters: z
      .object({
        temperature: z.number().positive().max(5).optional(),
        topP: z.number().positive().max(1).optional(),
        sampleCount: z.number().int().positive().optional(),
      })
      .optional(),
  })
  .strict()

const parseRequestBody = async (
  request: NextRequest
): Promise<z.infer<typeof forecastRequestSchema> | Response> => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request data' }, { status: 400 })
  }

  const parsed = forecastRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request data', details: parsed.error.issues },
      { status: 400 }
    )
  }
  return parsed.data
}

const mapKronosError = (error: KronosError): Response => {
  switch (error.code) {
    case KronosErrorCode.DISABLED:
      return NextResponse.json({ error: error.message }, { status: 404 })
    case KronosErrorCode.UNAVAILABLE:
      return NextResponse.json({ error: error.message }, { status: 503 })
    case KronosErrorCode.TIMEOUT:
      return NextResponse.json({ error: error.message }, { status: 504 })
    case KronosErrorCode.HORIZON_EXCEEDED:
    case KronosErrorCode.TOO_FEW_BARS:
    case KronosErrorCode.TOO_MANY_BARS:
      return NextResponse.json({ error: error.message }, { status: 422 })
    default:
      return NextResponse.json({ error: error.message }, { status: 502 })
  }
}

export async function POST(request: NextRequest) {
  if (!isKronosEnabled()) {
    return NextResponse.json(
      { error: 'Kronos forecasting is not enabled' },
      { status: 404 }
    )
  }

  const requestId = generateRequestId('kronos-forecast')
  const requestData = await parseRequestBody(request)
  if (requestData instanceof Response) return requestData

  const auth = await checkSessionOrInternalAuth(request, {
    requireWorkflowId: false,
  })
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const response = await callKronosForecast(requestData as unknown as ForecastRequest)

    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof KronosError) {
      return mapKronosError(error)
    }
    logger.error('Kronos forecast failed', { requestId, error })
    return NextResponse.json({ error: 'Kronos forecast failed' }, { status: 502 })
  }
}
