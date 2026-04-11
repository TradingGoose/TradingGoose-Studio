import { db, member, permissions, user, workspace } from '@tradinggoose/db'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getManageableWorkspaces, hasWorkspaceAdminAccess } from '@/lib/permissions/utils'
import {
  resolveWorkspaceBillingOwnerUpdate,
  toWorkspaceApiRecord,
} from '@/lib/workspaces/billing-owner'

const logger = createLogger('OrganizationWorkspacesAPI')

const assignOrganizationWorkspaceSchema = z.object({
  workspaceId: z.string().trim().min(1, 'Workspace is required'),
})

const releaseOrganizationWorkspaceSchema = z.object({
  workspaceId: z.string().trim().min(1, 'Workspace is required'),
})

async function getOrganizationMembership(userId: string, organizationId: string) {
  const rows = await db
    .select({
      id: member.id,
      role: member.role,
    })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1)

  return rows[0] ?? null
}

/**
 * GET /api/organizations/[id]/workspaces
 * Query parameters:
 * - ?available=true - Workspaces the current user can attach to this organization for billing
 * - ?member=userId - Organization-billed workspaces where a specific member has access
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: organizationId } = await params
    const url = new URL(request.url)
    const availableOnly = url.searchParams.get('available') === 'true'
    const memberId = url.searchParams.get('member')

    const membership = await getOrganizationMembership(session.user.id, organizationId)
    if (!membership) {
      return NextResponse.json(
        {
          error: 'Forbidden - Not a member of this organization',
        },
        { status: 403 }
      )
    }

    const hasAdminAccess = membership.role === 'owner' || membership.role === 'admin'

    if (availableOnly) {
      if (!hasAdminAccess) {
        return NextResponse.json(
          { error: 'Only organization admins can manage organization-billed workspaces' },
          { status: 403 }
        )
      }

      const manageableWorkspaces = await getManageableWorkspaces(session.user.id)
      if (manageableWorkspaces.length === 0) {
        return NextResponse.json({
          success: true,
          data: {
            workspaces: [],
            totalCount: 0,
            filter: 'available',
          },
        })
      }

      const manageableWorkspaceIds = manageableWorkspaces.map((item) => item.id)
      const manageableWorkspaceOwnerIds = Array.from(
        new Set(manageableWorkspaces.map((item) => item.ownerId))
      )

      const [workspaceRows, organizationOwnerMemberships] = await Promise.all([
        db
          .select({
            id: workspace.id,
            name: workspace.name,
            ownerId: workspace.ownerId,
            billingOwnerType: workspace.billingOwnerType,
            billingOwnerUserId: workspace.billingOwnerUserId,
            billingOwnerOrganizationId: workspace.billingOwnerOrganizationId,
            createdAt: workspace.createdAt,
          })
          .from(workspace)
          .where(inArray(workspace.id, manageableWorkspaceIds)),
        db
          .select({ userId: member.userId })
          .from(member)
          .where(
            and(
              eq(member.organizationId, organizationId),
              inArray(member.userId, manageableWorkspaceOwnerIds)
            )
          ),
      ])

      const organizationOwnerIds = new Set(organizationOwnerMemberships.map((row) => row.userId))

      const availableWorkspaces = workspaceRows
        .filter((workspaceRow) => {
          if (!organizationOwnerIds.has(workspaceRow.ownerId)) {
            return false
          }

          return workspaceRow.billingOwnerType === 'user'
        })
        .map((workspaceRow) => ({
          ...toWorkspaceApiRecord(workspaceRow),
          isOwner: workspaceRow.ownerId === session.user.id,
          canInvite: true,
        }))

      logger.info('Retrieved organization-assignable workspaces', {
        organizationId,
        userId: session.user.id,
        workspaceCount: availableWorkspaces.length,
      })

      return NextResponse.json({
        success: true,
        data: {
          workspaces: availableWorkspaces,
          totalCount: availableWorkspaces.length,
          filter: 'available',
        },
      })
    }

    if (memberId && hasAdminAccess) {
      const organizationWorkspaces = await db
        .select({
          id: workspace.id,
          name: workspace.name,
          ownerId: workspace.ownerId,
          billingOwnerType: workspace.billingOwnerType,
          billingOwnerUserId: workspace.billingOwnerUserId,
          billingOwnerOrganizationId: workspace.billingOwnerOrganizationId,
          createdAt: workspace.createdAt,
        })
        .from(workspace)
        .where(
          and(
            eq(workspace.billingOwnerType, 'organization'),
            eq(workspace.billingOwnerOrganizationId, organizationId)
          )
        )

      if (organizationWorkspaces.length === 0) {
        return NextResponse.json({
          success: true,
          data: {
            workspaces: [],
            totalCount: 0,
            filter: 'member',
            memberId,
          },
        })
      }

      const workspaceIds = organizationWorkspaces.map((workspaceRow) => workspaceRow.id)
      const permissionRows = await db
        .select({
          entityId: permissions.entityId,
          permissionType: permissions.permissionType,
          createdAt: permissions.createdAt,
        })
        .from(permissions)
        .where(
          and(
            eq(permissions.userId, memberId),
            eq(permissions.entityType, 'workspace'),
            inArray(permissions.entityId, workspaceIds)
          )
        )

      const permissionByWorkspaceId = new Map(permissionRows.map((row) => [row.entityId, row]))

      const formattedWorkspaces = organizationWorkspaces
        .filter(
          (workspaceRow) =>
            workspaceRow.ownerId === memberId || permissionByWorkspaceId.has(workspaceRow.id)
        )
        .map((workspaceRow) => {
          const permission = permissionByWorkspaceId.get(workspaceRow.id)

          return {
            ...toWorkspaceApiRecord(workspaceRow),
            isOwner: workspaceRow.ownerId === memberId,
            permission: permission?.permissionType ?? 'admin',
            joinedAt: permission?.createdAt ?? workspaceRow.createdAt,
            createdAt: workspaceRow.createdAt,
          }
        })

      return NextResponse.json({
        success: true,
        data: {
          workspaces: formattedWorkspaces,
          totalCount: formattedWorkspaces.length,
          filter: 'member',
          memberId,
        },
      })
    }

    if (!hasAdminAccess) {
      return NextResponse.json({
        success: true,
        data: {
          workspaces: [],
          totalCount: 0,
          message: 'Workspace billing information is only available to organization admins',
        },
      })
    }

    const organizationWorkspaces = await db
      .select({
        id: workspace.id,
        name: workspace.name,
        ownerId: workspace.ownerId,
        billingOwnerType: workspace.billingOwnerType,
        billingOwnerUserId: workspace.billingOwnerUserId,
        billingOwnerOrganizationId: workspace.billingOwnerOrganizationId,
        createdAt: workspace.createdAt,
        ownerName: user.name,
      })
      .from(workspace)
      .leftJoin(user, eq(workspace.ownerId, user.id))
      .where(
        and(
          eq(workspace.billingOwnerType, 'organization'),
          eq(workspace.billingOwnerOrganizationId, organizationId)
        )
      )

    return NextResponse.json({
      success: true,
      data: {
        workspaces: organizationWorkspaces.map((workspaceRow) => ({
          ...toWorkspaceApiRecord(workspaceRow),
          ownerName: workspaceRow.ownerName,
        })),
        totalCount: organizationWorkspaces.length,
        filter: 'all',
      },
      userRole: membership.role,
      hasAdminAccess,
    })
  } catch (error) {
    logger.error('Failed to get organization workspaces', { error })
    return NextResponse.json(
      {
        error: 'Internal server error',
      },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: organizationId } = await params
    const membership = await getOrganizationMembership(session.user.id, organizationId)

    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      return NextResponse.json(
        { error: 'Only organization admins can assign workspace billing ownership' },
        { status: 403 }
      )
    }

    const { workspaceId } = assignOrganizationWorkspaceSchema.parse(await request.json())

    const canAdminWorkspace = await hasWorkspaceAdminAccess(session.user.id, workspaceId)
    if (!canAdminWorkspace) {
      return NextResponse.json(
        { error: 'Only workspace admins can assign organization billing ownership' },
        { status: 403 }
      )
    }

    const workspaceRow = await db
      .select()
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)

    const existingWorkspace = workspaceRow[0]
    if (!existingWorkspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const billingOwnerUpdate = await resolveWorkspaceBillingOwnerUpdate({
      actingUserId: session.user.id,
      workspaceId,
      workspaceOwnerId: existingWorkspace.ownerId,
      billingOwner: {
        type: 'organization',
        organizationId,
      },
    })

    await db
      .update(workspace)
      .set({
        ...billingOwnerUpdate,
        updatedAt: new Date(),
      })
      .where(eq(workspace.id, workspaceId))

    const updatedWorkspace = await db
      .select()
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)

    return NextResponse.json({
      success: true,
      workspace: toWorkspaceApiRecord(updatedWorkspace[0]),
    })
  } catch (error) {
    logger.error('Failed to assign organization billing ownership to workspace', { error })

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? 'Invalid request' },
        { status: 400 }
      )
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: organizationId } = await params
    const membership = await getOrganizationMembership(session.user.id, organizationId)

    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      return NextResponse.json(
        { error: 'Only organization admins can release organization billing ownership' },
        { status: 403 }
      )
    }

    const url = new URL(request.url)
    const workspaceId = releaseOrganizationWorkspaceSchema.parse({
      workspaceId: url.searchParams.get('workspaceId'),
    }).workspaceId

    const workspaceRow = await db
      .select()
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)

    const existingWorkspace = workspaceRow[0]
    if (!existingWorkspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    if (
      existingWorkspace.billingOwnerType !== 'organization' ||
      existingWorkspace.billingOwnerOrganizationId !== organizationId
    ) {
      return NextResponse.json(
        { error: 'Workspace is not currently billed to this organization' },
        { status: 400 }
      )
    }

    const billingOwnerUpdate = await resolveWorkspaceBillingOwnerUpdate({
      actingUserId: session.user.id,
      workspaceId,
      workspaceOwnerId: existingWorkspace.ownerId,
      billingOwner: {
        type: 'user',
        userId: existingWorkspace.ownerId,
      },
    })

    await db
      .update(workspace)
      .set({
        ...billingOwnerUpdate,
        updatedAt: new Date(),
      })
      .where(eq(workspace.id, workspaceId))

    const updatedWorkspace = await db
      .select()
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)

    return NextResponse.json({
      success: true,
      workspace: toWorkspaceApiRecord(updatedWorkspace[0]),
    })
  } catch (error) {
    logger.error('Failed to release organization billing ownership from workspace', { error })

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? 'Invalid request' },
        { status: 400 }
      )
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
