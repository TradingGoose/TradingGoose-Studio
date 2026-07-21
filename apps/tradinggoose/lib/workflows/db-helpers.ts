import {
  db,
  workflow,
  workflowBlocks,
  workflowDeploymentVersion,
  workflowEdges,
  workflowSubflows,
} from '@tradinggoose/db'
import type { Edge } from '@xyflow/react'
import type { InferSelectModel } from 'drizzle-orm'
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import * as Y from 'yjs'
import { reconcilePublishedChatsForDeploymentTx } from '@/lib/chat/published-deployment'
import { createLogger } from '@/lib/logs/console/logger'
import { sanitizeAgentToolsInBlocks } from '@/lib/workflows/validation'
import { inferWorkflowDirectionFromState } from '@/lib/workflows/workflow-direction'
import { refreshEntityListSession } from '@/lib/yjs/server/snapshot-bridge'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { extractPersistedStateFromDoc, setWorkflowState } from '@/lib/yjs/workflow-session'
import type {
  BlockState,
  Loop,
  Parallel,
  WorkflowDirection,
  WorkflowState,
} from '@/stores/workflows/workflow/types'
import { SUBFLOW_TYPES } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowDBHelpers')

type PersistableWorkflowState = WorkflowState & {
  variables?: Record<string, any>
}
type WorkflowReadStore = Pick<typeof db, 'select'>

const resolveLockedFromBlockData = (data: unknown): boolean => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return false
  }
  return Boolean((data as Record<string, unknown>).locked)
}

const upsertLockedInBlockData = (data: unknown, locked: boolean): Record<string, unknown> => {
  const next: Record<string, unknown> =
    data && typeof data === 'object' && !Array.isArray(data)
      ? { ...(data as Record<string, unknown>) }
      : {}

  if (locked) {
    next.locked = true
    return next
  }

  if (!('locked' in next)) {
    return next
  }

  const { locked: _locked, ...rest } = next
  return rest
}

const sanitizeBlockLayout = (layout: unknown): BlockState['layout'] => {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
    return {}
  }

  const candidate = layout as Record<string, unknown>
  const nextLayout: BlockState['layout'] = {}

  if (typeof candidate.measuredWidth === 'number' && Number.isFinite(candidate.measuredWidth)) {
    nextLayout.measuredWidth = candidate.measuredWidth
  }

  if (typeof candidate.measuredHeight === 'number' && Number.isFinite(candidate.measuredHeight)) {
    nextLayout.measuredHeight = candidate.measuredHeight
  }

  return nextLayout
}

export type PersistedWorkflowState = {
  direction?: WorkflowDirection
  blocks: Record<string, any>
  edges: any[]
  loops: Record<string, any>
  parallels: Record<string, any>
  variables: Record<string, any>
  lastSaved: number
}

export const WORKFLOW_REALTIME_REQUIRED_CODE = 'WORKFLOW_REALTIME_REQUIRED'

export class WorkflowRealtimeRequiredError extends Error {
  readonly code = WORKFLOW_REALTIME_REQUIRED_CODE

  constructor(cause: unknown) {
    super(
      cause instanceof Error
        ? cause.message
        : 'Editable workflow realtime orchestration is required'
    )
    this.name = 'WorkflowRealtimeRequiredError'
  }
}

export const isWorkflowRealtimeRequiredError = (
  error: unknown
): error is WorkflowRealtimeRequiredError => error instanceof WorkflowRealtimeRequiredError

// Workflow list sessions are live projections of workflow row metadata.
// Refresh failures must not invalidate the committed workflow row.
export async function refreshWorkflowListForWorkflow(workflowId: string): Promise<void> {
  try {
    const [row] = await db
      .select({
        workspaceId: workflow.workspaceId,
      })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!row?.workspaceId) return

    await refreshWorkflowList(row.workspaceId)
  } catch (error) {
    logger.warn('Failed to refresh workflow-list projection', { workflowId, error })
  }
}

