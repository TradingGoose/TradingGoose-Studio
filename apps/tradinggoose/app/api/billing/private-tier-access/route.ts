import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getModalEnterpriseContactCard } from '@/lib/billing/catalog'
import { toSubscriptionTierDisplay } from '@/lib/billing/subscription-tier-display'
import {
  getPrivateBillingTiersForUser,
  grantPrivateBillingTierAccessByCode,
} from '@/lib/billing/tiers'

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

export async function POST(request: Request) {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStoreHeaders })
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
