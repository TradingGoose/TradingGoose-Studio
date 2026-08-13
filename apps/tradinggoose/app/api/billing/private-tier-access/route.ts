import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { toBillingTierDisplay } from '@/lib/billing/catalog'
import {
  checkPrivateTierAccessRateLimit,
  getGrantedPrivateBillingTiers,
  grantPrivateBillingTier,
} from '@/lib/billing/private-tier-access'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('PrivateTierAccessAPI')
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' }

export const dynamic = 'force-dynamic'

async function getPrivateTiers(userId: string) {
  const tiers = await getGrantedPrivateBillingTiers(userId)
  return { privateTiers: tiers.map(toBillingTierDisplay) }
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS })
}

export async function GET() {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return json({ error: 'Unauthorized' }, 401)
    }

    return json(await getPrivateTiers(session.user.id))
  } catch (error) {
    logger.error('Failed to load private tier access', { error })
    return json({ error: 'Failed to load private tiers' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const rateLimit = await checkPrivateTierAccessRateLimit(session.user.id)
    if (!rateLimit.allowed) {
      return json(
        { error: rateLimit.error || 'Too many access-code attempts' },
        rateLimit.failureKind === 'dependency' ? 503 : 429
      )
    }

    const body = await request.json().catch(() => null)
    const accessCode = body && typeof body.accessCode === 'string' ? body.accessCode.trim() : ''

    if (!accessCode) {
      return json({ error: 'Access code is required' }, 400)
    }

    const tier = await grantPrivateBillingTier(session.user.id, accessCode)
    if (!tier) {
      return json({ error: 'Invalid access code' }, 404)
    }

    return json(await getPrivateTiers(session.user.id))
  } catch (error) {
    logger.error('Failed to grant private tier access', { error })
    return json({ error: 'Failed to validate access code' }, 500)
  }
}