export async function refreshWorkflowList(workspaceId: string): Promise<void> {
  await refreshEntityListSession('workflow', workspaceId)
}

function decodeWorkflowSnapshot(snapshotBase64: string): PersistedWorkflowState | null {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, Buffer.from(snapshotBase64, 'base64'))
    return extractPersistedStateFromDoc(doc)
  } finally {
    doc.destroy()
  }
}

/**
 * Editable workflow reads must go through the Yjs session. Saved tables are only
 * used by the Yjs bootstrap path when a session is not already live. Bridge
 * failures intentionally surface instead of falling back to stale saved tables.
 */
export async function requireWorkflowRealtimeState(
  workflowId: string
): Promise<PersistedWorkflowState | null> {
  const { readBootstrappedReviewTargetSnapshot } = await import(
    '@/lib/yjs/server/bootstrap-review-target'
  )
  const snapshot = await readBootstrappedReviewTargetSnapshot({
    workspaceId: null,
    entityKind: 'workflow',
    entityId: workflowId,
    draftSessionId: null,
    reviewSessionId: null,
    yjsSessionId: workflowId,
  }).catch((error) => {
    throw new WorkflowRealtimeRequiredError(error)
  })
  if (!snapshot.snapshotBase64) {
    return null
  }

  const state = decodeWorkflowSnapshot(snapshot.snapshotBase64)
  return state
}

export async function loadWorkflowBootstrapStateFromDb(
  workflowId: string,
  readStore: WorkflowReadStore = db
): Promise<(PersistedWorkflowState & { workspaceId: string | null }) | null> {
  const [workflowRow, normalizedState] = await Promise.all([
    readStore
      .select({
        workspaceId: workflow.workspaceId,
        variables: workflow.variables,
        updatedAt: workflow.updatedAt,
      })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1),
    loadWorkflowFromNormalizedTables(workflowId, readStore),
  ])
  const row = workflowRow[0]
  if (!row) {
    return null
  }

  const savedState = {
    blocks: normalizedState.blocks,
    edges: normalizedState.edges,
    loops: normalizedState.loops,
    parallels: normalizedState.parallels,
    variables: (row.variables as Record<string, any>) ?? {},
    lastSaved: row.updatedAt?.getTime() ?? Date.now(),
  }

  return {
    ...savedState,
    workspaceId: row.workspaceId ?? null,
    direction: inferWorkflowDirectionFromState(savedState),
  }
}

