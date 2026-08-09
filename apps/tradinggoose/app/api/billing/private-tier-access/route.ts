import { type NextRequest, NextResponse } from 'next/server'
import { getTranslations } from 'next-intl/server'
import { checkPrivateTierAccessCodeRateLimit } from '@/lib/api/rate-limit'
import { getSession } from '@/lib/auth'
import { getModalEnterpriseContactCard } from '@/lib/billing/catalog'
import { toSubscriptionTierDisplay } from '@/lib/billing/subscription-tier-display'
import {
  getPrivateBillingTiersForUser,
  grantPrivateBillingTierAccessByCode,
} from '@/lib/billing/tiers'
import { resolveRequestLocale } from '@/i18n/request-locale'

export const dynamic = 'force-dynamic'

const noStoreHeaders = { 'Cache-Control': 'no-store' }

async function getResponse(userId: string) {
  const [tiers, enterpriseContactCard] = await Promise.all([
    getPrivateBillingTiersForUser(userId),
    getModalEnterpriseContactCard(),
  ])
  return NextResponse.json(
    {
      privateTiers: tiers.map((tier) => toSubscriptionTierDisplay(tier)),
      enterpriseContactCard,
    },
    { headers: noStoreHeaders }
  )
}

export async function GET() {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStoreHeaders })
  }
  return getResponse(session.user.id)
}

function getRetryAfterSeconds(resetAt: Date) {
  return Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000)).toString()
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStoreHeaders })
  }

  const rateLimit = await checkPrivateTierAccessCodeRateLimit(session.user.id)
  if (!rateLimit.allowed) {
    const headers = {
      ...noStoreHeaders,
      'Retry-After': getRetryAfterSeconds(rateLimit.resetAt),
    }
    if (rateLimit.failureKind === 'dependency') {
      return NextResponse.json(
        { error: 'Access-code validation is temporarily unavailable' },
        { status: 503, headers }
      )
    }
    const locale = resolveRequestLocale(request)
    const t = await getTranslations({
      locale,
      namespace: 'workspace.settingsModal.subscription.privateAccess',
    })
    return NextResponse.json({ error: t('tooManyAttempts') }, { status: 429, headers })
  }

  const body = await request.json().catch(() => null)
  const accessCode =
    body && typeof body === 'object' && typeof body.accessCode === 'string'
      ? body.accessCode.trim()
      : ''
  if (!accessCode) {
    return NextResponse.json(
      { error: 'Access code is required' },
      { status: 400, headers: noStoreHeaders }
    )
  }
  const result = await grantPrivateBillingTierAccessByCode(session.user.id, accessCode)
  if (!result.ok) {
    return NextResponse.json(
      { error: 'Invalid access code' },
      { status: 404, headers: noStoreHeaders }
    )
  }
  return getResponse(session.user.id)
}
