import { db } from '@tradinggoose/db'
import { workflow } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import * as Y from 'yjs'
import {
  loadCustomTool,
  loadIndicator,
  loadMcpServer,
  loadSkill,
} from '@/lib/copilot/review-sessions/entity-loaders'
import type {
  ResolvedReviewTarget,
  ReviewTargetDescriptor,
  ReviewTargetRuntimeState,
} from '@/lib/copilot/review-sessions/types'
import { getReviewTargetRuntimeState } from '@/lib/copilot/review-sessions/runtime'
import { seedEntitySession } from '@/lib/yjs/entity-session'
import {
  getMetadataMap as getWorkflowMetadataMap,
  setVariables,
  setWorkflowState,
} from '@/lib/yjs/workflow-session'
import type { WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'

export class ReviewTargetBootstrapError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ReviewTargetBootstrapError'
    this.status = status
  }
}

const ACTIVE_RESEEDED_RUNTIME: ReviewTargetRuntimeState = {
  docState: 'active',
  replaySafe: false,
  reseededFromCanonical: true,
}

export function getRuntimeStateFromDoc(doc: Y.Doc): ReviewTargetRuntimeState {
  return getReviewTargetRuntimeState(doc)
}

export function getRuntimeStateFromUpdate(update: Uint8Array): ReviewTargetRuntimeState {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, update)
    return getRuntimeStateFromDoc(doc)
  } finally {
    doc.destroy()
  }
}

async function getExistingYjsState(sessionId: string): Promise<Uint8Array | null> {
  const [{ getExistingDocument }, { getState }] = await Promise.all([
    import('@/socket-server/yjs/upstream-utils'),
    import('@/socket-server/yjs/persistence'),
  ])

  const liveDoc = await getExistingDocument(sessionId)
  if (liveDoc) {
    return Y.encodeStateAsUpdate(liveDoc)
  }

  return getState(sessionId)
}

async function getBootstrapDoc(sessionId: string): Promise<Y.Doc> {
  const [{ getDocument, setPersistence }, { getState, storeState }] = await Promise.all([
    import('@/socket-server/yjs/upstream-utils'),
    import('@/socket-server/yjs/persistence'),
  ])

  setPersistence(sessionId, { getState, storeState })
  return getDocument(sessionId)
}

async function persistDoc(sessionId: string, doc: Y.Doc): Promise<void> {
  const { storeState } = await import('@/socket-server/yjs/persistence')
  await storeState(sessionId, Y.encodeStateAsUpdate(doc))
}

async function resolveExistingReviewTarget(
  descriptor: ReviewTargetDescriptor
): Promise<ResolvedReviewTarget | null> {
  const existingState = await getExistingYjsState(descriptor.yjsSessionId)
  if (!existingState) {
    return null
  }

  return {
    descriptor,
    runtime: getRuntimeStateFromUpdate(existingState),
  }
}

/**
 * Ensures a review target has an active Yjs document. If an active blob already
 * exists it is reused; saved targets are reseeded from canonical data on loss;
 * unsaved drafts return the explicit expired state.
 */
export async function bootstrapReviewTarget(
  descriptor: ReviewTargetDescriptor
): Promise<ResolvedReviewTarget> {
  const existing = await resolveExistingReviewTarget(descriptor)
  if (existing) {
    return existing
  }

  if (descriptor.entityKind === 'workflow') {
    return bootstrapWorkflowTarget(descriptor)
  }

  if (descriptor.entityId) {
    return bootstrapSavedEntityTarget(descriptor)
  }

  return {
    descriptor,
    runtime: {
      docState: 'expired',
      replaySafe: false,
      reseededFromCanonical: false,
    },
  }
}

async function bootstrapWorkflowTarget(
  descriptor: ReviewTargetDescriptor
): Promise<ResolvedReviewTarget> {
  const workflowId = descriptor.entityId ?? descriptor.yjsSessionId
  if (!workflowId) {
    throw new ReviewTargetBootstrapError(404, 'Workflow target is missing a workflow id')
  }

  const [workflowRow] = await db
    .select({
      id: workflow.id,
      workspaceId: workflow.workspaceId,
      updatedAt: workflow.updatedAt,
      isDeployed: workflow.isDeployed,
      deployedAt: workflow.deployedAt,
      variables: workflow.variables,
    })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)

  if (!workflowRow) {
    throw new ReviewTargetBootstrapError(404, 'Workflow target no longer exists')
  }

  const normalizedState = await loadWorkflowFromNormalizedTables(workflowId)
  const workflowSnapshot: WorkflowSnapshot = {
    blocks: normalizedState?.blocks ?? {},
    edges: normalizedState?.edges ?? [],
    loops: normalizedState?.loops ?? {},
    parallels: normalizedState?.parallels ?? {},
    lastSaved: workflowRow.updatedAt?.toISOString(),
    isDeployed: workflowRow.isDeployed,
    deployedAt: workflowRow.deployedAt?.toISOString(),
  }

  const doc = await getBootstrapDoc(workflowId)
  setWorkflowState(doc, workflowSnapshot, 'bootstrap')
  setVariables(doc, ((workflowRow.variables as Record<string, any> | null) ?? {}) as Record<string, any>, 'bootstrap')

  doc.transact(() => {
    getWorkflowMetadataMap(doc).set('reseededFromCanonical', true)
  }, 'bootstrap')

  await persistDoc(workflowId, doc)

  return {
    descriptor: {
      ...descriptor,
      workspaceId: workflowRow.workspaceId ?? descriptor.workspaceId,
      entityId: workflowId,
      yjsSessionId: workflowId,
    },
    runtime: ACTIVE_RESEEDED_RUNTIME,
  }
}

