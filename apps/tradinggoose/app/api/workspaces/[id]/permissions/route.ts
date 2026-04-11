import crypto from 'crypto'
import { db, permissions, permissionTypeEnum, workspace } from '@tradinggoose/db'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import {
  assertActiveWorkspaceAccess,
  getUsersWithPermissions,
  hasWorkspaceAdminAccess,
} from '@/lib/permissions/utils'
import { assertWorkspaceBillingOwnerRetainsAdminAccess } from '../../../../../lib/workspaces/billing-owner'

const logger = createLogger('WorkspacesPermissionsAPI')

type PermissionType = (typeof permissionTypeEnum.enumValues)[number]
const permissionTypeValues = permissionTypeEnum.enumValues as [PermissionType, ...PermissionType[]]

const updatePermissionsSchema = z.object({
  updates: z.array(
    z.object({
      userId: z.string().min(1),
      permissions: z.enum(permissionTypeValues),
    })
  ),
})

interface UpdatePermissionsRequest {
  updates: Array<{
    userId: string
    permissions: PermissionType
  }>
}

/**
 * GET /api/workspaces/[id]/permissions
 *
 * Retrieves all users who have permissions for the specified workspace.
 * Returns user details along with their specific permissions.
 *
 * @param workspaceId - The workspace ID from the URL parameters
 * @returns Array of users with their permissions for the workspace
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: workspaceId } = await params
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    try {
      await assertActiveWorkspaceAccess(workspaceId, session.user.id)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Active workspace access denied:')) {
        return NextResponse.json({ error: 'Workspace not found or access denied' }, { status: 404 })
      }

      throw error
    }

    const result = await getUsersWithPermissions(workspaceId)

    return NextResponse.json({
      users: result,
      total: result.length,
    })
  } catch (error) {
    logger.error('Error fetching workspace permissions:', error)
    return NextResponse.json({ error: 'Failed to fetch workspace permissions' }, { status: 500 })
  }
}

/**
 * PATCH /api/workspaces/[id]/permissions
 *
 * Updates permissions for existing workspace members.
 * Only admin users can update permissions.
 *
 * @param workspaceId - The workspace ID from the URL parameters
 * @param updates - Array of permission updates for users
 * @returns Success message or error
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: workspaceId } = await params
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const hasAdminAccess = await hasWorkspaceAdminAccess(session.user.id, workspaceId)

    if (!hasAdminAccess) {
      return NextResponse.json(
        { error: 'Admin access required to update permissions' },
        { status: 403 }
      )
    }

    const bodyParse = updatePermissionsSchema.safeParse(await request.json().catch(() => null))
    if (!bodyParse.success) {
      return NextResponse.json({ error: 'Invalid permissions update payload' }, { status: 400 })
    }

    const body: UpdatePermissionsRequest = bodyParse.data

    const selfUpdate = body.updates.find((update) => update.userId === session.user.id)
    if (selfUpdate && selfUpdate.permissions !== 'admin') {
      return NextResponse.json(
        { error: 'Cannot remove your own admin permissions' },
        { status: 400 }
      )
    }

    const workspaceRow = await db
      .select({
        billingOwnerType: workspace.billingOwnerType,
        billingOwnerUserId: workspace.billingOwnerUserId,
      })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)

    if (workspaceRow.length === 0) {
      return NextResponse.json({ error: 'Workspace not found or access denied' }, { status: 404 })
    }

    try {
      assertWorkspaceBillingOwnerRetainsAdminAccess({
        billingOwnerType: workspaceRow[0].billingOwnerType,
        billingOwnerUserId: workspaceRow[0].billingOwnerUserId,
        updates: body.updates,
      })
    } catch (error) {
      if (error instanceof Error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      throw error
    }

    await db.transaction(async (tx) => {
      for (const update of body.updates) {
        await tx
          .delete(permissions)
          .where(
            and(
              eq(permissions.userId, update.userId),
              eq(permissions.entityType, 'workspace'),
              eq(permissions.entityId, workspaceId)
            )
          )

        await tx.insert(permissions).values({
          id: crypto.randomUUID(),
          userId: update.userId,
          entityType: 'workspace' as const,
          entityId: workspaceId,
          permissionType: update.permissions,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      }
    })

    const updatedUsers = await getUsersWithPermissions(workspaceId)

    return NextResponse.json({
      message: 'Permissions updated successfully',
      users: updatedUsers,
      total: updatedUsers.length,
    })
  } catch (error) {
    logger.error('Error updating workspace permissions:', error)
    return NextResponse.json({ error: 'Failed to update workspace permissions' }, { status: 500 })
  }
}
