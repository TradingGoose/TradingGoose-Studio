import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import {
  ensureUniqueBlockIds,
  ensureUniqueEdgeIds,
  toISOStringOrUndefined,
} from '@/lib/workflows/db-helpers'
import { validateWorkflowPermissions } from '@/lib/workflows/utils'
import { sanitizeAgentToolsInBlocks } from '@/lib/workflows/validation'
import { applyWorkflowState } from '@/lib/yjs/server/apply-workflow-state'
import type { WorkflowSnapshot } from '@/lib/yjs/workflow-session'

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
  direction: z.enum(['TD', 'LR']).optional(),
  blocks: z.record(BlockStateSchema),
  edges: z.array(EdgeSchema),
  loops: z.record(LoopSchema).optional(),
  parallels: z.record(ParallelSchema).optional(),
  lastSaved: z.number().optional(),
  isDeployed: z.boolean().optional(),
  deployedAt: z.coerce.date().optional(),
  variables: z.record(z.any()),
})

/**
 * PUT /api/workflows/[id]/state
 * Save complete workflow state to Yjs and materialize derived database tables.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const startTime = Date.now()
  const { id: workflowId } = await params

  try {
    const {
      error,
      session,
      workflow: workflowData,
    } = await validateWorkflowPermissions(workflowId, requestId, 'write')
    if (error || !session?.user?.id || !workflowData) {
      return NextResponse.json(
        { error: error?.message ?? 'Unauthorized' },
        { status: error?.status ?? 401 }
      )
    }
    const userId = session.user.id

    // Parse and validate request body
    const body = await request.json()
    const state = WorkflowStateSchema.parse(body)

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
      ...(state.direction !== undefined ? { direction: state.direction } : {}),
      blocks: filteredBlocks,
      edges: state.edges,
      loops: state.loops || {},
      parallels: state.parallels || {},
      lastSaved: toISOStringOrUndefined(state.lastSaved) ?? new Date().toISOString(),
      isDeployed: state.isDeployed || false,
      deployedAt: toISOStringOrUndefined(state.deployedAt),
    }

    const stateWithUniqueBlockIds = await ensureUniqueBlockIds(workflowId, workflowState as any)
    const persistedWorkflowState = await ensureUniqueEdgeIds(workflowId, stateWithUniqueBlockIds)

    await applyWorkflowState(
      workflowId,
      persistedWorkflowState as WorkflowSnapshot,
      state.variables,
      workflowData.name
    )

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
