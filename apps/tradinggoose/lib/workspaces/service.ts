import { db } from '@tradinggoose/db'
import { permissions, workflow, workspace } from '@tradinggoose/db/schema'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { buildWorkspaceAccessScope } from '@/lib/permissions/utils'
import {
  ensureUniqueBlockIds,
  ensureUniqueEdgeIds,
} from '@/lib/workflows/db-helpers'
import { buildDefaultWorkflowArtifacts } from '@/lib/workflows/defaults'
import { toWorkspaceApiRecord } from '@/lib/workspaces/billing-owner'
import { applyWorkflowState } from '@/lib/yjs/server/apply-workflow-state'
import { createWorkflowSnapshot } from '@/lib/yjs/workflow-session'

type WorkspaceRecord = typeof workspace.$inferSelect

export async function getUserWorkspaces({
  userId,
  userName,
  autoCreate = true,
}: {
  userId: string
  userName?: string | null
  autoCreate?: boolean
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

  if (userWorkspaces.length === 0) {
    if (!autoCreate) {
      return []
    }

    const defaultWorkspace = await createDefaultWorkspace(userId, userName)
    await migrateExistingWorkflows(userId, defaultWorkspace.id)
    return [defaultWorkspace]
  }

  if (autoCreate) {
    await ensureWorkflowsHaveWorkspace(userId, userWorkspaces[0].workspace.id)
  }

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
  const lastSaved = now.toISOString()

  try {
    const stateWithUniqueBlockIds = await ensureUniqueBlockIds(workflowId, workflowState)
    const persistedWorkflowState = await ensureUniqueEdgeIds(workflowId, stateWithUniqueBlockIds)

    await applyWorkflowState(
      workflowId,
      createWorkflowSnapshot({
        blocks: persistedWorkflowState.blocks,
        edges: persistedWorkflowState.edges,
        loops: persistedWorkflowState.loops,
        parallels: persistedWorkflowState.parallels,
        lastSaved,
        isDeployed: false,
      }),
      {},
      'default-agent'
    )
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

async function createDefaultWorkspace(userId: string, userName?: string | null) {
  const firstName = userName?.split(' ')[0] || null
  return createWorkspace(userId, firstName ? `${firstName}'s Workspace` : 'My Workspace')
}

async function migrateExistingWorkflows(userId: string, workspaceId: string) {
  await db
    .update(workflow)
    .set({
      workspaceId,
      updatedAt: new Date(),
    })
    .where(and(eq(workflow.userId, userId), isNull(workflow.workspaceId)))
}

async function ensureWorkflowsHaveWorkspace(userId: string, defaultWorkspaceId: string) {
  await db
    .update(workflow)
    .set({
      workspaceId: defaultWorkspaceId,
      updatedAt: new Date(),
    })
    .where(and(eq(workflow.userId, userId), isNull(workflow.workspaceId)))
}