export async function ensureUniqueBlockIds(
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
          .where(
            and(inArray(workflowBlocks.id, blockIds), ne(workflowBlocks.workflowId, workflowId))
          )

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
      subBlocks: block.subBlocks
        ? Object.fromEntries(
            Object.entries(block.subBlocks).map(([subBlockId, subBlock]) => [
              subBlockId,
              typeof subBlock?.value === 'string' && remap.has(subBlock.value)
                ? { ...subBlock, value: remap.get(subBlock.value)! }
                : subBlock,
            ])
          )
        : block.subBlocks,
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

export async function ensureUniqueEdgeIds(
  workflowId: string,
  state: WorkflowState
): Promise<WorkflowState> {
  const edges = state.edges || []
  if (edges.length === 0) {
    return state
  }

  const candidateIds = edges.flatMap((edge) => {
    if (!edge || typeof edge !== 'object' || typeof edge.id !== 'string') {
      return []
    }

    const trimmedId = edge.id.trim()
    return trimmedId.length > 0 ? [trimmedId] : []
  })

  const conflictingIdsResult =
    candidateIds.length === 0
      ? []
      : await db
          .select({ id: workflowEdges.id })
          .from(workflowEdges)
          .where(
            and(inArray(workflowEdges.id, candidateIds), ne(workflowEdges.workflowId, workflowId))
          )

  const conflictingIds = new Set(conflictingIdsResult.map((row) => row.id))
  const seen = new Set<string>()
  let regeneratedCount = 0

  const updatedEdges = edges.map((edge) => {
    if (!edge || typeof edge !== 'object') {
      return edge
    }

    const trimmedId = typeof edge.id === 'string' ? edge.id.trim() : ''
    const shouldRegenerate =
      trimmedId.length === 0 || seen.has(trimmedId) || conflictingIds.has(trimmedId)

    let nextId = trimmedId
    if (shouldRegenerate) {
      do {
        nextId = uuidv4()
      } while (seen.has(nextId) || conflictingIds.has(nextId))
      regeneratedCount += 1
    }

    seen.add(nextId)

    if (nextId === edge.id) {
      return edge
    }

    return {
      ...edge,
      id: nextId,
    }
  })

  if (regeneratedCount === 0 && updatedEdges.every((edge, index) => edge === edges[index])) {
    return state
  }

  if (regeneratedCount > 0) {
    logger.warn(
      `Detected ${regeneratedCount} duplicate or conflicting edge id(s) while saving workflow ${workflowId}. Regenerating ids for safe persistence.`,
      { workflowId }
    )
  }

  return {
    ...state,
    edges: updatedEdges,
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
  variables?: Record<string, any>
  isFromNormalizedTables: boolean // Flag to indicate source (true = normalized tables, false = deployed state)
}

/**
 * Regenerates all IDs in a workflow state to avoid conflicts when duplicating workflows.
 * Returns a new state with all IDs regenerated and references updated.
 */
export function regenerateWorkflowStateIds(state: WorkflowState): WorkflowState {
  const blockIdMapping = new Map<string, string>()
  const edgeIdMapping = new Map<string, string>()
  const loopIdMapping = new Map<string, string>()
  const parallelIdMapping = new Map<string, string>()

  Object.keys(state.blocks || {}).forEach((oldId) => {
    blockIdMapping.set(oldId, uuidv4())
  })

  ;(state.edges || []).forEach((edge) => {
    edgeIdMapping.set(edge.id, uuidv4())
  })

  Object.keys(state.loops || {}).forEach((oldId) => {
    loopIdMapping.set(oldId, uuidv4())
  })

  Object.keys(state.parallels || {}).forEach((oldId) => {
    parallelIdMapping.set(oldId, uuidv4())
  })

  const newBlocks: Record<string, BlockState> = {}
  const newEdges: Edge[] = []
  const newLoops: Record<string, Loop> = {}
  const newParallels: Record<string, Parallel> = {}

  Object.entries(state.blocks || {}).forEach(([oldId, block]) => {
    const newId = blockIdMapping.get(oldId) || uuidv4()
    const nextBlock: BlockState = {
      ...block,
      id: newId,
    }

    if (nextBlock.data?.parentId) {
      const newParentId = blockIdMapping.get(nextBlock.data.parentId)
      if (newParentId) {
        nextBlock.data = {
          ...nextBlock.data,
          parentId: newParentId,
        }
      }
    }

    if (nextBlock.subBlocks) {
      const updatedSubBlocks: BlockState['subBlocks'] = {}
      Object.entries(nextBlock.subBlocks).forEach(([subId, subBlock]) => {
        if (!subBlock) return
        const updatedSubBlock = { ...subBlock }
        if (
          typeof updatedSubBlock.value === 'string' &&
          blockIdMapping.has(updatedSubBlock.value)
        ) {
          updatedSubBlock.value = blockIdMapping.get(updatedSubBlock.value) as string
        }
        updatedSubBlocks[subId] = updatedSubBlock
      })
      nextBlock.subBlocks = updatedSubBlocks
    }

    newBlocks[newId] = nextBlock
  })

  ;(state.edges || []).forEach((edge) => {
    const newId = edgeIdMapping.get(edge.id) || uuidv4()
    const newSource = blockIdMapping.get(edge.source) || edge.source
    const newTarget = blockIdMapping.get(edge.target) || edge.target

    newEdges.push({
      ...edge,
      id: newId,
      source: newSource,
      target: newTarget,
    })
  })

  Object.entries(state.loops || {}).forEach(([oldId, loop]) => {
    const newId = loopIdMapping.get(oldId) || uuidv4()
    const nextLoop: Loop = {
      ...loop,
      id: newId,
      nodes: loop.nodes.map((nodeId) => blockIdMapping.get(nodeId) || nodeId),
    }
    newLoops[newId] = nextLoop
  })

  Object.entries(state.parallels || {}).forEach(([oldId, parallel]) => {
    const newId = parallelIdMapping.get(oldId) || uuidv4()
    const nextParallel: Parallel = {
      ...parallel,
      id: newId,
      nodes: parallel.nodes.map((nodeId) => blockIdMapping.get(nodeId) || nodeId),
    }
    newParallels[newId] = nextParallel
  })

  return {
    ...state,
    blocks: newBlocks,
    edges: newEdges,
    loops: newLoops,
    parallels: newParallels,
    lastSaved: state.lastSaved ?? Date.now(),
  }
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

    const state = active.state as WorkflowState & { variables?: Record<string, any> }

    return {
      blocks: state.blocks || {},
      edges: state.edges || [],
      loops: state.loops || {},
      parallels: state.parallels || {},
      variables: state.variables || {},
      isFromNormalizedTables: false,
    }
  } catch (error) {
    logger.error(`Error loading deployed workflow state ${workflowId}:`, error)
    throw error
  }
}

/**
 * Load workflow state from normalized tables
 */
export async function loadWorkflowFromNormalizedTables(
  workflowId: string,
  readStore: WorkflowReadStore = db
): Promise<NormalizedWorkflowData> {
  const [blocks, edges, subflows] = await Promise.all([
    readStore.select().from(workflowBlocks).where(eq(workflowBlocks.workflowId, workflowId)),
    readStore.select().from(workflowEdges).where(eq(workflowEdges.workflowId, workflowId)),
    readStore.select().from(workflowSubflows).where(eq(workflowSubflows.workflowId, workflowId)),
  ])

  const blocksMap: Record<string, BlockState> = {}
  blocks.forEach((block) => {
    const blockLocked = resolveLockedFromBlockData(block.data)
    const blockData = upsertLockedInBlockData(block.data || {}, blockLocked)

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
      locked: blockLocked,
      subBlocks: (block.subBlocks as BlockState['subBlocks']) || {},
      outputs: (block.outputs as BlockState['outputs']) || {},
      data: blockData,
      layout: sanitizeBlockLayout(block.layout),
    }

    blocksMap[block.id] = assembled
  })

  const { blocks: sanitizedBlocks } = sanitizeAgentToolsInBlocks(blocksMap)

  const edgesArray: Edge[] = edges.map((edge) => ({
    id: edge.id,
    source: edge.sourceBlockId,
    target: edge.targetBlockId,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
    type: 'default',
    data: {},
  }))

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
}

