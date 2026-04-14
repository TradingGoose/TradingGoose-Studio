import { db } from '@tradinggoose/db'
import { member, organization } from '@tradinggoose/db/schema'
import { and, eq, or } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getEffectiveSubscription } from '@/lib/billing/core/subscription'
import { createOrganizationForOrganizationTier } from '@/lib/billing/organization'
import { getBillingGateState } from '@/lib/billing/settings'
import { createLogger } from '@/lib/logs/console/logger'
import { getOrganizationAccessState } from '@/lib/organization/access'

const logger = createLogger('OrganizationsAPI')
const ORGANIZATION_CREATION_FORBIDDEN_ERROR =
  'Organization creation is not enabled for this billing tier.'

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

export async function POST(request: Request) {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized - no active session' }, { status: 401 })
    }

    const user = session.user

    // Parse request body for optional name and slug
    let organizationName = user.name
    let organizationSlug: string | undefined

    try {
      const body = await request.json()
      if (body.name && typeof body.name === 'string') {
        organizationName = body.name
      }
      if (body.slug && typeof body.slug === 'string') {
        organizationSlug = body.slug
      }
    } catch {
      // If no body or invalid JSON, use defaults
    }

    logger.info('Creating organization', {
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      organizationName,
      organizationSlug,
    })

    const existingOrgMembership = await db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.userId, user.id))
      .limit(1)

    if (existingOrgMembership.length > 0) {
      return NextResponse.json(
        {
          error:
            'You are already a member of an organization. Leave your current organization before creating a new one.',
        },
        { status: 409 }
      )
    }

    const [{ billingEnabled }, personalSubscription] = await Promise.all([
      getBillingGateState(),
      getEffectiveSubscription(user.id),
    ])
    const access = getOrganizationAccessState({
      billingEnabled,
      hasOrganization: false,
      isOrganizationAdmin: false,
      userTier: personalSubscription?.tier,
    })

    if (!access.canCreateOrganization) {
      return NextResponse.json(
        { error: ORGANIZATION_CREATION_FORBIDDEN_ERROR },
        { status: 403 }
      )
    }

    const organizationId = await createOrganizationForOrganizationTier(
      user.id,
      organizationName || undefined,
      user.email || undefined,
      organizationSlug
    )

    logger.info('Successfully created organization', {
      userId: user.id,
      organizationId,
    })

    return NextResponse.json({
      success: true,
      organizationId,
    })
  } catch (error) {
    logger.error('Failed to create organization', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json(
      {
        error: 'Failed to create organization',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
