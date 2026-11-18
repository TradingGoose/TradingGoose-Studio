import { db } from '@tradinggoose/db'
import { member, user, userStats } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getOrganizationBillingData } from '@/lib/billing/core/organization'
import { getUserUsageData } from '@/lib/billing/core/usage'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('OrganizationMembersAPI')

/**
 * GET /api/organizations/[id]/members
 * Get organization members with optional usage data
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: organizationId } = await params
    const url = new URL(request.url)
    const includeUsage = url.searchParams.get('include') === 'usage'

    // Verify user has access to this organization
    const memberEntry = await db
      .select()
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
      .limit(1)

    if (memberEntry.length === 0) {
      return NextResponse.json(
        { error: 'Forbidden - Not a member of this organization' },
        { status: 403 }
      )
    }

    const userRole = memberEntry[0].role
    const hasAdminAccess = ['owner', 'admin'].includes(userRole)

    // Get organization members
    const query = db
      .select({
        id: member.id,
        userId: member.userId,
        organizationId: member.organizationId,
        role: member.role,
        createdAt: member.createdAt,
        userName: user.name,
        userEmail: user.email,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(member.organizationId, organizationId))

    // Include usage data if requested and user has admin access
    if (includeUsage && hasAdminAccess) {
      const base = await db
        .select({
          id: member.id,
          userId: member.userId,
          organizationId: member.organizationId,
          role: member.role,
          createdAt: member.createdAt,
          userName: user.name,
          userEmail: user.email,
          currentPeriodCost: userStats.currentPeriodCost,
          customUsageLimit: userStats.customUsageLimit,
          customUsageLimitUpdatedAt: userStats.customUsageLimitUpdatedAt,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .leftJoin(userStats, eq(user.id, userStats.userId))
        .where(eq(member.organizationId, organizationId))

      const organizationBillingData = await getOrganizationBillingData(organizationId)

      if (organizationBillingData?.subscriptionTier) {
        const usageScope = organizationBillingData.subscriptionTier.usageScope
        const memberUsageByUserId = new Map(
          organizationBillingData.members.map((organizationMember) => [
            organizationMember.userId,
            organizationMember.currentUsage,
          ])
        )
        const billingPeriodStart = organizationBillingData.billingPeriodStart
        const billingPeriodEnd = organizationBillingData.billingPeriodEnd
        const sharedCurrentPeriodCost =
          usageScope === 'pooled' ? organizationBillingData.totalCurrentUsage : null

        const membersWithUsage = base.map((row) => ({
          ...row,
          currentPeriodCost:
            usageScope === 'individual' ? (memberUsageByUserId.get(row.userId) ?? 0) : null,
          billingPeriodStart,
          billingPeriodEnd,
        }))

        return NextResponse.json({
          success: true,
          data: membersWithUsage,
          total: membersWithUsage.length,
          userRole,
          hasAdminAccess,
          usageScope,
          sharedCurrentPeriodCost,
        })
      }

      const membersWithUsage = await Promise.all(
        base.map(async (row) => {
          const usage = await getUserUsageData(row.userId)
          return {
            ...row,
            billingPeriodStart: usage.billingPeriodStart,
            billingPeriodEnd: usage.billingPeriodEnd,
          }
        })
      )

      return NextResponse.json({
        success: true,
        data: membersWithUsage,
        total: membersWithUsage.length,
        userRole,
        hasAdminAccess,
      })
    }

    const members = await query

    return NextResponse.json({
      success: true,
      data: members,
      total: members.length,
      userRole,
      hasAdminAccess,
    })
  } catch (error) {
    logger.error('Failed to get organization members', {
      organizationId: (await params).id,
      error,
    })

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
