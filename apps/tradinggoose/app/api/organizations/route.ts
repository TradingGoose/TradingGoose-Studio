import { db } from '@tradinggoose/db'
import { member, organization } from '@tradinggoose/db/schema'
import { and, eq, or } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { hasOrganizationMembership } from '@/lib/billing/core/organization'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('OrganizationsAPI')

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

    return NextResponse.json({
      organizations: userOrganizations,
      isMemberOfAnyOrg: await hasOrganizationMembership(session.user.id),
    })
  } catch (error) {
    logger.error('Failed to fetch organizations', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
