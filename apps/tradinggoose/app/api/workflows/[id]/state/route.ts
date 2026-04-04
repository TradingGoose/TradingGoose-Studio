import { db } from '@tradinggoose/db'
import { workflow } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { extractAndPersistCustomTools } from '@/lib/workflows/custom-tools-persistence'
import { saveWorkflowToNormalizedTables, toISOStringOrUndefined } from '@/lib/workflows/db-helpers'
import { getWorkflowAccessContext } from '@/lib/workflows/utils'
import { sanitizeAgentToolsInBlocks } from '@/lib/workflows/validation'
import { tryApplyWorkflowState } from '@/lib/yjs/server/apply-workflow-state'
import { getVariablesSnapshot, type WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import { getExistingDocument } from '@/socket-server/yjs/upstream-utils'

const logger = createLogger('WorkflowStateAPI')

const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

const BlockDataSchema = z.object({
  parentId: z.string().optional(),
  extent: z.literal('parent').optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  collection: z.unknown().optional(),
  count: z.number().optional(),
  loopType: z.enum(['for', 'forEach', 'while', 'doWhile']).optional(),
  whileCondition: z.string().optional(),
  parallelType: z.enum(['collection', 'count']).optional(),
  type: z.string().optional(),
})

const SubBlockStateSchema = z.object({
  id: z.string(),
  type: z.string(),
  value: z.any(),
})

const BlockOutputSchema = z.any()

const BlockLayoutSchema = z.object({
  measuredWidth: z.number().optional(),
  measuredHeight: z.number().optional(),
})

const BlockStateSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  position: PositionSchema,
  subBlocks: z.record(SubBlockStateSchema),
  outputs: z.record(BlockOutputSchema),
  enabled: z.boolean(),
  horizontalHandles: z.boolean().optional(),
  isWide: z.boolean().optional(),
  height: z.number().optional(),
  advancedMode: z.boolean().optional(),
  triggerMode: z.boolean().optional(),
  data: BlockDataSchema.optional(),
  layout: BlockLayoutSchema.optional(),
})

const EdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  type: z.string().optional(),
  animated: z.boolean().optional(),
  style: z.record(z.any()).optional(),
  data: z.record(z.any()).optional(),
  label: z.string().optional(),
  labelStyle: z.record(z.any()).optional(),
  labelShowBg: z.boolean().optional(),
  labelBgStyle: z.record(z.any()).optional(),
  labelBgPadding: z.array(z.number()).optional(),
  labelBgBorderRadius: z.number().optional(),
  markerStart: z.string().optional(),
  markerEnd: z.string().optional(),
})

const LoopSchema = z.object({
  id: z.string(),
  nodes: z.array(z.string()),
  iterations: z.number(),
  loopType: z.enum(['for', 'forEach', 'while', 'doWhile']),
  forEachItems: z.union([z.array(z.any()), z.record(z.any()), z.string()]).optional(),
  whileCondition: z.string().optional(),
})

const ParallelSchema = z.object({
  id: z.string(),
  nodes: z.array(z.string()),
  distribution: z.union([z.array(z.any()), z.record(z.any()), z.string()]).optional(),
  count: z.number().optional(),
  parallelType: z.enum(['count', 'collection']).optional(),
})

const WorkflowStateSchema = z.object({
  blocks: z.record(BlockStateSchema),
  edges: z.array(EdgeSchema),
  loops: z.record(LoopSchema).optional(),
  parallels: z.record(ParallelSchema).optional(),
  lastSaved: z.number().optional(),
  isDeployed: z.boolean().optional(),
  deployedAt: z.coerce.date().optional(),
  variables: z.record(z.any()).optional(),
})

