import * as Y from 'yjs'
import {
  buildDashboardColorPairDescriptor,
  buildDashboardWidgetDescriptor,
  buildSavedEntityDescriptor,
  buildYjsTransportEnvelope,
  parseDashboardColorPairSessionId,
  parseDashboardWidgetSessionId,
  serializeYjsTransportEnvelope,
} from '@/lib/copilot/review-sessions/identity'
import { getReviewTargetRuntimeState } from '@/lib/copilot/review-sessions/runtime'
import type {
  ResolvedReviewTarget,
  ReviewEntityKind,
  ReviewTargetDescriptor,
} from '@/lib/copilot/review-sessions/types'
import {
  DashboardLayoutOperationError,
  readPersistedDashboardColorPairDocument,
  readPersistedDashboardWidgetBinding,
} from '@/lib/dashboard-layouts/operations'
import { loadWorkflowBootstrapStateFromDb } from '@/lib/workflows/db-helpers'
import {
  readDashboardColorPairDocument,
  readDashboardLayoutDocument,
  readDashboardWidgetDocument,
  seedDashboardColorPairSession,
  seedDashboardLayoutSession,
  seedDashboardWidgetSession,
} from '@/lib/yjs/dashboard-layout-session'
import {
  type EntityListMember,
  getEntityFields,
  replaceEntityListSessionMembers,
  seedEntitySession,
} from '@/lib/yjs/entity-session'
import { type SavedEntityKind, SavedEntityRealtimeRequiredError } from '@/lib/yjs/entity-state'
import {
  readEntityListMembersFromDb,
  readSavedEntityFieldsFromDb,
  resolveEntityWorkspaceId,
} from '@/lib/yjs/server/entity-loaders'
import { getYjsSnapshot, SocketServerBridgeError } from '@/lib/yjs/server/snapshot-bridge'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import {
  createWorkflowSnapshot,
  getMetadataMap,
  setVariables,
  setWorkflowState,
} from '@/lib/yjs/workflow-session'
import {
  type DashboardLayoutProjectionContent,
  type DashboardLayoutTopologyNode,
  DashboardLayoutValidationError,
  normalizeDashboardLayoutDocument,
  normalizeDashboardLayoutProjection,
} from '@/widgets/layout-document'
import { PAIR_COLORS } from '@/widgets/pair-colors'

export class ReviewTargetBootstrapError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ReviewTargetBootstrapError'
    this.status = status
  }
}

function mapSavedEntitySnapshotError(error: unknown): never {
  if (error instanceof SocketServerBridgeError && error.status < 500) {
    throw new ReviewTargetBootstrapError(error.status, error.message)
  }
  throw new SavedEntityRealtimeRequiredError()
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { status?: number }).status === 404
  )
}

export async function readBootstrappedReviewTargetSnapshot(descriptor: ReviewTargetDescriptor) {
  const bridgeParams = serializeYjsTransportEnvelope(buildYjsTransportEnvelope(descriptor))
  return getYjsSnapshot(descriptor.yjsSessionId, bridgeParams)
}

export async function readSavedEntityFieldsForExecution(
  entityKind: SavedEntityKind,
  entityId: string,
  workspaceId: string,
  isDeployedContext: boolean,
  ownerUserId?: string | null
): Promise<Record<string, unknown>> {
  return isDeployedContext
    ? readSavedEntityFieldsFromDb(entityKind, entityId, workspaceId, ownerUserId)
    : readBootstrappedSavedEntityFields(entityKind, entityId, workspaceId, ownerUserId)
}

export async function readSavedEntityListFieldsForExecution(
  entityKind: SavedEntityKind,
  workspaceId: string,
  isDeployedContext: boolean,
  ownerUserId?: string | null
): Promise<Array<EntityListMember & { fields: Record<string, unknown> }>> {
  const members = await readEntityListMembersFromDb(entityKind, workspaceId, ownerUserId)
  const entries = await Promise.all(
    members.map(async (member) => {
      try {
        return {
          entityId: member.id,
          entityName: member.name,
          ...(typeof member.enabled === 'boolean' ? { enabled: member.enabled } : {}),
          ...('folderId' in member ? { folderId: member.folderId ?? null } : {}),
          ...(typeof member.color === 'string' ? { color: member.color } : {}),
          ...(typeof member.createdAt === 'string' ? { createdAt: member.createdAt } : {}),
          ...(typeof member.updatedAt === 'string' ? { updatedAt: member.updatedAt } : {}),
          ...(typeof member.isActive === 'boolean' ? { isActive: member.isActive } : {}),
          ...(typeof member.sortOrder === 'number' ? { sortOrder: member.sortOrder } : {}),
          fields: await readSavedEntityFieldsForExecution(
            entityKind,
            member.id,
            workspaceId,
            isDeployedContext,
            ownerUserId
          ),
        }
      } catch (error) {
        if (isNotFoundError(error)) return null
        throw error
      }
    })
  )

  return entries.filter(
    (entry): entry is EntityListMember & { fields: Record<string, unknown> } => entry !== null
  )
}

