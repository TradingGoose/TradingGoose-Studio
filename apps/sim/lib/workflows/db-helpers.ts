import {
  db,
  workflow,
  workflowBlocks,
  workflowDeploymentVersion,
  workflowEdges,
  workflowSubflows,
} from '@sim/db'
import type { InferSelectModel } from 'drizzle-orm'
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import type { Edge } from 'reactflow'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console/logger'
import { sanitizeAgentToolsInBlocks } from '@/lib/workflows/validation'
import type { BlockState, Loop, Parallel, WorkflowState } from '@/stores/workflows/workflow/types'
import { SUBFLOW_TYPES } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowDBHelpers')

async function ensureUniqueBlockIds(
  workflowId: string,
  state: WorkflowState
): Promise<WorkflowState> {
  const blockEntries = Object.entries(state.blocks || {})
  if (blockEntries.length === 0) {
    return state
  }

  const blockIds = blockEntries.map(([id]) => id)

  const conflictingIdsResult =
    blockIds.length === 0
      ? []
      : await db
          .select({ id: workflowBlocks.id })
          .from(workflowBlocks)
          .where(and(inArray(workflowBlocks.id, blockIds), ne(workflowBlocks.workflowId, workflowId)))

  const conflictingIds = new Set(conflictingIdsResult.map((row) => row.id))
  const remap = new Map<string, string>()
  const seen = new Set<string>()

  for (const id of blockIds) {
    if (seen.has(id) || conflictingIds.has(id)) {
      const newId = uuidv4()
      remap.set(id, newId)
      seen.add(newId)
    } else {
      seen.add(id)
    }
  }

  if (remap.size === 0) {
    return state
  }

  logger.warn(
    `Detected ${remap.size} duplicate block id(s) while saving workflow ${workflowId}. Regenerating ids for safe persistence.`,
    { workflowId }
  )

  const remapId = (id?: string | null) => {
    if (!id) return id
    return remap.get(id) ?? id
  }

  const updatedBlocks: Record<string, BlockState> = {}
  blockEntries.forEach(([blockId, block]) => {
    const nextId = remap.get(blockId) ?? blockId
    let nextData = block.data
    if (block.data?.parentId) {
      const nextParent = remap.get(block.data.parentId)
      if (nextParent) {
        nextData = {
          ...block.data,
          parentId: nextParent,
        }
        if (!nextData.extent) {
          nextData.extent = 'parent'
        }
      }
    }

    updatedBlocks[nextId] = {
      ...block,
      id: nextId,
      data: nextData,
    }
  })

  const updatedEdges = (state.edges || []).map((edge) => ({
    ...edge,
    source: remapId(edge.source) as string,
    target: remapId(edge.target) as string,
  }))

  const updatedLoops: Record<string, Loop> = {}
  Object.entries(state.loops || {}).forEach(([loopId, loop]) => {
    const nextId = remapId(loopId) as string
    updatedLoops[nextId] = {
      ...loop,
      id: nextId,
      nodes: loop.nodes.map((nodeId) => (remapId(nodeId) as string) ?? nodeId),
    }
  })

  const updatedParallels: Record<string, Parallel> = {}
  Object.entries(state.parallels || {}).forEach(([parallelId, parallel]) => {
    const nextId = remapId(parallelId) as string
    updatedParallels[nextId] = {
      ...parallel,
      id: nextId,
      nodes: parallel.nodes.map((nodeId) => (remapId(nodeId) as string) ?? nodeId),
    }
  })

  return {
    ...state,
    blocks: updatedBlocks,
    edges: updatedEdges,
    loops: updatedLoops,
    parallels: updatedParallels,
  }
}

// Database types
export type WorkflowDeploymentVersion = InferSelectModel<typeof workflowDeploymentVersion>

// API response types (dates are serialized as strings)
export interface WorkflowDeploymentVersionResponse {
  id: string
  version: number
  name?: string | null
  isActive: boolean
  createdAt: string
  createdBy?: string | null
  deployedBy?: string | null
}

