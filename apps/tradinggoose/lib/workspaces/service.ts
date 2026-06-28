import { db } from '@tradinggoose/db'
import { permissions, workspace } from '@tradinggoose/db/schema'
import { desc, eq, sql } from 'drizzle-orm'
import { buildWorkspaceAccessScope } from '@/lib/permissions/utils'
import { toWorkspaceApiRecord } from '@/lib/workspaces/billing-owner'

type WorkspaceRecord = typeof workspace.$inferSelect
const DEFAULT_WORKSPACE_BOOTSTRAP_LOCK_NAMESPACE = 1_904_202_615

export async function getUserWorkspaces({ userId }: { userId: string }) {
  const workspaceAccess = buildWorkspaceAccessScope(userId, workspace.id)
  const userWorkspaces = await db
    .select({
      workspace: workspace,
      permissionType: permissions.permissionType,
    })
    .from(workspace)
    .leftJoin(permissions, workspaceAccess.permissionJoin)
    .where(workspaceAccess.accessFilter)
    .orderBy(desc(workspace.createdAt))

  return userWorkspaces.map(({ workspace: workspaceDetails, permissionType }) => {
    const resolvedPermissionType = workspaceDetails.ownerId === userId ? 'admin' : permissionType
    if (!resolvedPermissionType) {
      throw new Error(`Expected workspace permission for ${workspaceDetails.id}`)
    }

    return {
      ...toWorkspaceApiRecord(workspaceDetails),
      role: resolvedPermissionType === 'admin' ? 'owner' : 'member',
      permissions: resolvedPermissionType,
    }
  })
}

export async function createDefaultWorkspaceForUser(userId: string, userName?: string | null) {
  const firstName = userName?.split(' ')[0] || null
  const name = firstName ? `${firstName}'s Workspace` : 'My Workspace'

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${DEFAULT_WORKSPACE_BOOTSTRAP_LOCK_NAMESPACE}, hashtext(${userId}))`
    )

    const [existingWorkspace] = await tx
      .select()
      .from(workspace)
      .where(eq(workspace.ownerId, userId))
      .orderBy(desc(workspace.createdAt))
      .limit(1)

    if (existingWorkspace) {
      return toOwnedWorkspaceApiRecord(existingWorkspace)
    }

    const workspaceDetails = buildWorkspaceRecord(userId, name)
    await tx.insert(workspace).values(workspaceDetails)
    return toOwnedWorkspaceApiRecord(workspaceDetails)
  })
}

function buildWorkspaceRecord(userId: string, name: string): WorkspaceRecord {
  const workspaceId = crypto.randomUUID()
  const now = new Date()
  return {
    id: workspaceId,
    name,
    ownerId: userId,
    billingOwnerType: 'user',
    billingOwnerUserId: userId,
    billingOwnerOrganizationId: null,
    allowPersonalApiKeys: true,
    createdAt: now,
    updatedAt: now,
  } satisfies WorkspaceRecord
}

function toOwnedWorkspaceApiRecord(workspaceDetails: WorkspaceRecord) {
  return {
    ...toWorkspaceApiRecord(workspaceDetails),
    role: 'owner',
    permissions: 'admin',
  }
}

export async function createWorkspace(userId: string, name: string) {
  const workspaceDetails = buildWorkspaceRecord(userId, name)
  await db.insert(workspace).values(workspaceDetails)
  return toOwnedWorkspaceApiRecord(workspaceDetails)
}
