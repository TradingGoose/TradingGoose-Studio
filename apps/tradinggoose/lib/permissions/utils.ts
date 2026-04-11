import { db } from '@tradinggoose/db'
import { permissions, type permissionTypeEnum, user, workspace } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'

export type PermissionType = (typeof permissionTypeEnum.enumValues)[number]

export type WorkspaceRecord = typeof workspace.$inferSelect

export type WorkspaceWithOwner = WorkspaceRecord

export interface WorkspaceAccess {
  exists: boolean
  hasAccess: boolean
  canWrite: boolean
  workspace: WorkspaceRecord | null
}

export interface WorkspaceMemberProfile {
  userId: string
  name: string
  image: string | null
}

async function selectWorkspaceById(workspaceId: string): Promise<WorkspaceRecord | null> {
  const [row] = await db.select().from(workspace).where(eq(workspace.id, workspaceId)).limit(1)
  return row ?? null
}

export async function workspaceExists(workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1)

  return !!row
}

export async function getWorkspaceById(workspaceId: string): Promise<WorkspaceRecord | null> {
  return await selectWorkspaceById(workspaceId)
}

export async function getWorkspaceWithOwner(workspaceId: string): Promise<WorkspaceWithOwner | null> {
  return await selectWorkspaceById(workspaceId)
}

export async function checkWorkspaceAccess(
  workspaceId: string,
  userId: string
): Promise<WorkspaceAccess> {
  const ws = await getWorkspaceWithOwner(workspaceId)

  if (!ws) {
    return { exists: false, hasAccess: false, canWrite: false, workspace: null }
  }

  if (ws.ownerId === userId) {
    return { exists: true, hasAccess: true, canWrite: true, workspace: ws }
  }

  const [permissionRow] = await db
    .select({ permissionType: permissions.permissionType })
    .from(permissions)
    .where(
      and(
        eq(permissions.userId, userId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workspaceId)
      )
    )
    .limit(1)

  if (!permissionRow) {
    return { exists: true, hasAccess: false, canWrite: false, workspace: ws }
  }

  const canWrite =
    permissionRow.permissionType === 'write' || permissionRow.permissionType === 'admin'

  return { exists: true, hasAccess: true, canWrite, workspace: ws }
}

export async function assertActiveWorkspaceAccess(
  workspaceId: string,
  userId: string
): Promise<WorkspaceAccess> {
  const access = await checkWorkspaceAccess(workspaceId, userId)
  if (!access.exists || !access.hasAccess) {
    throw new Error(`Active workspace access denied: ${workspaceId}`)
  }
  return access
}

/**
 * Get the highest permission level a user has for a specific entity
 *
 * @param userId - The ID of the user to check permissions for
 * @param entityType - The type of entity (e.g., 'workspace', 'workflow', etc.)
 * @param entityId - The ID of the specific entity
 * @returns Promise<PermissionType | null> - The highest permission the user has for the entity, or null if none
 */
export async function getUserEntityPermissions(
  userId: string,
  entityType: string,
  entityId: string
): Promise<PermissionType | null> {
  if (entityType === 'workspace') {
    const activeWorkspace = await workspaceExists(entityId)
    if (!activeWorkspace) {
      return null
    }
  }

  const result = await db
    .select({ permissionType: permissions.permissionType })
    .from(permissions)
    .where(
      and(
        eq(permissions.userId, userId),
        eq(permissions.entityType, entityType),
        eq(permissions.entityId, entityId)
      )
    )

  if (result.length === 0) {
    return null
  }

  const permissionOrder: Record<PermissionType, number> = { admin: 3, write: 2, read: 1 }
  const highestPermission = result.reduce((highest, current) => {
    return permissionOrder[current.permissionType] > permissionOrder[highest.permissionType]
      ? current
      : highest
  })

  return highestPermission.permissionType
}

/**
 * Check if a user has admin permission for a specific workspace
 *
 * @param userId - The ID of the user to check
 * @param workspaceId - The ID of the workspace to check
 * @returns Promise<boolean> - True if the user has admin permission for the workspace, false otherwise
 */
export async function hasAdminPermission(userId: string, workspaceId: string): Promise<boolean> {
  const result = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(
      and(
        eq(permissions.userId, userId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workspaceId),
        eq(permissions.permissionType, 'admin')
      )
    )
    .limit(1)

  return result.length > 0
}

/**
 * Retrieves a list of users with their associated permissions for a given workspace.
 *
 * @param workspaceId - The ID of the workspace to retrieve user permissions for.
 * @returns A promise that resolves to an array of user objects, each containing user details and their permission type.
 */
export async function getUsersWithPermissions(workspaceId: string): Promise<
  Array<{
    userId: string
    email: string
    name: string
    permissionType: PermissionType
  }>
> {
  const usersWithPermissions = await db
    .select({
      userId: user.id,
      email: user.email,
      name: user.name,
      permissionType: permissions.permissionType,
    })
    .from(permissions)
    .innerJoin(user, eq(permissions.userId, user.id))
    .innerJoin(workspace, eq(permissions.entityId, workspace.id))
    .where(and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspaceId)))
    .orderBy(user.email)

  return usersWithPermissions.map((row) => ({
    userId: row.userId,
    email: row.email,
    name: row.name,
    permissionType: row.permissionType,
  }))
}

/**
 * Check if a user has admin access to a specific workspace
 *
 * @param userId - The ID of the user to check
 * @param workspaceId - The ID of the workspace to check
 * @returns Promise<boolean> - True if the user has admin access to the workspace, false otherwise
 */
export async function hasWorkspaceAdminAccess(
  userId: string,
  workspaceId: string
): Promise<boolean> {
  const ws = await getWorkspaceWithOwner(workspaceId)

  if (!ws) {
    return false
  }

  if (ws.ownerId === userId) {
    return true
  }

  return await hasAdminPermission(userId, workspaceId)
}

/**
 * Get a list of workspaces that the user has access to
 *
 * @param userId - The ID of the user to check
 * @returns Promise<Array<{
 *   id: string
 *   name: string
 *   ownerId: string
 *   accessType: 'direct' | 'owner'
 * }>> - A list of workspaces that the user has access to
 */
export async function getManageableWorkspaces(userId: string): Promise<
  Array<{
    id: string
    name: string
    ownerId: string
    accessType: 'direct' | 'owner'
  }>
> {
  const ownedWorkspaces = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      ownerId: workspace.ownerId,
    })
    .from(workspace)
    .where(eq(workspace.ownerId, userId))

  const adminWorkspaces = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      ownerId: workspace.ownerId,
    })
    .from(workspace)
    .innerJoin(permissions, eq(permissions.entityId, workspace.id))
    .where(
      and(
        eq(permissions.userId, userId),
        eq(permissions.entityType, 'workspace'),
        eq(permissions.permissionType, 'admin')
      )
    )

  const ownedSet = new Set(ownedWorkspaces.map((w) => w.id))
  const combined = [
    ...ownedWorkspaces.map((ws) => ({ ...ws, accessType: 'owner' as const })),
    ...adminWorkspaces
      .filter((ws) => !ownedSet.has(ws.id))
      .map((ws) => ({ ...ws, accessType: 'direct' as const })),
  ]

  return combined
}

export async function getWorkspaceMemberProfiles(
  workspaceId: string
): Promise<WorkspaceMemberProfile[]> {
  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      image: user.image,
    })
    .from(permissions)
    .innerJoin(user, eq(permissions.userId, user.id))
    .innerJoin(workspace, eq(permissions.entityId, workspace.id))
    .where(and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspaceId)))

  return rows
}
