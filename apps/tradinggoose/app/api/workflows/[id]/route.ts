import { db } from '@tradinggoose/db'
import { templates, workflow } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateApiKeyFromHeader, updateApiKeyLastUsed } from '@/lib/api-key/service'
import { getSession } from '@/lib/auth'
import { verifyInternalTokenDetailed } from '@/lib/auth/internal'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { hydrateListingUI } from '@/lib/listing/hydrate-ui'
import { loadWorkflowStateWithFallback } from '@/lib/workflows/db-helpers'
import { getWorkflowAccessContext, getWorkflowById } from '@/lib/workflows/utils'
import { deleteYjsSessionInSocketServer } from '@/lib/yjs/server/snapshot-bridge'
import { createWorkflowSnapshot } from '@/lib/yjs/workflow-session'

const logger = createLogger('WorkflowByIdAPI')

const UpdateWorkflowSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  description: z.string().optional(),
  color: z.string().optional(),
  folderId: z.string().nullable().optional(),
})

/**
 * GET /api/workflows/[id]
 * Fetch a single workflow by ID
 * Uses the authoritative Yjs-first workflow state loader with normalized DB fallback
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const startTime = Date.now()
  const { id: workflowId } = await params

  try {
    const authHeader = request.headers.get('authorization')
    let isInternalCall = false

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1]
      const verification = await verifyInternalTokenDetailed(token)
      isInternalCall = verification.valid
    }

    let userId: string | null = null

    if (isInternalCall) {
      logger.info(`[${requestId}] Internal API call for workflow ${workflowId}`)
    } else {
      const session = await getSession()
      let authenticatedUserId: string | null = session?.user?.id || null

      if (!authenticatedUserId) {
        const apiKeyHeader = request.headers.get('x-api-key')
        if (apiKeyHeader) {
          const authResult = await authenticateApiKeyFromHeader(apiKeyHeader)
          if (authResult.success && authResult.userId) {
            authenticatedUserId = authResult.userId
            if (authResult.keyId) {
              await updateApiKeyLastUsed(authResult.keyId).catch((error) => {
                logger.warn(`[${requestId}] Failed to update API key last used timestamp:`, {
                  keyId: authResult.keyId,
                  error,
                })
              })
            }
          }
        }
      }

      if (!authenticatedUserId) {
        logger.warn(`[${requestId}] Unauthorized access attempt for workflow ${workflowId}`)
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      userId = authenticatedUserId
    }

    let accessContext = null
    let workflowData = await getWorkflowById(workflowId)

    if (!workflowData) {
      logger.warn(`[${requestId}] Workflow ${workflowId} not found`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Check if user has access to this workflow
    let hasAccess = false

    if (isInternalCall) {
      // Internal calls have full access
      hasAccess = true
    } else {
      // Case 1: User owns the workflow
      if (workflowData) {
        accessContext = await getWorkflowAccessContext(workflowId, userId ?? undefined)

        if (!accessContext) {
          logger.warn(`[${requestId}] Workflow ${workflowId} not found`)
          return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
        }

        workflowData = accessContext.workflow

        if (accessContext.isOwner) {
          hasAccess = true
        }

        if (!hasAccess && workflowData.workspaceId && accessContext.workspacePermission) {
          hasAccess = true
        }
      }

      if (!hasAccess) {
        logger.warn(`[${requestId}] User ${userId} denied access to workflow ${workflowId}`)
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
    }

    logger.debug(`[${requestId}] Attempting to load workflow ${workflowId} from authoritative state`)
    const workflowState = await loadWorkflowStateWithFallback(workflowId, workflowData.lastSynced)

    if (!workflowState) {
      logger.warn(
        `[${requestId}] Workflow ${workflowId} has no stored state, returning empty state`
      )
    } else {
      logger.debug(`[${requestId}] Found ${workflowState.source} workflow state for ${workflowId}:`, {
        blocksCount: Object.keys(workflowState.blocks).length,
        edgesCount: workflowState.edges.length,
        loopsCount: Object.keys(workflowState.loops).length,
        parallelsCount: Object.keys(workflowState.parallels).length,
        loops: workflowState.loops,
      })
    }

    const resolvedState = workflowState
      ? createWorkflowSnapshot({
          direction: workflowState.direction,
          blocks: workflowState.blocks,
          edges: workflowState.edges,
          loops: workflowState.loops,
          parallels: workflowState.parallels,
        })
      : createWorkflowSnapshot()

    let resolvedBlocks = resolvedState.blocks
    if (!isInternalCall && resolvedState.blocks) {
      try {
        resolvedBlocks = await hydrateListingUI(resolvedState.blocks)
      } catch (error) {
        logger.warn(`[${requestId}] Failed to resolve listing values for workflow ${workflowId}`, {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const finalWorkflowData = {
      ...workflowData,
      state: {
        deploymentStatuses: {},
        ...(resolvedState.direction !== undefined ? { direction: resolvedState.direction } : {}),
        blocks: resolvedBlocks,
        edges: resolvedState.edges,
        loops: resolvedState.loops,
        parallels: resolvedState.parallels,
        lastSaved: Date.now(),
        isDeployed: workflowData.isDeployed || false,
        deployedAt: workflowData.deployedAt,
      },
    }

    logger.info(
      `[${requestId}] Loaded workflow ${workflowId} from ${
        workflowState?.source ?? 'empty fallback'
      }`
    )
    const elapsed = Date.now() - startTime
    logger.info(`[${requestId}] Successfully fetched workflow ${workflowId} in ${elapsed}ms`)

    return NextResponse.json({ data: finalWorkflowData }, { status: 200 })
  } catch (error: any) {
    const elapsed = Date.now() - startTime
    logger.error(`[${requestId}] Error fetching workflow ${workflowId} after ${elapsed}ms`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/workflows/[id]
 * Delete a workflow by ID
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = generateRequestId()
  const startTime = Date.now()
  const { id: workflowId } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized deletion attempt for workflow ${workflowId}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const accessContext = await getWorkflowAccessContext(workflowId, userId)
    const workflowData = accessContext?.workflow || (await getWorkflowById(workflowId))

    if (!workflowData) {
      logger.warn(`[${requestId}] Workflow ${workflowId} not found for deletion`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Check if user has permission to delete this workflow
    let canDelete = false

    // Case 1: User owns the workflow
    if (workflowData.userId === userId) {
      canDelete = true
    }

    // Case 2: Workflow belongs to a workspace and user has admin permission
    if (!canDelete && workflowData.workspaceId) {
      const context = accessContext || (await getWorkflowAccessContext(workflowId, userId))
      if (context?.workspacePermission === 'admin') {
        canDelete = true
      }
    }

    if (!canDelete) {
      logger.warn(
        `[${requestId}] User ${userId} denied permission to delete workflow ${workflowId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Check if workflow has published templates before deletion
    const { searchParams } = new URL(request.url)
    const checkTemplates = searchParams.get('check-templates') === 'true'
    const deleteTemplatesParam = searchParams.get('deleteTemplates')

    if (checkTemplates) {
      // Return template information for frontend to handle
      const publishedTemplates = await db
        .select()
        .from(templates)
        .where(eq(templates.workflowId, workflowId))

      return NextResponse.json({
        hasPublishedTemplates: publishedTemplates.length > 0,
        count: publishedTemplates.length,
        publishedTemplates: publishedTemplates.map((t) => ({
          id: t.id,
          name: t.name,
          views: t.views,
          stars: t.stars,
        })),
      })
    }

    // Handle template deletion based on user choice
    if (deleteTemplatesParam !== null) {
      const deleteTemplates = deleteTemplatesParam === 'delete'

      if (deleteTemplates) {
        // Delete all templates associated with this workflow
        await db.delete(templates).where(eq(templates.workflowId, workflowId))
        logger.info(`[${requestId}] Deleted templates for workflow ${workflowId}`)
      } else {
        // Orphan the templates (set workflowId to null)
        await db
          .update(templates)
          .set({ workflowId: null })
          .where(eq(templates.workflowId, workflowId))
        logger.info(`[${requestId}] Orphaned templates for workflow ${workflowId}`)
      }
    }

    await db.delete(workflow).where(eq(workflow.id, workflowId))

    // Best-effort cleanup of the authoritative socket/Yjs session.
    // Do not block workflow deletion if the bridge is unavailable.
    try {
      await deleteYjsSessionInSocketServer(workflowId)
    } catch (error) {
      logger.warn(
        `[${requestId}] Failed to delete socket/Yjs session for workflow ${workflowId}`,
        { error, workflowId }
      )
    }

    const elapsed = Date.now() - startTime
    logger.info(`[${requestId}] Successfully deleted workflow ${workflowId} in ${elapsed}ms`)

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error: any) {
    const elapsed = Date.now() - startTime
    logger.error(`[${requestId}] Error deleting workflow ${workflowId} after ${elapsed}ms`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT /api/workflows/[id]
 * Update workflow metadata (name, description, color, folderId)
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const startTime = Date.now()
  const { id: workflowId } = await params

  try {
    // Get the session
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized update attempt for workflow ${workflowId}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Parse and validate request body
    const body = await request.json()
    const updates = UpdateWorkflowSchema.parse(body)

    // Fetch the workflow to check ownership/access
    const accessContext = await getWorkflowAccessContext(workflowId, userId)
    const workflowData = accessContext?.workflow || (await getWorkflowById(workflowId))

    if (!workflowData) {
      logger.warn(`[${requestId}] Workflow ${workflowId} not found for update`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Check if user has permission to update this workflow
    let canUpdate = false

    // Case 1: User owns the workflow
    if (workflowData.userId === userId) {
      canUpdate = true
    }

    // Case 2: Workflow belongs to a workspace and user has write or admin permission
    if (!canUpdate && workflowData.workspaceId) {
      const context = accessContext || (await getWorkflowAccessContext(workflowId, userId))
      if (context?.workspacePermission === 'write' || context?.workspacePermission === 'admin') {
        canUpdate = true
      }
    }

    if (!canUpdate) {
      logger.warn(
        `[${requestId}] User ${userId} denied permission to update workflow ${workflowId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Build update object
    const updateData: any = { updatedAt: new Date() }
    if (updates.name !== undefined) updateData.name = updates.name
    if (updates.description !== undefined) updateData.description = updates.description
    if (updates.color !== undefined) updateData.color = updates.color
    if (updates.folderId !== undefined) updateData.folderId = updates.folderId

    // Update the workflow
    const [updatedWorkflow] = await db
      .update(workflow)
      .set(updateData)
      .where(eq(workflow.id, workflowId))
      .returning()

    const elapsed = Date.now() - startTime
    logger.info(`[${requestId}] Successfully updated workflow ${workflowId} in ${elapsed}ms`, {
      updates: updateData,
    })

    return NextResponse.json({ workflow: updatedWorkflow }, { status: 200 })
  } catch (error: any) {
    const elapsed = Date.now() - startTime
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid workflow update data for ${workflowId}`, {
        errors: error.errors,
      })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error updating workflow ${workflowId} after ${elapsed}ms`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
