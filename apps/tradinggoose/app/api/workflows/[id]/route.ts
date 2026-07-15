import { db } from '@tradinggoose/db'
import { workflow } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateApiKeyFromHeader, updateApiKeyLastUsed } from '@/lib/api-key/service'
import { getSession } from '@/lib/auth'
import { verifyInternalTokenDetailed } from '@/lib/auth/internal'
import { hydrateListingUI } from '@/lib/listing/hydrate-ui'
import { createLogger } from '@/lib/logs/console/logger'
import {
  renameSavedEntityIdentityInTx,
  SavedEntityIdentityError,
} from '@/lib/saved-entities/identity'
import { generateRequestId } from '@/lib/utils'
import {
  refreshWorkflowList,
  refreshWorkflowListForWorkflow,
  requireWorkflowRealtimeState,
} from '@/lib/workflows/db-helpers'
import { readWorkflowAccessContext, readWorkflowById } from '@/lib/workflows/utils'
import { withYjsSessionDeletionLease } from '@/lib/yjs/server/snapshot-bridge'
import { createWorkflowSnapshot } from '@/lib/yjs/workflow-session'
import { createWorkflowRealtimeRequiredResponse } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowByIdAPI')

const UpdateWorkflowSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').optional(),
    description: z.string().optional(),
    folderId: z.string().nullable().optional(),
  })
  .strict()

