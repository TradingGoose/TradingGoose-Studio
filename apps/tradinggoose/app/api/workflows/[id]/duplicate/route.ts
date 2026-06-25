import { db } from '@tradinggoose/db'
import { workflow } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { getStableVibrantColor } from '@/lib/colors'
import { createLogger } from '@/lib/logs/console/logger'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'
import {
  loadWorkflowState,
  regenerateWorkflowStateIds,
  saveWorkflowToNormalizedTables,
} from '@/lib/workflows/db-helpers'
import { remapVariableIds } from '@/lib/workflows/import-export'
import { normalizeVariables } from '@/lib/workflows/variable-utils'
import type { Variable } from '@/stores/variables/types'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowDuplicateAPI')

const DuplicateRequestSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  folderId: z.string().nullable().optional(),
})

async function loadSourceWorkflowArtifacts(sourceWorkflowId: string): Promise<{
  workflowState: WorkflowState
  variables: Record<string, Variable>
  source: 'yjs' | 'db'
}> {
  const stateWithSource = await loadWorkflowState(sourceWorkflowId)
  if (!stateWithSource) {
    throw new Error('Failed to load source workflow state')
  }

  return {
    workflowState: {
      ...(stateWithSource.direction !== undefined ? { direction: stateWithSource.direction } : {}),
      blocks: stateWithSource.blocks,
      edges: stateWithSource.edges,
      loops: stateWithSource.loops,
      parallels: stateWithSource.parallels,
      lastSaved: stateWithSource.lastSaved ?? Date.now(),
      isDeployed: false,
    },
    variables: normalizeVariables(stateWithSource.variables),
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
    const { name, description, workspaceId, folderId } = DuplicateRequestSchema.parse(body)

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

    if (!source.workspaceId) {
      throw new Error('Source workflow not found or access denied')
    }

    const sourceWorkspaceAccess = await checkWorkspaceAccess(source.workspaceId, session.user.id)
    if (!sourceWorkspaceAccess.canWrite) {
      throw new Error('Source workflow not found or access denied')
    }

    const workspaceAccess = await checkWorkspaceAccess(workspaceId, session.user.id)
    if (!workspaceAccess.exists) {
      return NextResponse.json(
        { error: 'Workspace not found', code: 'WORKSPACE_NOT_FOUND' },
        { status: 404 }
      )
    }
    if (!workspaceAccess.canWrite) {
      return NextResponse.json(
        { error: 'Write or Admin access required to duplicate workflows in this workspace' },
        { status: 403 }
      )
    }

    const sourceArtifacts = await loadSourceWorkflowArtifacts(sourceWorkflowId)

    const newWorkflowId = crypto.randomUUID()
    const now = new Date()
    const resolvedColor = getStableVibrantColor(newWorkflowId)

    const duplicatedWorkflowState = regenerateWorkflowStateIds(sourceArtifacts.workflowState)
    const duplicatedVariables = remapVariableIds(sourceArtifacts.variables, newWorkflowId)

    await db.insert(workflow).values({
      id: newWorkflowId,
      userId: session.user.id,
      workspaceId,
      folderId: folderId || null,
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

    const saveResult = await saveWorkflowToNormalizedTables(newWorkflowId, {
      ...duplicatedWorkflowState,
      lastSaved: now.getTime(),
      isDeployed: false,
    })
    if (!saveResult.success) {
      await db.delete(workflow).where(eq(workflow.id, newWorkflowId))
      throw new Error(saveResult.error || 'Failed to persist duplicated workflow state')
    }
    const persistedDuplicatedState = saveResult.normalizedState ?? duplicatedWorkflowState

    logger.info(`[${requestId}] Duplicated workflow state using ${sourceArtifacts.source} source`, {
      sourceWorkflowId,
      newWorkflowId,
      blocksCount: Object.keys(persistedDuplicatedState.blocks || {}).length,
      edgesCount: persistedDuplicatedState.edges?.length || 0,
      variablesCount: Object.keys(duplicatedVariables).length,
    })

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
        workspaceId,
        folderId: folderId || null,
        blocksCount: Object.keys(persistedDuplicatedState.blocks || {}).length,
        edgesCount: persistedDuplicatedState.edges?.length || 0,
        subflowsCount:
          Object.keys(persistedDuplicatedState.loops || {}).length +
          Object.keys(persistedDuplicatedState.parallels || {}).length,
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
