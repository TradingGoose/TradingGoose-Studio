import { db } from '@tradinggoose/db'
import { member, userStats } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getSimplifiedBillingSummary } from '@/lib/billing/core/billing'
import { getOrganizationBillingData } from '@/lib/billing/core/organization'
import { getResolvedBillingSettings } from '@/lib/billing/settings'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('UnifiedBillingAPI')

type OrganizationBillingPayload = NonNullable<
  Awaited<ReturnType<typeof getOrganizationBillingData>>
>
type SessionWithActiveOrganization = {
  activeOrganizationId?: string | null
}

async function getOrganizationMemberRole(organizationId: string, userId: string) {
  const memberRecord = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1)

  return memberRecord[0]?.role ?? null
}

function toOrganizationBillingPayload(
  rawBillingData: OrganizationBillingPayload,
  billingEnabled: boolean
) {
  return {
    organizationId: rawBillingData.organizationId,
    organizationName: rawBillingData.organizationName,
    billingEnabled,
    subscriptionTier: rawBillingData.subscriptionTier,
    subscriptionStatus: rawBillingData.subscriptionStatus,
    seatPriceUsd: rawBillingData.seatPriceUsd,
    seatCount: rawBillingData.seatCount,
    seatMaximum: rawBillingData.seatMaximum,
    seatMode: rawBillingData.seatMode,
    totalSeats: rawBillingData.totalSeats,
    usedSeats: rawBillingData.usedSeats,
    seatsCount: rawBillingData.seatsCount,
    totalCurrentUsage: rawBillingData.totalCurrentUsage,
    totalUsageLimit: rawBillingData.totalUsageLimit,
    warningThresholdPercent: rawBillingData.warningThresholdPercent,
    minimumUsageLimit: rawBillingData.minimumUsageLimit,
    averageUsagePerMember: rawBillingData.averageUsagePerMember,
    billingPeriodStart: rawBillingData.billingPeriodStart?.toISOString() || null,
    billingPeriodEnd: rawBillingData.billingPeriodEnd?.toISOString() || null,
    members: rawBillingData.members.map((member) => ({
      ...member,
      joinedAt: member.joinedAt.toISOString(),
      lastActive: member.lastActive?.toISOString() || null,
    })),
    billingBlocked: rawBillingData.billingBlocked,
  }
}

/**
 * Unified Billing Endpoint
 */
export async function GET(request: NextRequest) {
  const session = await getSession()

  try {
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const context = searchParams.get('context') || 'user'
    const contextId = searchParams.get('id')

    // Validate context parameter
    if (!['user', 'organization'].includes(context)) {
      return NextResponse.json(
        { error: 'Invalid context. Must be "user" or "organization"' },
        { status: 400 }
      )
    }

    // For organization context, require contextId
    if (context === 'organization' && !contextId) {
      return NextResponse.json(
        { error: 'Organization ID is required when context=organization' },
        { status: 400 }
      )
    }

    const { billingEnabled } = await getResolvedBillingSettings()
    let billingData

    if (context === 'user') {
      const activeOrganizationId = (session.session as SessionWithActiveOrganization | undefined)
        ?.activeOrganizationId

      if (activeOrganizationId) {
        const [userRole, rawOrganizationBillingData] = await Promise.all([
          getOrganizationMemberRole(activeOrganizationId, session.user.id),
          getOrganizationBillingData(activeOrganizationId),
        ])

        if (userRole && rawOrganizationBillingData) {
          billingData = toOrganizationBillingPayload(rawOrganizationBillingData, billingEnabled)

          return NextResponse.json({
            success: true,
            context,
            billingEnabled,
            data: billingData,
            userRole,
            billingBlocked: billingData.billingBlocked,
          })
        }
      }

      // Fall back to the caller's personal billing account when no active organization
      // billing subscription applies to the current session.
      billingData = await getSimplifiedBillingSummary(session.user.id)
      const stats = await db
        .select({ blocked: userStats.billingBlocked })
        .from(userStats)
        .where(eq(userStats.userId, session.user.id))
        .limit(1)
      billingData = {
        ...billingData,
        billingEnabled,
        billingBlocked: stats.length > 0 ? !!stats[0].blocked : false,
      }
    } else {
      const userRole = await getOrganizationMemberRole(contextId!, session.user.id)

      if (!userRole) {
        return NextResponse.json(
          { error: 'Access denied - not a member of this organization' },
          { status: 403 }
        )
      }

      // Get organization-specific billing
      const rawBillingData = await getOrganizationBillingData(contextId!)

      if (!rawBillingData) {
        return NextResponse.json(
          { error: 'Organization not found or access denied' },
          { status: 404 }
        )
      }

      billingData = toOrganizationBillingPayload(rawBillingData, billingEnabled)

      return NextResponse.json({
        success: true,
        context,
        billingEnabled,
        data: billingData,
        userRole,
        billingBlocked: billingData.billingBlocked,
      })
    }

    return NextResponse.json({
      success: true,
      context,
      billingEnabled,
      data: billingData,
    })
  } catch (error) {
    logger.error('Failed to get billing data', {
      userId: session?.user?.id,
      error,
    })

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
