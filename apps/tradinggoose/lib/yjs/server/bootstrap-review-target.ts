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
  type EntityListReadStore,
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
  collectDashboardTopologyReferences,
  type DashboardLayoutDocument,
  type DashboardLayoutProjectionContent,
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

function readSnapshotDocument<T>(snapshotBase64: string, read: (doc: Y.Doc) => T): T {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, Buffer.from(snapshotBase64, 'base64'))
    return read(doc)
  } finally {
    doc.destroy()
  }
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

  return readSnapshotDocument(snapshot.snapshotBase64, (doc) =>
    entityKind === 'dashboard_layout'
      ? readDashboardLayoutDocument(doc)
      : getEntityFields(doc, entityKind)
  )
}

export async function assembleDashboardLayoutProjection(input: {
  document: DashboardLayoutDocument
  layoutId: string
  workspaceId: string
  ownerUserId: string
  readOwnerDocument: <T>(descriptor: ReviewTargetDescriptor, read: (doc: Y.Doc) => T) => Promise<T>
}): Promise<DashboardLayoutProjectionContent> {
  const widgets = Object.fromEntries(
    await Promise.all(
      [...collectDashboardTopologyReferences(input.document.layout)].map(
        ([identityId, widgetKey]) =>
          input.readOwnerDocument(
            buildDashboardWidgetDescriptor({
              layoutId: input.layoutId,
              identityId,
              workspaceId: input.workspaceId,
              ownerUserId: input.ownerUserId,
            }),
            (doc) => [identityId, readDashboardWidgetDocument(doc, widgetKey)] as const
          )
      )
    )
  )
  const pairs = (
    await Promise.all(
      PAIR_COLORS.filter((color) => color !== 'gray').map((color) =>
        input.readOwnerDocument(
          buildDashboardColorPairDescriptor({
            layoutId: input.layoutId,
            color,
            workspaceId: input.workspaceId,
            ownerUserId: input.ownerUserId,
          }),
          (doc) => {
            const context = readDashboardColorPairDocument(doc)
            return Object.keys(context).length > 0 ? { color, ...context } : null
          }
        )
      )
    )
  ).filter((pair) => pair !== null)
  return normalizeDashboardLayoutProjection({
    ...input.document,
    widgets,
    colorPairs: { pairs },
  })
}

export async function readBootstrappedDashboardLayoutProjection(
  layoutId: string,
  workspaceId: string,
  ownerUserId: string
): Promise<DashboardLayoutProjectionContent> {
  const document = normalizeDashboardLayoutDocument(
    await readBootstrappedSavedEntityFields('dashboard_layout', layoutId, workspaceId, ownerUserId)
  )
  return assembleDashboardLayoutProjection({
    document,
    layoutId,
    workspaceId,
    ownerUserId,
    readOwnerDocument: async (descriptor, read) => {
      const snapshot = await readBootstrappedReviewTargetSnapshot(descriptor).catch(
        mapSavedEntitySnapshotError
      )
      return readSnapshotDocument(snapshot.snapshotBase64, read)
    },
  })
}

export async function createSavedReviewTargetBootstrapUpdate(
  descriptor: ReviewTargetDescriptor,
  readStore?: EntityListReadStore
): Promise<ResolvedReviewTarget & { state: Uint8Array; validateDocument?: (doc: Y.Doc) => void }> {
  if (!descriptor.entityId) {
    throw new ReviewTargetBootstrapError(404, 'Saved entity id is required')
  }

  const doc = new Y.Doc()
  try {
    let resolvedWorkspaceId: string | null = descriptor.workspaceId
    let validateDocument: ((doc: Y.Doc) => void) | undefined
    if (descriptor.entityKind === 'workflow') {
      const workflowState = await loadWorkflowBootstrapStateFromDb(descriptor.entityId, readStore)
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
        target.identityId,
        readStore
      )
      seedDashboardWidgetSession(doc, binding.document, YJS_ORIGINS.SYSTEM)
      validateDocument = (candidate) =>
        void readDashboardWidgetDocument(candidate, binding.widgetKey)
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
          target.color,
          readStore
        ),
        YJS_ORIGINS.SYSTEM
      )
      validateDocument = (candidate) => void readDashboardColorPairDocument(candidate)
    } else {
      const entityKind = descriptor.entityKind as SavedEntityKind
      const workspaceId =
        descriptor.workspaceId ??
        (await resolveEntityWorkspaceId(
          entityKind,
          descriptor.entityId,
          descriptor.ownerUserId,
          readStore
        ))
      if (!workspaceId) {
        throw new ReviewTargetBootstrapError(404, 'Saved entity workspace is missing')
      }
      resolvedWorkspaceId = workspaceId

      const payload = await readSavedEntityFieldsFromDb(
        entityKind,
        descriptor.entityId,
        workspaceId,
        descriptor.ownerUserId,
        readStore
      )
      if (entityKind === 'dashboard_layout') {
        seedDashboardLayoutSession(
          doc,
          normalizeDashboardLayoutDocument(payload),
          YJS_ORIGINS.SYSTEM
        )
      } else {
        seedEntitySession(doc, { entityKind, payload })
        if (entityKind === 'watchlist') {
          validateDocument = (candidate) => void getEntityFields(candidate, 'watchlist')
        }
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
      ...(validateDocument ? { validateDocument } : {}),
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

export async function initializeSavedReviewTargetDocument(
  descriptor: ReviewTargetDescriptor,
  readStore?: EntityListReadStore
) {
  const bootstrapped = await createSavedReviewTargetBootstrapUpdate(descriptor, readStore)
  if (!bootstrapped.runtime || bootstrapped.runtime.docState !== 'active') {
    throw new ReviewTargetBootstrapError(410, 'Review target expired')
  }
  return {
    state: bootstrapped.state,
    workspaceId: bootstrapped.descriptor.workspaceId,
    validateDocument: bootstrapped.validateDocument,
  }
}

export async function reseedEntityListSessionFromDb(
  doc: Y.Doc,
  entityKind: ReviewEntityKind,
  workspaceId: string,
  ownerUserId?: string | null,
  readStore?: EntityListReadStore
): Promise<void> {
  const members = await readEntityListMembersFromDb(entityKind, workspaceId, ownerUserId, readStore)
  replaceEntityListSessionMembers(doc, members)
}
