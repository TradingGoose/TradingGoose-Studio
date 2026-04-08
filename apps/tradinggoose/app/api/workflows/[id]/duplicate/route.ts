import { db } from '@tradinggoose/db'
import { workflow } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { getStableVibrantColor } from '@/lib/colors'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'
import { normalizeVariables } from '@/lib/workflows/variable-utils'
import {
  loadWorkflowStateWithFallback,
  regenerateWorkflowStateIds,
  remapVariableIds,
  saveWorkflowToNormalizedTables,
} from '@/lib/workflows/db-helpers'
import { tryApplyWorkflowState } from '@/lib/yjs/server/apply-workflow-state'
import { createWorkflowSnapshot } from '@/lib/yjs/workflow-session'
import type { Variable } from '@/stores/variables/types'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowDuplicateAPI')

const DuplicateRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  color: z.string().optional(),
  workspaceId: z.string().optional(),
  folderId: z.string().nullable().optional(),
})

async function loadSourceWorkflowArtifacts(
  sourceWorkflowId: string,
  sourceVariables: unknown
): Promise<{
  workflowState: WorkflowState
  variables: Record<string, Variable>
  source: 'yjs' | 'normalized'
}> {
  const stateWithSource = await loadWorkflowStateWithFallback(sourceWorkflowId)
  if (!stateWithSource) {
    throw new Error('Failed to load source workflow state')
  }

  // When the state came from Yjs the variables are already embedded in the
  // snapshot.  For the normalized-table path, prefer the caller-supplied
  // source variables (from the workflow row).
  const variables =
    stateWithSource.source === 'yjs'
      ? normalizeVariables(stateWithSource.variables)
      : normalizeVariables(sourceVariables)

  return {
    workflowState: {
      blocks: stateWithSource.blocks,
      edges: stateWithSource.edges,
      loops: stateWithSource.loops,
      parallels: stateWithSource.parallels,
      lastSaved: stateWithSource.lastSaved ?? Date.now(),
      isDeployed: false,
    },
    variables,
    source: stateWithSource.source,
  }
}

// POST /api/workflows/[id]/duplicate - Duplicate a workflow with all its live state
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sourceWorkflowId } = await params
  const requestId = generateRequestId()
  const startTime = Date.now()

  const session = await getSession()
  if (!session?.user?.id) {
    logger.warn(`[${requestId}] Unauthorized workflow duplication attempt for ${sourceWorkflowId}`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { name, description, color, workspaceId, folderId } = DuplicateRequestSchema.parse(body)

    logger.info(
      `[${requestId}] Duplicating workflow ${sourceWorkflowId} for user ${session.user.id}`
    )

    const [source] = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, sourceWorkflowId))
      .limit(1)

    if (!source) {
      throw new Error('Source workflow not found')
    }

    let canAccessSource = false

    if (source.userId === session.user.id) {
      canAccessSource = true
    }

    if (!canAccessSource && source.workspaceId) {
      const userPermission = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        source.workspaceId
      )
      if (userPermission === 'admin' || userPermission === 'write') {
        canAccessSource = true
      }
    }

    if (!canAccessSource) {
      throw new Error('Source workflow not found or access denied')
    }

    const sourceArtifacts = await loadSourceWorkflowArtifacts(sourceWorkflowId, source.variables)

    const newWorkflowId = crypto.randomUUID()
    const now = new Date()
    const resolvedColor =
      typeof color === 'string' && color.trim().length > 0
        ? color.trim()
        : getStableVibrantColor(newWorkflowId)

    const duplicatedWorkflowState = regenerateWorkflowStateIds(sourceArtifacts.workflowState)
    const duplicatedVariables = remapVariableIds(sourceArtifacts.variables, newWorkflowId)

    await db.insert(workflow).values({
      id: newWorkflowId,
      userId: session.user.id,
      workspaceId: workspaceId || source.workspaceId,
      folderId: folderId || source.folderId,
      name,
      description: description || source.description,
      color: resolvedColor,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
      isDeployed: false,
      collaborators: [],
      runCount: 0,
      variables: duplicatedVariables,
      isPublished: false,
      marketplaceData: null,
    })

    try {
      const lastSaved = now.toISOString()
      const duplicatedSnapshot = createWorkflowSnapshot({
        blocks: duplicatedWorkflowState.blocks,
        edges: duplicatedWorkflowState.edges,
        loops: duplicatedWorkflowState.loops,
        parallels: duplicatedWorkflowState.parallels,
        lastSaved,
        isDeployed: false,
      })

      // Persist canonical workflow state before best-effort Yjs sync so the duplicate
      // survives bridge outages and never depends on socket-server availability.
      const saveResult = await saveWorkflowToNormalizedTables(newWorkflowId, duplicatedWorkflowState)
      if (!saveResult.success) {
        throw new Error(saveResult.error || 'Failed to save duplicated workflow state')
      }

      const yjsApplyResult = await tryApplyWorkflowState(
        newWorkflowId,
        duplicatedSnapshot,
        duplicatedVariables
      )
      if (!yjsApplyResult.success) {
        logger.warn(
          `[${requestId}] Duplicated workflow ${newWorkflowId} without Yjs sync; canonical state was persisted`,
          { sourceWorkflowId, newWorkflowId, error: yjsApplyResult.error }
        )
      }
    } catch (duplicationError) {
      await db.delete(workflow).where(eq(workflow.id, newWorkflowId))
      throw duplicationError
    }

    logger.info(
      `[${requestId}] Duplicated workflow state using ${sourceArtifacts.source} source`,
      {
        sourceWorkflowId,
        newWorkflowId,
        blocksCount: Object.keys(duplicatedWorkflowState.blocks || {}).length,
        edgesCount: duplicatedWorkflowState.edges?.length || 0,
        variablesCount: Object.keys(duplicatedVariables).length,
      }
    )

    const elapsed = Date.now() - startTime
    logger.info(
      `[${requestId}] Successfully duplicated workflow ${sourceWorkflowId} to ${newWorkflowId} in ${elapsed}ms`
    )

    return NextResponse.json(
      {
        id: newWorkflowId,
        name,
        description: description || source.description,
        color: resolvedColor,
        workspaceId: workspaceId || source.workspaceId,
        folderId: folderId || source.folderId,
        blocksCount: Object.keys(duplicatedWorkflowState.blocks || {}).length,
        edgesCount: duplicatedWorkflowState.edges?.length || 0,
        subflowsCount:
          Object.keys(duplicatedWorkflowState.loops || {}).length +
          Object.keys(duplicatedWorkflowState.parallels || {}).length,
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Source workflow not found') {
        logger.warn(`[${requestId}] Source workflow ${sourceWorkflowId} not found`)
        return NextResponse.json({ error: 'Source workflow not found' }, { status: 404 })
      }

      if (error.message === 'Source workflow not found or access denied') {
        logger.warn(
          `[${requestId}] User ${session.user.id} denied access to source workflow ${sourceWorkflowId}`
        )
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
      }
    }

    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid duplication request data`, { errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    const elapsed = Date.now() - startTime
    logger.error(
      `[${requestId}] Error duplicating workflow ${sourceWorkflowId} after ${elapsed}ms:`,
      error
    )
    return NextResponse.json({ error: 'Failed to duplicate workflow' }, { status: 500 })
  }
}
