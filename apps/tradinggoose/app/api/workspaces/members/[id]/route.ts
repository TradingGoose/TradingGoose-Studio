import { db, permissions, workspace } from '@tradinggoose/db'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { hasWorkspaceAdminAccess } from '@/lib/permissions/utils'
import { assertWorkspaceBillingOwnerCanBeRemoved } from '@/lib/workspaces/billing-owner'

const logger = createLogger('WorkspaceMemberAPI')

const deleteMemberSchema = z.object({
  workspaceId: z.string().trim().min(1, 'Workspace ID is required'),
})

// DELETE /api/workspaces/members/[id] - Remove a member from a workspace
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: userId } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const bodyParse = deleteMemberSchema.safeParse(await req.json().catch(() => null))
    if (!bodyParse.success) {
      return NextResponse.json({ error: 'Workspace ID is required' }, { status: 400 })
    }
    const workspaceId = bodyParse.data.workspaceId

    const workspaceRow = await db
      .select({
        billingOwnerType: workspace.billingOwnerType,
        billingOwnerUserId: workspace.billingOwnerUserId,
      })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)

    if (workspaceRow.length === 0) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    try {
      assertWorkspaceBillingOwnerCanBeRemoved({
        billingOwnerType: workspaceRow[0].billingOwnerType,
        billingOwnerUserId: workspaceRow[0].billingOwnerUserId,
        userId,
      })
    } catch (error) {
      if (error instanceof Error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      throw error
    }

    // Check if the user to be removed actually has permissions for this workspace
    const userPermission = await db
      .select()
      .from(permissions)
      .where(
        and(
          eq(permissions.userId, userId),
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workspaceId)
        )
      )
      .then((rows) => rows[0])

    if (!userPermission) {
      return NextResponse.json({ error: 'User not found in workspace' }, { status: 404 })
    }

    // Check if current user has admin access to this workspace
    const hasAdminAccess = await hasWorkspaceAdminAccess(session.user.id, workspaceId)
    const isSelf = userId === session.user.id

    if (!hasAdminAccess && !isSelf) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    // Prevent removing yourself if you're the last admin
    if (isSelf && userPermission.permissionType === 'admin') {
      const otherAdmins = await db
        .select()
        .from(permissions)
        .where(
          and(
            eq(permissions.entityType, 'workspace'),
            eq(permissions.entityId, workspaceId),
            eq(permissions.permissionType, 'admin')
          )
        )
        .then((rows) => rows.filter((row) => row.userId !== session.user.id))

      if (otherAdmins.length === 0) {
        return NextResponse.json(
          { error: 'Cannot remove the last admin from a workspace' },
          { status: 400 }
        )
      }
    }

    // Delete the user's permissions for this workspace
    await db
      .delete(permissions)
      .where(
        and(
          eq(permissions.userId, userId),
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workspaceId)
        )
      )

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error removing workspace member:', error)
    return NextResponse.json({ error: 'Failed to remove workspace member' }, { status: 500 })
  }
}