/**
 * GET /api/workflows/[id]
 * Fetch a single workflow by ID
 * Reads through the editable Yjs session; saved DB tables only seed that session.
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
    let workflowData = await readWorkflowById(workflowId)

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
        accessContext = await readWorkflowAccessContext(workflowId, userId ?? undefined)

        if (!accessContext) {
          logger.warn(`[${requestId}] Workflow ${workflowId} not found`)
          return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
        }

        workflowData = accessContext.workflow

        if (accessContext.isOwner) {
          hasAccess = true
        }

        if (
          !hasAccess &&
          workflowData.workspaceId &&
          (accessContext.isWorkspaceOwner || accessContext.workspacePermission)
        ) {
          hasAccess = true
        }
      }

      if (!hasAccess) {
        logger.warn(`[${requestId}] User ${userId} denied access to workflow ${workflowId}`)
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
    }

    logger.debug(`[${requestId}] Attempting to load workflow ${workflowId} from Yjs session`)
    const workflowState = await requireWorkflowRealtimeState(workflowId)

    if (!workflowState) {
      logger.warn(`[${requestId}] Workflow ${workflowId} is missing saved state`)
      return NextResponse.json({ error: 'Workflow state is missing' }, { status: 409 })
    }

    logger.debug(`[${requestId}] Found editable Yjs workflow state for ${workflowId}:`, {
      blocksCount: Object.keys(workflowState.blocks).length,
      edgesCount: workflowState.edges.length,
      loopsCount: Object.keys(workflowState.loops).length,
      parallelsCount: Object.keys(workflowState.parallels).length,
      loops: workflowState.loops,
    })

    const resolvedState = createWorkflowSnapshot({
      direction: workflowState.direction,
      blocks: workflowState.blocks,
      edges: workflowState.edges,
      loops: workflowState.loops,
      parallels: workflowState.parallels,
    })

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
        variables: workflowState.variables,
      },
    }

    logger.info(`[${requestId}] Loaded editable workflow ${workflowId} from Yjs`)
    const elapsed = Date.now() - startTime
    logger.info(`[${requestId}] Successfully fetched workflow ${workflowId} in ${elapsed}ms`)

    return NextResponse.json({ data: finalWorkflowData }, { status: 200 })
  } catch (error: any) {
    const elapsed = Date.now() - startTime
    logger.error(`[${requestId}] Error fetching workflow ${workflowId} after ${elapsed}ms`, error)
    const realtimeResponse = createWorkflowRealtimeRequiredResponse(error)
    if (realtimeResponse) return realtimeResponse
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

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

    const accessContext = await readWorkflowAccessContext(workflowId, userId)
    const workflowData = accessContext?.workflow || (await readWorkflowById(workflowId))

    if (!workflowData) {
      logger.warn(`[${requestId}] Workflow ${workflowId} not found for deletion`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    let canDelete = false

    if (workflowData.userId === userId) {
      canDelete = true
    }

    if (!canDelete && workflowData.workspaceId) {
      const context = accessContext || (await readWorkflowAccessContext(workflowId, userId))
      if (context?.isWorkspaceOwner || context?.workspacePermission === 'admin') {
        canDelete = true
      }
    }

    if (!canDelete) {
      logger.warn(
        `[${requestId}] User ${userId} denied permission to delete workflow ${workflowId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    await withYjsSessionDeletionLease({ sessionIds: [workflowId] }, () =>
      db.delete(workflow).where(eq(workflow.id, workflowId))
    )

    if (workflowData.workspaceId) {
      await refreshWorkflowList(workflowData.workspaceId)
    }
    const elapsed = Date.now() - startTime
    logger.info(`[${requestId}] Successfully deleted workflow ${workflowId} in ${elapsed}ms`)

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error: any) {
    const elapsed = Date.now() - startTime
    logger.error(`[${requestId}] Error deleting workflow ${workflowId} after ${elapsed}ms`, error)
    const realtimeResponse = createWorkflowRealtimeRequiredResponse(error)
    if (realtimeResponse) return realtimeResponse
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT /api/workflows/[id]
 * Update workflow row metadata (name, description, folderId)
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
    const accessContext = await readWorkflowAccessContext(workflowId, userId)
    const workflowData = accessContext?.workflow || (await readWorkflowById(workflowId))

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
      const context = accessContext || (await readWorkflowAccessContext(workflowId, userId))
      if (
        context?.isWorkspaceOwner ||
        context?.workspacePermission === 'write' ||
        context?.workspacePermission === 'admin'
      ) {
        canUpdate = true
      }
    }

    if (!canUpdate) {
      logger.warn(
        `[${requestId}] User ${userId} denied permission to update workflow ${workflowId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const hasRowUpdates = updates.description !== undefined || updates.folderId !== undefined
    if (updates.name && !workflowData.workspaceId) {
      throw new SavedEntityIdentityError(400, 'Workflow workspace is required')
    }
    const updatedWorkflow =
      hasRowUpdates || updates.name
        ? await db.transaction(async (tx) => {
            let row = workflowData
            if (hasRowUpdates) {
              const [updated] = await tx
                .update(workflow)
                .set({
                  ...(updates.description !== undefined
                    ? { description: updates.description }
                    : {}),
                  ...(updates.folderId !== undefined ? { folderId: updates.folderId } : {}),
                  updatedAt: new Date(),
                })
                .where(eq(workflow.id, workflowId))
                .returning()
              if (!updated) {
                throw new SavedEntityIdentityError(404, 'Workflow not found')
              }
              row = { ...row, ...updated }
            }

            if (!updates.name) return row
            const identity = await renameSavedEntityIdentityInTx(tx, {
              entityKind: 'workflow',
              entityId: workflowId,
              workspaceId: workflowData.workspaceId as string,
              name: updates.name,
            })
            return { ...row, ...identity }
          })
        : workflowData
    if (hasRowUpdates || updates.name) {
      await refreshWorkflowListForWorkflow(workflowId)
    }

    const elapsed = Date.now() - startTime
    logger.info(`[${requestId}] Successfully updated workflow ${workflowId} in ${elapsed}ms`, {
      updates,
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
    if (error instanceof SavedEntityIdentityError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    logger.error(`[${requestId}] Error updating workflow ${workflowId} after ${elapsed}ms`, error)
    const realtimeResponse = createWorkflowRealtimeRequiredResponse(error)
    if (realtimeResponse) return realtimeResponse
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
