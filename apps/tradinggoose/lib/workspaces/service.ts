import { db } from '@tradinggoose/db'
import { permissions, workflow, workspace } from '@tradinggoose/db/schema'
import { desc, eq } from 'drizzle-orm'
import { buildWorkspaceAccessScope } from '@/lib/permissions/utils'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/db-helpers'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import { toWorkspaceApiRecord } from '@/lib/workspaces/billing-owner'

type WorkspaceRecord = typeof workspace.$inferSelect

export async function getUserWorkspaces({
  userId,
}: {
  userId: string
}) {
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
  return createWorkspace(userId, firstName ? `${firstName}'s Workspace` : 'My Workspace')
}

export async function createWorkspace(userId: string, name: string) {
  const workspaceId = crypto.randomUUID()
  const workflowId = crypto.randomUUID()
  const now = new Date()
  const workspaceDetails = {
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

  await db.transaction(async (tx) => {
    await tx.insert(workspace).values(workspaceDetails)

    await tx.insert(workflow).values({
      id: workflowId,
      userId,
      workspaceId,
      folderId: null,
      name: 'default-agent',
      description: 'Your first workflow - start building here!',
      color: '#3972F6',
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
      isDeployed: false,
      collaborators: [],
      runCount: 0,
      variables: {},
      isPublished: false,
      marketplaceData: null,
    })
  })

  const { workflowState } = buildDefaultWorkflowArtifacts()

  try {
    const saveResult = await saveWorkflowToNormalizedTables(workflowId, workflowState)
    if (!saveResult.success) {
      throw new Error(saveResult.error || 'Failed to persist default workflow state')
    }
  } catch (error) {
    await db.transaction(async (tx) => {
      await tx.delete(workflow).where(eq(workflow.id, workflowId))
      await tx.delete(workspace).where(eq(workspace.id, workspaceId))
    })
    throw error
  }

  return {
    ...toWorkspaceApiRecord(workspaceDetails),
    role: 'owner',
    permissions: 'admin',
  }
}
