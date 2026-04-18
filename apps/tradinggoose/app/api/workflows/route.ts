import { db } from '@tradinggoose/db'
import { workflow, workspace } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { getStableVibrantColor } from '@/lib/colors'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'
import { remapVariableIds, saveWorkflowToNormalizedTables } from '@/lib/workflows/db-helpers'
import { normalizeVariables } from '@/lib/workflows/variable-utils'
import { tryApplyWorkflowState } from '@/lib/yjs/server/apply-workflow-state'
import { createWorkflowSnapshot } from '@/lib/yjs/workflow-session'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { verifyWorkspaceMembership } from './utils'

const logger = createLogger('WorkflowAPI')

const CreateWorkflowSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional().default(''),
  color: z.string().optional(),
  workspaceId: z.string().optional(),
  folderId: z.string().nullable().optional(),
  initialWorkflowState: z.any().optional(),
})

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getInitialWorkflowState(
  initialWorkflowState: unknown,
  now: Date
): {
  canonicalState: WorkflowState
  variables: Record<string, unknown>
} | null {
  if (!isPlainObject(initialWorkflowState)) {
    return null
  }

  const blocks = isPlainObject(initialWorkflowState.blocks) ? initialWorkflowState.blocks : {}
  const edges = Array.isArray(initialWorkflowState.edges) ? initialWorkflowState.edges : []
  const loops = isPlainObject(initialWorkflowState.loops) ? initialWorkflowState.loops : {}
  const parallels = isPlainObject(initialWorkflowState.parallels)
    ? initialWorkflowState.parallels
    : {}
  const variables = isPlainObject(initialWorkflowState.variables)
    ? initialWorkflowState.variables
    : {}

  return {
    canonicalState: {
      blocks: blocks as WorkflowState['blocks'],
      edges: edges as WorkflowState['edges'],
      loops: loops as WorkflowState['loops'],
      parallels: parallels as WorkflowState['parallels'],
      lastSaved: now.getTime(),
      isDeployed: false,
      deployedAt: undefined,
      deploymentStatuses: {},
      needsRedeployment: false,
    },
    variables,
  }
}

// GET /api/workflows - Get workflows for user (optionally filtered by workspaceId)
export async function GET(request: Request) {
  const requestId = generateRequestId()
  const startTime = Date.now()
  const url = new URL(request.url)
  const workspaceId = url.searchParams.get('workspaceId')

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized workflow access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    if (workspaceId) {
      const workspaceExists = await db
        .select({ id: workspace.id })
        .from(workspace)
        .where(eq(workspace.id, workspaceId))
        .then((rows) => rows.length > 0)

      if (!workspaceExists) {
        logger.warn(
          `[${requestId}] Attempt to fetch workflows for non-existent workspace: ${workspaceId}`
        )
        return NextResponse.json(
          { error: 'Workspace not found', code: 'WORKSPACE_NOT_FOUND' },
          { status: 404 }
        )
      }

      const userRole = await verifyWorkspaceMembership(userId, workspaceId)

      if (!userRole) {
        logger.warn(
          `[${requestId}] User ${userId} attempted to access workspace ${workspaceId} without membership`
        )
        return NextResponse.json(
          { error: 'Access denied to this workspace', code: 'WORKSPACE_ACCESS_DENIED' },
          { status: 403 }
        )
      }
    }

    let workflows

    if (workspaceId) {
      workflows = await db.select().from(workflow).where(eq(workflow.workspaceId, workspaceId))
    } else {
      workflows = await db.select().from(workflow).where(eq(workflow.userId, userId))
    }

    return NextResponse.json({ data: workflows }, { status: 200 })
  } catch (error: any) {
    const elapsed = Date.now() - startTime
    logger.error(`[${requestId}] Workflow fetch error after ${elapsed}ms`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/workflows - Create a new workflow
export async function POST(req: NextRequest) {
  const requestId = generateRequestId()
  const session = await getSession()

  if (!session?.user?.id) {
    logger.warn(`[${requestId}] Unauthorized workflow creation attempt`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { name, description, color, workspaceId, folderId, initialWorkflowState } = CreateWorkflowSchema.parse(body)

    if (workspaceId) {
      const workspacePermission = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        workspaceId
      )

      if (!workspacePermission || workspacePermission === 'read') {
        logger.warn(
          `[${requestId}] User ${session.user.id} attempted to create workflow in workspace ${workspaceId} without write permissions`
        )
        return NextResponse.json(
          { error: 'Write or Admin access required to create workflows in this workspace' },
          { status: 403 }
        )
      }
    }

    const workflowId = crypto.randomUUID()
    const now = new Date()
    const initialState = getInitialWorkflowState(initialWorkflowState, now)
    const remappedVariables = remapVariableIds(
      normalizeVariables(initialState?.variables),
      workflowId
    )
    const resolvedColor =
      typeof color === 'string' && color.trim().length > 0
        ? color.trim()
        : getStableVibrantColor(workflowId)

    logger.info(`[${requestId}] Creating workflow ${workflowId} for user ${session.user.id}`)

    // Track workflow creation
    try {
      const { trackPlatformEvent } = await import('@/lib/telemetry/tracer')
      trackPlatformEvent('platform.workflow.created', {
        'workflow.id': workflowId,
        'workflow.name': name,
        'workflow.has_workspace': !!workspaceId,
        'workflow.has_folder': !!folderId,
      })
    } catch (_e) {
      // Silently fail
    }

    await db.insert(workflow).values({
      id: workflowId,
      userId: session.user.id,
      workspaceId: workspaceId || null,
      folderId: folderId || null,
      name,
      description,
      color: resolvedColor,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
      isDeployed: false,
      collaborators: [],
      runCount: 0,
      variables: remappedVariables,
      isPublished: false,
      marketplaceData: null,
    })

    let persistedInitialState = initialState?.canonicalState ?? null
    if (initialState) {
      const saveResult = await saveWorkflowToNormalizedTables(workflowId, initialState.canonicalState)
      if (!saveResult.success) {
        await db.delete(workflow).where(eq(workflow.id, workflowId))
        throw new Error(saveResult.error || 'Failed to persist initial workflow state')
      }
      persistedInitialState = saveResult.normalizedState ?? initialState.canonicalState
    }

    // Seed the Yjs doc for the new workflow
    const defaultWorkflowSnapshot = createWorkflowSnapshot({
      blocks: persistedInitialState?.blocks,
      edges: persistedInitialState?.edges,
      loops: persistedInitialState?.loops,
      parallels: persistedInitialState?.parallels,
      lastSaved: now.toISOString(),
      isDeployed: false,
    })

    const yjsSeedResult = await tryApplyWorkflowState(
      workflowId,
      defaultWorkflowSnapshot,
      remappedVariables
    )
    if (yjsSeedResult.success) {
      logger.info(`[${requestId}] Seeded Yjs doc for new workflow ${workflowId}`)
    }

    logger.info(`[${requestId}] Successfully created workflow ${workflowId}`)

    return NextResponse.json({
      id: workflowId,
      name,
      description,
      color: resolvedColor,
      workspaceId,
      folderId,
      createdAt: now,
      updatedAt: now,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid workflow creation data`, {
        errors: error.errors,
      })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error creating workflow`, error)
    return NextResponse.json({ error: 'Failed to create workflow' }, { status: 500 })
  }
}