export async function readBootstrappedSavedEntityFields(
  entityKind: SavedEntityKind,
  entityId: string,
  workspaceId: string,
  ownerUserId?: string | null
): Promise<Record<string, unknown>> {
  const snapshot = await readBootstrappedReviewTargetSnapshot(
    buildSavedEntityDescriptor(entityKind, entityId, workspaceId, { ownerUserId })
  ).catch(mapSavedEntitySnapshotError)
  if (!snapshot.snapshotBase64) {
    throw new ReviewTargetBootstrapError(404, `Saved ${entityKind} ${entityId} state is missing`)
  }

  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, Buffer.from(snapshot.snapshotBase64, 'base64'))
    return entityKind === 'dashboard_layout'
      ? readDashboardLayoutDocument(doc)
      : getEntityFields(doc, entityKind)
  } finally {
    doc.destroy()
  }
}

export async function readBootstrappedDashboardLayoutProjection(
  layoutId: string,
  workspaceId: string,
  ownerUserId: string
): Promise<DashboardLayoutProjectionContent> {
  const document = normalizeDashboardLayoutDocument(
    await readBootstrappedSavedEntityFields('dashboard_layout', layoutId, workspaceId, ownerUserId)
  )
  const panels: Array<Extract<DashboardLayoutTopologyNode, { type: 'panel' }>> = []
  const collect = (node: DashboardLayoutTopologyNode) => {
    if (node.type === 'panel') panels.push(node)
    else node.children.forEach(collect)
  }
  collect(document.layout)
  const widgets = Object.fromEntries(
    await Promise.all(
      panels.map(async (panel) => {
        const snapshot = await readBootstrappedReviewTargetSnapshot(
          buildDashboardWidgetDescriptor({
            layoutId,
            identityId: panel.identityId,
            workspaceId,
            ownerUserId,
          })
        ).catch(mapSavedEntitySnapshotError)
        const doc = new Y.Doc()
        try {
          Y.applyUpdate(doc, Buffer.from(snapshot.snapshotBase64, 'base64'))
          return [panel.identityId, readDashboardWidgetDocument(doc, panel.widgetKey)] as const
        } finally {
          doc.destroy()
        }
      })
    )
  )
  const pairs = (
    await Promise.all(
      PAIR_COLORS.filter((color) => color !== 'gray').map(async (color) => {
        const snapshot = await readBootstrappedReviewTargetSnapshot(
          buildDashboardColorPairDescriptor({ layoutId, color, workspaceId, ownerUserId })
        ).catch(mapSavedEntitySnapshotError)
        const doc = new Y.Doc()
        try {
          Y.applyUpdate(doc, Buffer.from(snapshot.snapshotBase64, 'base64'))
          const context = readDashboardColorPairDocument(doc)
          return Object.keys(context).length > 0 ? { color, ...context } : null
        } finally {
          doc.destroy()
        }
      })
    )
  ).filter((pair) => pair !== null)
  return normalizeDashboardLayoutProjection({
    ...document,
    widgets,
    colorPairs: { pairs },
  })
}

