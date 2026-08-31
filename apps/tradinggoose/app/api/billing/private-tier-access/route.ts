import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { toBillingTierDisplay } from '@/lib/billing/catalog'
import {
  checkPrivateTierAccessRateLimit,
  getGrantedPrivateBillingTiers,
  grantPrivateBillingTier,
} from '@/lib/billing/private-tier-access'
import { PRIVATE_TIER_ACCESS_ERROR_CODES } from '@/lib/billing/private-tier-access-contract'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('PrivateTierAccessAPI')
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' }

export const dynamic = 'force-dynamic'

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS })
}

export async function GET() {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return json({ code: PRIVATE_TIER_ACCESS_ERROR_CODES.unauthorized }, 401)
    }

    const tiers = await getGrantedPrivateBillingTiers(session.user.id)
    return json({ privateTiers: tiers.map(toBillingTierDisplay) })
  } catch (error) {
    logger.error('Failed to load private tier access', { error })
    return json({ code: PRIVATE_TIER_ACCESS_ERROR_CODES.loadFailed }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return json({ code: PRIVATE_TIER_ACCESS_ERROR_CODES.unauthorized }, 401)
    }

    const rateLimit = await checkPrivateTierAccessRateLimit(session.user.id)
    if (!rateLimit.allowed) {
      const isUnavailable = rateLimit.failureKind === 'dependency'
      return json(
        {
          code: isUnavailable
            ? PRIVATE_TIER_ACCESS_ERROR_CODES.unavailable
            : PRIVATE_TIER_ACCESS_ERROR_CODES.rateLimited,
        },
        isUnavailable ? 503 : 429
      )
    }

    const body = await request.json().catch(() => null)
    const accessCode = body && typeof body.accessCode === 'string' ? body.accessCode.trim() : ''

    if (!accessCode) {
      return json({ code: PRIVATE_TIER_ACCESS_ERROR_CODES.required }, 400)
    }

    const tier = await grantPrivateBillingTier(session.user.id, accessCode)
    if (!tier) {
      return json({ code: PRIVATE_TIER_ACCESS_ERROR_CODES.invalid }, 404)
    }

    return new Response(null, { status: 204, headers: NO_STORE_HEADERS })
  } catch (error) {
    logger.error('Failed to grant private tier access', { error })
    return json({ code: PRIVATE_TIER_ACCESS_ERROR_CODES.validateFailed }, 500)
  }
}
