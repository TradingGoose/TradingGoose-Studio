import { db } from '@tradinggoose/db'
import { workflow, workflowFolder } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { refreshWorkflowList } from '@/lib/workflows/db-helpers'
import { isRootFolderInWorkspace, lockFolderWrites } from '../shared'

const logger = createLogger('FoldersIDAPI')

// PUT - Update a folder
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const { name, color, isExpanded, parentId } = body

    // Verify the folder exists
    const existingFolder = await db
      .select()
      .from(workflowFolder)
      .where(eq(workflowFolder.id, id))
      .then((rows) => rows[0])

    if (!existingFolder) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
    }

    // Check if user has write permissions for the workspace
    const workspacePermission = await getUserEntityPermissions(
      session.user.id,
      'workspace',
      existingFolder.workspaceId
    )

    if (!workspacePermission || workspacePermission === 'read') {
      return NextResponse.json(
        { error: 'Write access required to update folders' },
        { status: 403 }
      )
    }

    // Prevent setting a folder as its own parent.
    if (parentId && parentId === id) {
      return NextResponse.json({ error: 'Folder cannot be its own parent' }, { status: 400 })
    }

    const updates: any = { updatedAt: new Date() }
    if (name !== undefined) updates.name = name.trim()
    if (color !== undefined) updates.color = color
    if (isExpanded !== undefined) updates.isExpanded = isExpanded
    if (parentId !== undefined) updates.parentId = parentId || null

    const updateResult = await db.transaction(async (tx) => {
      await lockFolderWrites(tx, existingFolder.workspaceId)

      if (parentId) {
        if (!(await isRootFolderInWorkspace(tx, parentId, existingFolder.workspaceId))) {
          return {
            error: 'Parent folder must be a root folder in this workspace',
            status: 400,
          } as const
        }

        const [childFolder] = await tx
          .select({ id: workflowFolder.id })
          .from(workflowFolder)
          .where(
            and(
              eq(workflowFolder.parentId, id),
              eq(workflowFolder.workspaceId, existingFolder.workspaceId)
            )
          )
          .limit(1)
        if (childFolder) {
          return {
            error: 'A folder with subfolders cannot be nested under another folder',
            status: 400,
          } as const
        }
      }

      const [folder] = await tx
        .update(workflowFolder)
        .set(updates)
        .where(
          and(eq(workflowFolder.id, id), eq(workflowFolder.workspaceId, existingFolder.workspaceId))
        )
        .returning()
      if (!folder) return { error: 'Folder not found', status: 404 } as const
      return { folder } as const
    })

    if ('error' in updateResult) {
      return NextResponse.json({ error: updateResult.error }, { status: updateResult.status })
    }

    logger.info('Updated folder:', { id, updates })

    return NextResponse.json({ folder: updateResult.folder })
  } catch (error) {
    logger.error('Error updating folder:', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Delete one folder and promote its direct children one level up.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    // Verify the folder exists
    const existingFolder = await db
      .select()
      .from(workflowFolder)
      .where(eq(workflowFolder.id, id))
      .then((rows) => rows[0])

    if (!existingFolder) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
    }

    // Check if user has admin permissions for the workspace (admin-only for deletions)
    const workspacePermission = await getUserEntityPermissions(
      session.user.id,
      'workspace',
      existingFolder.workspaceId
    )

    if (workspacePermission !== 'admin') {
      return NextResponse.json(
        { error: 'Admin access required to delete folders' },
        { status: 403 }
      )
    }

    const deleteResult = await db.transaction(async (tx) => {
      await lockFolderWrites(tx, existingFolder.workspaceId)

      const [lockedFolder] = await tx
        .select({ parentId: workflowFolder.parentId })
        .from(workflowFolder)
        .where(
          and(eq(workflowFolder.id, id), eq(workflowFolder.workspaceId, existingFolder.workspaceId))
        )
        .limit(1)
      if (!lockedFolder) return { error: 'Folder not found', status: 404 } as const

      const parentId = lockedFolder.parentId ?? null
      const now = new Date()
      const movedFolders = await tx
        .update(workflowFolder)
        .set({ parentId, updatedAt: now })
        .where(
          and(
            eq(workflowFolder.parentId, id),
            eq(workflowFolder.workspaceId, existingFolder.workspaceId)
          )
        )
        .returning({ id: workflowFolder.id })

      const movedWorkflows = await tx
        .update(workflow)
        .set({ folderId: parentId, updatedAt: now })
        .where(and(eq(workflow.workspaceId, existingFolder.workspaceId), eq(workflow.folderId, id)))
        .returning({ id: workflow.id })

      await tx.delete(workflowFolder).where(eq(workflowFolder.id, id))

      return {
        parentId,
        movedFolders: movedFolders.length,
        movedWorkflows: movedWorkflows.length,
      } as const
    })

    if ('error' in deleteResult) {
      return NextResponse.json({ error: deleteResult.error }, { status: deleteResult.status })
    }

    await refreshWorkflowList(existingFolder.workspaceId)

    logger.info('Deleted folder and promoted direct children:', {
      id,
      ...deleteResult,
    })

    return NextResponse.json({
      success: true,
      deletedFolderId: id,
      ...deleteResult,
    })
  } catch (error) {
    logger.error('Error deleting folder:', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
