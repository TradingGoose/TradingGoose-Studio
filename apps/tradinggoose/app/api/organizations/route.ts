import { FinancialPolicyError } from '@tradinggoose/billing'
import { db } from '@tradinggoose/db'
import { member, organization } from '@tradinggoose/db/schema'
import { and, eq, or } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createOrganizationWithFinancialRegistration } from '@/lib/billing/financial-membership'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('OrganizationsAPI')

export async function POST(request: Request) {
  try {
    const session = await getSession()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const body = await request.json().catch(() => null)
    if (
      !body ||
      typeof body.name !== 'string' ||
      !body.name.trim() ||
      typeof body.slug !== 'string' ||
      !/^[a-z0-9_-]+$/.test(body.slug)
    )
      return NextResponse.json(
        { error: 'Valid organization name and slug are required' },
        { status: 400 }
      )
    const organizationId = await createOrganizationWithFinancialRegistration({
      actorUserId: session.user.id,
      name: body.name.trim(),
      slug: body.slug,
    })
    return NextResponse.json({ success: true, organizationId })
  } catch (error) {
    if (error instanceof FinancialPolicyError)
      return NextResponse.json({ error: error.message }, { status: error.status })
    logger.error('Failed to create organization', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get organizations where user is owner or admin
    const userOrganizations = await db
      .select({
        id: organization.id,
        name: organization.name,
        role: member.role,
      })
      .from(member)
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .where(
        and(
          eq(member.userId, session.user.id),
          or(eq(member.role, 'owner'), eq(member.role, 'admin'))
        )
      )

    const anyMembership = await db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.userId, session.user.id))
      .limit(1)

    return NextResponse.json({
      organizations: userOrganizations,
      isMemberOfAnyOrg: anyMembership.length > 0,
    })
  } catch (error) {
    logger.error('Failed to fetch organizations', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