export interface NormalizedWorkflowData {
  blocks: Record<string, BlockState>
  edges: Edge[]
  loops: Record<string, Loop>
  parallels: Record<string, Parallel>
  isFromNormalizedTables: boolean // Flag to indicate source (true = normalized tables, false = deployed state)
}

export async function blockExistsInDeployment(
  workflowId: string,
  blockId: string
): Promise<boolean> {
  try {
    const [result] = await db
      .select({ state: workflowDeploymentVersion.state })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, workflowId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .limit(1)

    if (!result?.state) {
      return false
    }

    const state = result.state as WorkflowState
    return !!state.blocks?.[blockId]
  } catch (error) {
    logger.error(`Error checking block ${blockId} in deployment for workflow ${workflowId}:`, error)
    return false
  }
}

export async function loadDeployedWorkflowState(
  workflowId: string
): Promise<NormalizedWorkflowData> {
  try {
    const [active] = await db
      .select({
        state: workflowDeploymentVersion.state,
        createdAt: workflowDeploymentVersion.createdAt,
      })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, workflowId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .orderBy(desc(workflowDeploymentVersion.createdAt))
      .limit(1)

    if (!active?.state) {
      throw new Error(`Workflow ${workflowId} has no active deployment`)
    }

    const state = active.state as WorkflowState

    return {
      blocks: state.blocks || {},
      edges: state.edges || [],
      loops: state.loops || {},
      parallels: state.parallels || {},
      isFromNormalizedTables: false,
    }
  } catch (error) {
    logger.error(`Error loading deployed workflow state ${workflowId}:`, error)
    throw error
  }
}

/**
 * Load workflow state from normalized tables
 * Returns null if no data found (fallback to JSON blob)
 */
export async function loadWorkflowFromNormalizedTables(
  workflowId: string
): Promise<NormalizedWorkflowData | null> {
  try {
    // Load all components in parallel
    const [blocks, edges, subflows] = await Promise.all([
      db.select().from(workflowBlocks).where(eq(workflowBlocks.workflowId, workflowId)),
      db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, workflowId)),
      db.select().from(workflowSubflows).where(eq(workflowSubflows.workflowId, workflowId)),
    ])

    // If no blocks found, assume this workflow hasn't been migrated yet
    if (blocks.length === 0) {
      return null
    }

    // Convert blocks to the expected format
    const blocksMap: Record<string, BlockState> = {}
    blocks.forEach((block) => {
      const blockData = block.data || {}

      const assembled: BlockState = {
        id: block.id,
        type: block.type,
        name: block.name,
        position: {
          x: Number(block.positionX),
          y: Number(block.positionY),
        },
        enabled: block.enabled,
        horizontalHandles: block.horizontalHandles,
        isWide: block.isWide,
        advancedMode: block.advancedMode,
        triggerMode: block.triggerMode,
        height: Number(block.height),
        subBlocks: (block.subBlocks as BlockState['subBlocks']) || {},
        outputs: (block.outputs as BlockState['outputs']) || {},
        data: blockData,
      }

      blocksMap[block.id] = assembled
    })

    // Sanitize any invalid custom tools in agent blocks to prevent client crashes
    const { blocks: sanitizedBlocks } = sanitizeAgentToolsInBlocks(blocksMap)

    // Convert edges to the expected format
    const edgesArray: Edge[] = edges.map((edge) => ({
      id: edge.id,
      source: edge.sourceBlockId,
      target: edge.targetBlockId,
      sourceHandle: edge.sourceHandle ?? undefined,
      targetHandle: edge.targetHandle ?? undefined,
      type: 'default',
      data: {},
    }))

    // Convert subflows to loops and parallels
    const loops: Record<string, Loop> = {}
    const parallels: Record<string, Parallel> = {}

    subflows.forEach((subflow) => {
      const config = (subflow.config ?? {}) as Partial<Loop & Parallel>

      if (subflow.type === SUBFLOW_TYPES.LOOP) {
        const loop: Loop = {
          id: subflow.id,
          nodes: Array.isArray((config as Loop).nodes) ? (config as Loop).nodes : [],
          iterations:
            typeof (config as Loop).iterations === 'number' ? (config as Loop).iterations : 1,
          loopType:
            (config as Loop).loopType === 'for' ||
            (config as Loop).loopType === 'forEach' ||
            (config as Loop).loopType === 'while' ||
            (config as Loop).loopType === 'doWhile'
              ? (config as Loop).loopType
              : 'for',
          forEachItems: (config as Loop).forEachItems ?? '',
          whileCondition: (config as Loop).whileCondition ?? undefined,
        }
        loops[subflow.id] = loop
      } else if (subflow.type === SUBFLOW_TYPES.PARALLEL) {
        const parallel: Parallel = {
          id: subflow.id,
          nodes: Array.isArray((config as Parallel).nodes) ? (config as Parallel).nodes : [],
          count: typeof (config as Parallel).count === 'number' ? (config as Parallel).count : 2,
          distribution: (config as Parallel).distribution ?? '',
          parallelType:
            (config as Parallel).parallelType === 'count' ||
            (config as Parallel).parallelType === 'collection'
              ? (config as Parallel).parallelType
              : 'count',
        }
        parallels[subflow.id] = parallel
      } else {
        logger.warn(`Unknown subflow type: ${subflow.type} for subflow ${subflow.id}`)
      }
    })

    return {
      blocks: sanitizedBlocks,
      edges: edgesArray,
      loops,
      parallels,
      isFromNormalizedTables: true,
    }
  } catch (error) {
    logger.error(`Error loading workflow ${workflowId} from normalized tables:`, error)
    return null
  }
}