export async function createSavedReviewTargetBootstrapUpdate(
  descriptor: ReviewTargetDescriptor
): Promise<ResolvedReviewTarget & { state: Uint8Array }> {
  if (!descriptor.entityId) {
    throw new ReviewTargetBootstrapError(404, 'Saved entity id is required')
  }

  const doc = new Y.Doc()
  try {
    let resolvedWorkspaceId: string | null = descriptor.workspaceId
    if (descriptor.entityKind === 'workflow') {
      const workflowState = await loadWorkflowBootstrapStateFromDb(descriptor.entityId)
      if (!workflowState) {
        throw new ReviewTargetBootstrapError(404, 'Workflow not found')
      }
      resolvedWorkspaceId = descriptor.workspaceId ?? workflowState.workspaceId

      setWorkflowState(
        doc,
        createWorkflowSnapshot({
          direction: workflowState.direction,
          blocks: workflowState.blocks,
          edges: workflowState.edges,
          loops: workflowState.loops,
          parallels: workflowState.parallels,
          lastSaved: new Date(workflowState.lastSaved).toISOString(),
        }),
        YJS_ORIGINS.SYSTEM
      )
      setVariables(doc, workflowState.variables, YJS_ORIGINS.SYSTEM)
    } else if (descriptor.entityKind === 'dashboard_widget') {
      const target = parseDashboardWidgetSessionId(descriptor.yjsSessionId)
      if (!target || target.identityId !== descriptor.entityId) {
        throw new ReviewTargetBootstrapError(400, 'Invalid dashboard widget session')
      }
      if (!descriptor.workspaceId || !descriptor.ownerUserId) {
        throw new ReviewTargetBootstrapError(400, 'Dashboard widget owner scope is required')
      }
      const binding = await readPersistedDashboardWidgetBinding(
        { workspaceId: descriptor.workspaceId, ownerUserId: descriptor.ownerUserId },
        target.layoutId,
        target.identityId
      )
      seedDashboardWidgetSession(doc, binding.document, YJS_ORIGINS.SYSTEM)
    } else if (descriptor.entityKind === 'dashboard_color_pair') {
      const target = parseDashboardColorPairSessionId(descriptor.yjsSessionId)
      if (!target || target.color !== descriptor.entityId) {
        throw new ReviewTargetBootstrapError(400, 'Invalid dashboard color-pair session')
      }
      if (!descriptor.workspaceId || !descriptor.ownerUserId) {
        throw new ReviewTargetBootstrapError(400, 'Dashboard color-pair owner scope is required')
      }
      seedDashboardColorPairSession(
        doc,
        await readPersistedDashboardColorPairDocument(
          { workspaceId: descriptor.workspaceId, ownerUserId: descriptor.ownerUserId },
          target.layoutId,
          target.color
        ),
        YJS_ORIGINS.SYSTEM
      )
    } else {
      const entityKind = descriptor.entityKind as SavedEntityKind
      const workspaceId =
        descriptor.workspaceId ??
        (await resolveEntityWorkspaceId(entityKind, descriptor.entityId, descriptor.ownerUserId))
      if (!workspaceId) {
        throw new ReviewTargetBootstrapError(404, 'Saved entity workspace is missing')
      }
      resolvedWorkspaceId = workspaceId

      const payload = await readSavedEntityFieldsFromDb(
        entityKind,
        descriptor.entityId,
        workspaceId,
        descriptor.ownerUserId
      )
      if (entityKind === 'dashboard_layout') {
        seedDashboardLayoutSession(
          doc,
          normalizeDashboardLayoutDocument(payload),
          YJS_ORIGINS.SYSTEM
        )
      } else {
        seedEntitySession(doc, { entityKind, payload })
      }
    }

    const metadata = getMetadataMap(doc)
    metadata.set('bootstrap-touch', Date.now())
    if (descriptor.entityKind === 'workflow') {
      metadata.set('entityKind', descriptor.entityKind)
      metadata.set('entityId', descriptor.entityId)
      metadata.set('workspaceId', resolvedWorkspaceId)
      metadata.set('draftSessionId', descriptor.draftSessionId)
      metadata.set('reviewSessionId', descriptor.reviewSessionId)
    }
    const state = Y.encodeStateAsUpdate(doc)

    return {
      descriptor: { ...descriptor, workspaceId: resolvedWorkspaceId },
      runtime: getReviewTargetRuntimeState(doc),
      state,
    }
  } catch (error) {
    if (error instanceof DashboardLayoutOperationError) {
      throw new ReviewTargetBootstrapError(error.status, error.message)
    }
    if (error instanceof DashboardLayoutValidationError) {
      throw new ReviewTargetBootstrapError(409, error.message)
    }
    throw error
  } finally {
    doc.destroy()
  }
}

export async function reseedEntityListSessionFromDb(
  doc: Y.Doc,
  entityKind: ReviewEntityKind,
  workspaceId: string,
  ownerUserId?: string | null
): Promise<void> {
  const members = await readEntityListMembersFromDb(entityKind, workspaceId, ownerUserId)
  replaceEntityListSessionMembers(doc, members)
}