/**
 * PUT /api/workflows/[id]/state
 * Save complete workflow state to normalized database tables
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const startTime = Date.now()
  const { id: workflowId } = await params

  try {
    // Get the session
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized state update attempt for workflow ${workflowId}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Parse and validate request body
    const body = await request.json()
    const state = WorkflowStateSchema.parse(body)

    // Fetch the workflow to check ownership/access
    const accessContext = await getWorkflowAccessContext(workflowId, userId)
    const workflowData = accessContext?.workflow

    if (!workflowData) {
      logger.warn(`[${requestId}] Workflow ${workflowId} not found for state update`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Check if user has permission to update this workflow
    const canUpdate =
      accessContext?.isOwner ||
      (workflowData.workspaceId
        ? accessContext?.workspacePermission === 'write' ||
          accessContext?.workspacePermission === 'admin'
        : false)

    if (!canUpdate) {
      logger.warn(
        `[${requestId}] User ${userId} denied permission to update workflow state ${workflowId}`
      )
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Sanitize custom tools in agent blocks before saving
    const { blocks: sanitizedBlocks, warnings } = sanitizeAgentToolsInBlocks(state.blocks as any)

    // Filter out blocks without type or name before saving
    const filteredBlocks = Object.entries(sanitizedBlocks).reduce(
      (acc, [blockId, block]: [string, any]) => {
        if (!block?.type) {
          logger.warn(`[${requestId}] Skipping block ${blockId} due to missing type`)
          return acc
        }

        acc[blockId] = {
          ...block,
          id: block.id || blockId,
          name: typeof block.name === 'string' ? block.name : '',
          enabled: block.enabled !== undefined ? block.enabled : true,
          horizontalHandles: block.horizontalHandles !== undefined ? block.horizontalHandles : true,
          isWide: block.isWide !== undefined ? block.isWide : false,
          height: block.height !== undefined ? block.height : 0,
          subBlocks: block.subBlocks || {},
          outputs: block.outputs || {},
        }

        return acc
      },
      {} as typeof state.blocks
    )

    const workflowState = {
      blocks: filteredBlocks,
      edges: state.edges,
      loops: state.loops || {},
      parallels: state.parallels || {},
      lastSaved: toISOStringOrUndefined(state.lastSaved) ?? new Date().toISOString(),
      isDeployed: state.isDeployed || false,
      deployedAt: toISOStringOrUndefined(state.deployedAt),
    }

    // Prefer explicit request variables, otherwise fall back to the live Yjs doc.
    // If the doc is not mounted locally, preserve the current canonical row value.
    //
    // Note: getExistingDocument and the subsequent getDocument call inside
    // tryApplyWorkflowState both hit the same in-memory docs Map, so the
    // second lookup is an O(1) cache hit rather than a network round-trip.
    let variables = state.variables
    if (variables === undefined) {
      const liveDoc = await getExistingDocument(workflowId)
      if (liveDoc) {
        variables = getVariablesSnapshot(liveDoc)
      } else {
        variables = (workflowData.variables as Record<string, any> | null) ?? undefined
      }
    }

    const saveResult = await saveWorkflowToNormalizedTables(workflowId, workflowState as any)

    if (!saveResult.success) {
      logger.error(`[${requestId}] Failed to save workflow ${workflowId} state:`, saveResult.error)
      return NextResponse.json(
        { error: 'Failed to save workflow state', details: saveResult.error },
        { status: 500 }
      )
    }

    // Apply the validated state to the Yjs doc only after the canonical save succeeds.
    await tryApplyWorkflowState(workflowId, workflowState as WorkflowSnapshot, variables)

    // Extract and persist custom tools to database
    try {
      const { saved, errors } = await extractAndPersistCustomTools(
        workflowState,
        workflowData.workspaceId ?? null,
        userId
      )

      if (saved > 0) {
        logger.info(`[${requestId}] Persisted ${saved} custom tool(s) to database`, { workflowId })
      }

      if (errors.length > 0) {
        logger.warn(`[${requestId}] Some custom tools failed to persist`, { errors, workflowId })
      }
    } catch (error) {
      logger.error(`[${requestId}] Failed to persist custom tools`, { error, workflowId })
    }

    // Update workflow metadata and persist variables
    await db
      .update(workflow)
      .set({
        lastSynced: new Date(),
        updatedAt: new Date(),
        ...(variables ? { variables } : {}),
      })
      .where(eq(workflow.id, workflowId))

    const elapsed = Date.now() - startTime
    logger.info(`[${requestId}] Successfully saved workflow ${workflowId} state in ${elapsed}ms`)

    return NextResponse.json({ success: true, warnings }, { status: 200 })
  } catch (error: any) {
    const elapsed = Date.now() - startTime
    logger.error(
      `[${requestId}] Error saving workflow ${workflowId} state after ${elapsed}ms`,
      error
    )

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request body', details: error.errors },
        { status: 400 }
      )
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