/**
 * Save workflow state to normalized tables
 */
export async function saveWorkflowToNormalizedTables(
  workflowId: string,
  state: WorkflowState
): Promise<{ success: boolean; error?: string }> {
  try {
    const normalizedState = await ensureUniqueBlockIds(workflowId, state)

    const sanitizeNumberForDecimal = (value: unknown): string => {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return '0'
      }
      return value.toString()
    }

    const sanitizedBlockRecords = Object.values(normalizedState.blocks || {}).reduce<
      Array<typeof workflowBlocks.$inferInsert>
    >((acc, block) => {
      if (!block || typeof block !== 'object') {
        logger.warn(`Skipping invalid block when saving workflow ${workflowId}`)
        return acc
      }

      const blockId =
        typeof block.id === 'string' && block.id.trim().length > 0 ? block.id.trim() : null
      if (!blockId) {
        logger.warn(`Skipping block without id when saving workflow ${workflowId}`)
        return acc
      }

      const blockType =
        typeof block.type === 'string' && block.type.trim().length > 0 ? block.type.trim() : null
      if (!blockType) {
        logger.warn(`Skipping block ${blockId} without type when saving workflow ${workflowId}`)
        return acc
      }

      const blockName =
        typeof block.name === 'string' && block.name.trim().length > 0
          ? block.name.trim()
          : blockType

      acc.push({
        id: blockId,
        workflowId,
        type: blockType,
        name: blockName,
        positionX: sanitizeNumberForDecimal(block.position?.x),
        positionY: sanitizeNumberForDecimal(block.position?.y),
        enabled: block.enabled ?? true,
        horizontalHandles: block.horizontalHandles ?? true,
        isWide: block.isWide ?? false,
        advancedMode: block.advancedMode ?? false,
        triggerMode: block.triggerMode ?? false,
        height: sanitizeNumberForDecimal(block.height ?? 0),
        subBlocks: block.subBlocks || {},
        outputs: block.outputs || {},
        data: block.data || {},
        parentId: block.data?.parentId || null,
        extent: block.data?.extent || null,
      })

      return acc
    }, [])

    const validBlockIds = new Set(sanitizedBlockRecords.map((block) => block.id))

    const sanitizedEdgeRecords = (normalizedState.edges || []).reduce<
      Array<typeof workflowEdges.$inferInsert>
    >((acc, edge) => {
      if (!edge || typeof edge !== 'object') {
        logger.warn(`Skipping invalid edge when saving workflow ${workflowId}`)
        return acc
      }

      const edgeId =
        typeof edge.id === 'string' && edge.id.trim().length > 0 ? edge.id.trim() : null
      const sourceId =
        typeof edge.source === 'string' && edge.source.trim().length > 0
          ? edge.source.trim()
          : null
      const targetId =
        typeof edge.target === 'string' && edge.target.trim().length > 0
          ? edge.target.trim()
          : null

      if (!edgeId || !sourceId || !targetId) {
        logger.warn(`Skipping edge with missing identifiers when saving workflow ${workflowId}`)
        return acc
      }

      if (!validBlockIds.has(sourceId) || !validBlockIds.has(targetId)) {
        logger.warn(
          `Skipping edge ${edgeId} referencing missing blocks (${sourceId} -> ${targetId}) for workflow ${workflowId}`
        )
        return acc
      }

      const sanitizeHandle = (handle?: unknown) =>
        typeof handle === 'string' && handle.trim().length > 0 ? handle.trim() : null

      acc.push({
        id: edgeId,
        workflowId,
        sourceBlockId: sourceId,
        targetBlockId: targetId,
        sourceHandle: sanitizeHandle(edge.sourceHandle),
        targetHandle: sanitizeHandle(edge.targetHandle),
      })

      return acc
    }, [])

    // Start a transaction
    await db.transaction(async (tx) => {
      // Lock the workflow row to prevent concurrent saves from colliding on primary keys
      await tx.execute(
        sql`select id from "workflow" where "workflow"."id" = ${workflowId} for update`
      )

      // Clear existing data for this workflow
      await Promise.all([
        tx.delete(workflowBlocks).where(eq(workflowBlocks.workflowId, workflowId)),
        tx.delete(workflowEdges).where(eq(workflowEdges.workflowId, workflowId)),
        tx.delete(workflowSubflows).where(eq(workflowSubflows.workflowId, workflowId)),
      ])

      // Insert blocks
      if (sanitizedBlockRecords.length > 0) {
        await tx.insert(workflowBlocks).values(sanitizedBlockRecords)
      }

      // Insert edges
      if (sanitizedEdgeRecords.length > 0) {
        await tx.insert(workflowEdges).values(sanitizedEdgeRecords)
      }

      // Insert subflows (loops and parallels)
      const subflowInserts: any[] = []

      // Add loops
      Object.values(normalizedState.loops || {}).forEach((loop) => {
        subflowInserts.push({
          id: loop.id,
          workflowId: workflowId,
          type: SUBFLOW_TYPES.LOOP,
          config: loop,
        })
      })

      // Add parallels
      Object.values(normalizedState.parallels || {}).forEach((parallel) => {
        subflowInserts.push({
          id: parallel.id,
          workflowId: workflowId,
          type: SUBFLOW_TYPES.PARALLEL,
          config: parallel,
        })
      })

      if (subflowInserts.length > 0) {
        await tx.insert(workflowSubflows).values(subflowInserts)
      }
    })

    return { success: true }
  } catch (error) {
    const causeMessage =
      error && typeof error === 'object' && 'cause' in error && error.cause instanceof Error
        ? error.cause.message
        : undefined

    logger.error(`Error saving workflow ${workflowId} to normalized tables:`, {
      error,
      cause: causeMessage,
    })
    return {
      success: false,
      error: causeMessage || (error instanceof Error ? error.message : 'Unknown error'),
    }
  }
}