/**
 * Save workflow state to normalized tables
 */
export async function saveWorkflowToNormalizedTables(
  workflowId: string,
  state: PersistableWorkflowState
): Promise<{ success: boolean; error?: string; normalizedState?: WorkflowState }> {
  try {
    const { variables, ...graphState } = state
    const stateWithUniqueBlockIds = await ensureUniqueBlockIds(workflowId, graphState)
    const stateWithUniqueEdgeIds = await ensureUniqueEdgeIds(workflowId, stateWithUniqueBlockIds)
    const { blocks } = sanitizeAgentToolsInBlocks(stateWithUniqueEdgeIds.blocks || {})
    const normalizedState = { ...stateWithUniqueEdgeIds, blocks }
    const savedAt = new Date(state.lastSaved ?? Date.now())

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
        data: upsertLockedInBlockData(block.data || {}, Boolean(block.locked)),
        layout: sanitizeBlockLayout(block.layout),
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
        typeof edge.source === 'string' && edge.source.trim().length > 0 ? edge.source.trim() : null
      const targetId =
        typeof edge.target === 'string' && edge.target.trim().length > 0 ? edge.target.trim() : null

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

      await tx
        .update(workflow)
        .set({
          lastSynced: savedAt,
          updatedAt: savedAt,
          ...(variables !== undefined ? { variables } : {}),
        })
        .where(eq(workflow.id, workflowId))
    })

    return { success: true, normalizedState }
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