async function bootstrapSavedEntityTarget(
  descriptor: ReviewTargetDescriptor
): Promise<ResolvedReviewTarget> {
  if (!descriptor.reviewSessionId) {
    throw new ReviewTargetBootstrapError(409, 'Saved entity target is missing reviewSessionId')
  }

  if (!descriptor.entityId) {
    throw new ReviewTargetBootstrapError(409, 'Saved entity target is missing entityId')
  }

  if (!descriptor.workspaceId) {
    throw new ReviewTargetBootstrapError(409, 'Saved entity target is missing workspaceId')
  }

  const canonical = await loadCanonicalEntitySeed(descriptor)
  const doc = await getBootstrapDoc(descriptor.reviewSessionId)

  seedEntitySession(doc, {
    entityKind: descriptor.entityKind,
    payload: canonical.payload,
  })

  doc.transact(() => {
    doc.getMap('metadata').set('reseededFromCanonical', true)
  }, 'bootstrap')

  await persistDoc(descriptor.reviewSessionId, doc)

  return {
    descriptor: {
      ...descriptor,
      workspaceId: canonical.workspaceId,
      entityId: descriptor.entityId,
      yjsSessionId: descriptor.reviewSessionId,
    },
    runtime: ACTIVE_RESEEDED_RUNTIME,
  }
}

async function loadCanonicalEntitySeed(descriptor: ReviewTargetDescriptor): Promise<{
  workspaceId: string
  payload: Record<string, unknown>
}> {
  switch (descriptor.entityKind) {
    case 'skill': {
      const row = await loadSkill(descriptor.entityId!, descriptor.workspaceId!)
      if (!row) {
        throw new ReviewTargetBootstrapError(404, 'Skill target no longer exists')
      }

      return {
        workspaceId: row.workspaceId,
        payload: {
          name: row.name,
          description: row.description,
          content: row.content,
        },
      }
    }
    case 'custom_tool': {
      const row = await loadCustomTool(descriptor.entityId!, descriptor.workspaceId!)
      if (!row) {
        throw new ReviewTargetBootstrapError(404, 'Custom tool target no longer exists')
      }

      return {
        workspaceId: row.workspaceId,
        payload: {
          title: row.title,
          schemaText:
            typeof row.schema === 'string' ? row.schema : JSON.stringify(row.schema ?? {}, null, 2),
          codeText: row.code,
        },
      }
    }
    case 'indicator': {
      const row = await loadIndicator(descriptor.entityId!, descriptor.workspaceId!)
      if (!row) {
        throw new ReviewTargetBootstrapError(404, 'Indicator target no longer exists')
      }

      return {
        workspaceId: row.workspaceId,
        payload: {
          name: row.name,
          color: row.color,
          pineCode: row.pineCode,
          inputMeta: row.inputMeta,
        },
      }
    }
    case 'mcp_server': {
      const row = await loadMcpServer(descriptor.entityId!, descriptor.workspaceId!)
      if (!row) {
        throw new ReviewTargetBootstrapError(404, 'MCP server target no longer exists')
      }

      return {
        workspaceId: row.workspaceId,
        payload: {
          name: row.name,
          description: row.description ?? '',
          transport: row.transport,
          url: row.url ?? '',
          headers:
            row.headers && typeof row.headers === 'object' && !Array.isArray(row.headers)
              ? row.headers
              : {},
          command: row.command ?? '',
          args: Array.isArray(row.args) ? row.args : [],
          env:
            row.env && typeof row.env === 'object' && !Array.isArray(row.env) ? row.env : {},
          timeout: row.timeout ?? 30000,
          retries: row.retries ?? 3,
          enabled: row.enabled ?? true,
        },
      }
    }
    case 'workflow':
      throw new ReviewTargetBootstrapError(409, 'Workflow targets must use workflow bootstrap')
    default:
      throw new ReviewTargetBootstrapError(409, 'Unsupported review target')
  }
}