/**
 * Check if a workflow exists in normalized tables
 */
export async function workflowExistsInNormalizedTables(workflowId: string): Promise<boolean> {
  try {
    const blocks = await db
      .select({ id: workflowBlocks.id })
      .from(workflowBlocks)
      .where(eq(workflowBlocks.workflowId, workflowId))
      .limit(1)

    return blocks.length > 0
  } catch (error) {
    logger.error(`Error checking if workflow ${workflowId} exists in normalized tables:`, error)
    return false
  }
}

/**
 * Migrate a workflow from JSON blob to normalized tables
 */
export async function migrateWorkflowToNormalizedTables(
  workflowId: string,
  jsonState: any
): Promise<{ success: boolean; error?: string }> {
  try {
    // Convert JSON state to WorkflowState format
    // Only include fields that are actually persisted to normalized tables
    const workflowState: WorkflowState = {
      blocks: jsonState.blocks || {},
      edges: jsonState.edges || [],
      loops: jsonState.loops || {},
      parallels: jsonState.parallels || {},
      lastSaved: jsonState.lastSaved,
      isDeployed: jsonState.isDeployed,
      deployedAt: jsonState.deployedAt,
    }

    return await saveWorkflowToNormalizedTables(workflowId, workflowState)
  } catch (error) {
    logger.error(`Error migrating workflow ${workflowId} to normalized tables:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Deploy a workflow by creating a new deployment version
 */
export async function deployWorkflow(params: {
  workflowId: string
  deployedBy: string // User ID of the person deploying
  pinnedApiKeyId?: string
  includeDeployedState?: boolean
  workflowName?: string
}): Promise<{
  success: boolean
  version?: number
  deployedAt?: Date
  currentState?: any
  error?: string
}> {
  const {
    workflowId,
    deployedBy,
    pinnedApiKeyId,
    includeDeployedState = false,
    workflowName,
  } = params

  try {
    const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)
    if (!normalizedData) {
      return { success: false, error: 'Failed to load workflow state' }
    }

    const currentState = {
      blocks: normalizedData.blocks,
      edges: normalizedData.edges,
      loops: normalizedData.loops,
      parallels: normalizedData.parallels,
      lastSaved: Date.now(),
    }

    const now = new Date()

    const deployedVersion = await db.transaction(async (tx) => {
      // Get next version number
      const [{ maxVersion }] = await tx
        .select({ maxVersion: sql`COALESCE(MAX("version"), 0)` })
        .from(workflowDeploymentVersion)
        .where(eq(workflowDeploymentVersion.workflowId, workflowId))

      const nextVersion = Number(maxVersion) + 1

      // Deactivate all existing versions
      await tx
        .update(workflowDeploymentVersion)
        .set({ isActive: false })
        .where(eq(workflowDeploymentVersion.workflowId, workflowId))

      // Create new deployment version
      await tx.insert(workflowDeploymentVersion).values({
        id: uuidv4(),
        workflowId,
        version: nextVersion,
        state: currentState,
        isActive: true,
        createdBy: deployedBy,
        createdAt: now,
      })

      // Update workflow to deployed
      const updateData: Record<string, unknown> = {
        isDeployed: true,
        deployedAt: now,
      }

      if (includeDeployedState) {
        updateData.deployedState = currentState
      }

      if (pinnedApiKeyId) {
        updateData.pinnedApiKeyId = pinnedApiKeyId
      }

      await tx.update(workflow).set(updateData).where(eq(workflow.id, workflowId))

      return nextVersion
    })

    logger.info(`Deployed workflow ${workflowId} as v${deployedVersion}`)

    // Track deployment telemetry if workflow name is provided
    if (workflowName) {
      try {
        const { trackPlatformEvent } = await import('@/lib/telemetry/tracer')

        const blockTypeCounts: Record<string, number> = {}
        for (const block of Object.values(currentState.blocks)) {
          const blockType = (block as any).type || 'unknown'
          blockTypeCounts[blockType] = (blockTypeCounts[blockType] || 0) + 1
        }

        trackPlatformEvent('platform.workflow.deployed', {
          'workflow.id': workflowId,
          'workflow.name': workflowName,
          'workflow.blocks_count': Object.keys(currentState.blocks).length,
          'workflow.edges_count': currentState.edges.length,
          'workflow.loops_count': Object.keys(currentState.loops).length,
          'workflow.parallels_count': Object.keys(currentState.parallels).length,
          'workflow.block_types': JSON.stringify(blockTypeCounts),
          'deployment.version': deployedVersion,
        })
      } catch (telemetryError) {
        logger.warn(`Failed to track deployment telemetry for ${workflowId}`, telemetryError)
      }
    }

    return {
      success: true,
      version: deployedVersion,
      deployedAt: now,
      currentState,
    }
  } catch (error) {
    logger.error(`Error deploying workflow ${workflowId}:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
