import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getPersonalBillingSnapshot } from '@/lib/billing/core/subscription'
import { checkInternalApiKey } from '@/lib/copilot/utils'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CopilotApiKeysValidate')

const ValidateApiKeySchema = z.object({
  userId: z.string().min(1, 'userId is required'),
})

export async function POST(req: NextRequest) {
  try {
    const auth = checkInternalApiKey(req)
    if (!auth.success) {
      return new NextResponse(null, { status: 401 })
    }

    const body = await req.json().catch(() => null)

    const validationResult = ValidateApiKeySchema.safeParse(body)

    if (!validationResult.success) {
      logger.warn('Invalid validation request', { errors: validationResult.error.errors })
      return NextResponse.json(
        {
          error: 'userId is required',
          details: validationResult.error.errors,
        },
        { status: 400 }
      )
    }

    const { userId } = validationResult.data

    logger.info('[API VALIDATION] Validating usage limit', { userId })

    const {
      isExceeded,
      currentPeriodCost: currentUsage,
      limit,
    } = await getPersonalBillingSnapshot(userId)
    const remaining = Math.max(0, limit - currentUsage)
    const payload = {
      allowed: !isExceeded,
      isExceeded,
      currentUsage,
      limit,
      remaining,
    }

    logger.info('[API VALIDATION] Usage limit validated', {
      userId,
      currentUsage,
      limit,
      remaining,
      isExceeded,
    })

    if (isExceeded) {
      logger.info('[API VALIDATION] Usage exceeded', { userId, currentUsage, limit, remaining })
      return NextResponse.json(payload, { status: 402 })
    }

    return NextResponse.json(payload, { status: 200 })
  } catch (error) {
    logger.error('Error validating usage limit', { error })
    return NextResponse.json({ error: 'Failed to validate usage' }, { status: 500 })
  }
}