export async function saveWorkflowYjsDocToDb(workflowId: string, doc: Y.Doc): Promise<void> {
  const state = extractPersistedStateFromDoc(doc)
  const syncedAt = new Date()
  const workflowState: PersistableWorkflowState = {
    ...(state.direction !== undefined ? { direction: state.direction } : {}),
    blocks: state.blocks,
    edges: state.edges,
    loops: state.loops,
    parallels: state.parallels,
    variables: state.variables,
    lastSaved: syncedAt.toISOString(),
  }

  const saveResult = await saveWorkflowToNormalizedTables(workflowId, workflowState)

  if (!saveResult.success) {
    throw new Error(saveResult.error || 'Failed to materialize workflow Yjs state')
  }

  if (saveResult.normalizedState) {
    setWorkflowState(
      doc,
      { ...saveResult.normalizedState, lastSaved: syncedAt.toISOString() },
      YJS_ORIGINS.SYSTEM
    )
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
  workflowOwnerId?: string
  previousDeployedState?: unknown
}): Promise<{
  success: boolean
  version?: number
  deploymentVersionId?: string
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
    workflowOwnerId,
    previousDeployedState,
  } = params

  try {
    const editableState = await requireWorkflowRealtimeState(workflowId)
    if (!editableState) {
      return { success: false, error: 'Failed to load workflow state' }
    }
    const currentState = editableState

    const now = new Date()

    const deploymentRecord = await db.transaction(async (tx) => {
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
      const deploymentVersionId = uuidv4()
      await tx.insert(workflowDeploymentVersion).values({
        id: deploymentVersionId,
        workflowId,
        version: nextVersion,
        state: currentState,
        isActive: true,
        createdBy: deployedBy,
        createdAt: now,
      })

      // Update workflow to deployed and persist variables
      const updateData: Record<string, unknown> = {
        isDeployed: true,
        deployedAt: now,
        variables: currentState.variables || {},
      }

      if (includeDeployedState) {
        updateData.deployedState = currentState
      }

      if (pinnedApiKeyId) {
        updateData.pinnedApiKeyId = pinnedApiKeyId
      }

      await tx.update(workflow).set(updateData).where(eq(workflow.id, workflowId))

      let resolvedWorkflowOwnerId = workflowOwnerId
      if (!resolvedWorkflowOwnerId) {
        const [workflowRecord] = await tx
          .select({ userId: workflow.userId })
          .from(workflow)
          .where(eq(workflow.id, workflowId))
          .limit(1)

        resolvedWorkflowOwnerId = workflowRecord?.userId
      }

      if (!resolvedWorkflowOwnerId) {
        throw new Error('Workflow owner not found')
      }

      await reconcilePublishedChatsForDeploymentTx({
        tx,
        workflowId,
        workflowOwnerId: resolvedWorkflowOwnerId,
        deploymentVersionId,
        state: currentState,
        previousState: previousDeployedState,
      })

      return {
        deploymentVersionId,
        version: nextVersion,
      }
    })

    logger.info(`Deployed workflow ${workflowId} as v${deploymentRecord.version}`)

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
          'deployment.version': deploymentRecord.version,
        })
      } catch (telemetryError) {
        logger.warn(`Failed to track deployment telemetry for ${workflowId}`, telemetryError)
      }
    }

    return {
      success: true,
      version: deploymentRecord.version,
      deploymentVersionId: deploymentRecord.deploymentVersionId,
      deployedAt: now,
      currentState,
    }
  } catch (error) {
    logger.error(`Error deploying workflow ${workflowId}:`, error)
    if (isWorkflowRealtimeRequiredError(error)) {
      throw error
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
