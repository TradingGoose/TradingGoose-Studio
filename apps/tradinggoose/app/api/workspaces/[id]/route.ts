import { knowledgeBase, permissions, workflow, workspace } from '@tradinggoose/db'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { lockMemoryOwners } from '@/lib/mastra/memory-locks'
import { cleanupOrphanWorkflowMemory } from '@/lib/mastra/workflow-memory'
import {
  checkWorkspaceAccess,
  getUserEntityPermissions,
  getWorkspaceById,
} from '@/lib/permissions/utils'
import {
  ArchiveBusyError,
  assertWorkspaceArchiveDeletionInTx,
  prepareWorkspaceArchiveDeletion,
} from '@/lib/workflow-archive/lifecycle'
import {
  toWorkspaceApiRecord,
  updateWorkspaceFinancialBinding,
  WorkspaceBillingOwnerUpdateError,
  workspaceBillingOwnerSchema,
} from '@/lib/workspaces/billing-owner'
import { getUserWorkspaces } from '@/lib/workspaces/service'
import { lockSavedEntityList, SAVED_ENTITY_LIST_LOCK_KINDS } from '@/lib/yjs/server/entity-loaders'
import { runYjsDrainFencedTransaction } from '@/lib/yjs/server/snapshot-bridge'
import { createSavedEntityErrorResponse } from '@/app/api/saved-entity-error-response'

const logger = createLogger('WorkspaceByIdAPI')

const patchWorkspaceSchema = z.object({
  name: z.string().trim().min(1).optional(),
  allowPersonalApiKeys: z.boolean().optional(),
  billingOwner: workspaceBillingOwnerSchema.optional(),
})

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workspaceId = id
  const access = await checkWorkspaceAccess(workspaceId, session.user.id)
  if (!access.exists || !access.hasAccess || !access.workspace) {
    return NextResponse.json({ error: 'Workspace not found or access denied' }, { status: 404 })
  }

  const userPermission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
  if (!userPermission) {
    return NextResponse.json({ error: 'Workspace not found or access denied' }, { status: 404 })
  }

  return NextResponse.json({
    workspace: {
      ...toWorkspaceApiRecord(access.workspace),
      permissions: userPermission,
    },
  })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workspaceId = id

  // Check if user has admin permissions to update workspace
  const userPermission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
  if (userPermission !== 'admin') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  try {
    const { name, allowPersonalApiKeys, billingOwner } = patchWorkspaceSchema.parse(
      await request.json()
    )

    if (name === undefined && allowPersonalApiKeys === undefined && billingOwner === undefined) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
    }

    const existingWorkspace = await getWorkspaceById(workspaceId)

    if (!existingWorkspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const updatedWorkspace = await updateWorkspaceFinancialBinding({
      actingUserId: session.user.id,
      workspaceId,
      billingOwner,
      updates: {
        ...(name !== undefined ? { name } : {}),
        ...(allowPersonalApiKeys !== undefined ? { allowPersonalApiKeys } : {}),
      },
    })

    return NextResponse.json({
      workspace: {
        ...toWorkspaceApiRecord(updatedWorkspace),
        permissions: userPermission,
      },
    })
  } catch (error) {
    logger.error('Error updating workspace:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? 'Invalid workspace update payload' },
        { status: 400 }
      )
    }

    if (error instanceof WorkspaceBillingOwnerUpdateError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to update workspace' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workspaceId = id
  const existingWorkspace = await getWorkspaceById(workspaceId)
  if (!existingWorkspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  const userPermission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
  if (userPermission !== 'admin') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const userWorkspaces = await getUserWorkspaces({ userId: session.user.id })
  if (userWorkspaces.length <= 1) {
    return NextResponse.json({ error: 'Cannot delete your last workspace' }, { status: 400 })
  }

  try {
    logger.info(`Deleting workspace ${workspaceId} for user ${session.user.id}`)

    await prepareWorkspaceArchiveDeletion(workspaceId)
    const deletedWorkflowIds: string[] = []
    await runYjsDrainFencedTransaction({ workspaceIds: [workspaceId] }, async (tx) => {
      await assertWorkspaceArchiveDeletionInTx(tx, workspaceId)
      for (const entityKind of SAVED_ENTITY_LIST_LOCK_KINDS) {
        await lockSavedEntityList(tx, entityKind, workspaceId)
      }

      const memoryOwners = await tx
        .select({ id: workflow.id })
        .from(workflow)
        .where(eq(workflow.workspaceId, workspaceId))
      deletedWorkflowIds.push(...memoryOwners.map(({ id }) => id))
      await lockMemoryOwners(tx, workspaceId, deletedWorkflowIds)

      // Delete live workflow definitions first. Durable execution logs and snapshots
      // remain workspace-owned until the workspace row is deleted below.
      await tx.delete(workflow).where(eq(workflow.workspaceId, workspaceId))

      await tx.delete(knowledgeBase).where(eq(knowledgeBase.workspaceId, workspaceId))

      await tx
        .delete(permissions)
        .where(and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspaceId)))

      await tx.delete(workspace).where(eq(workspace.id, workspaceId))
    })

    for (const workflowId of deletedWorkflowIds)
      await cleanupOrphanWorkflowMemory(workspaceId, workflowId).catch((error) =>
        logger.error('Native Memory cleanup deferred after workspace deletion', {
          error,
          workflowId,
        })
      )
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof ArchiveBusyError)
      return NextResponse.json({ error: error.message }, { status: error.status })
    const realtimeResponse = createSavedEntityErrorResponse(error)
    if (realtimeResponse) return realtimeResponse
    logger.error(`Error deleting workspace ${workspaceId}:`, error)
    return NextResponse.json({ error: 'Failed to delete workspace' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Reuse the PATCH handler implementation for PUT requests
  return PATCH(request, { params })
}
