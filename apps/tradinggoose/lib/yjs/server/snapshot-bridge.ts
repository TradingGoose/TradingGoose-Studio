import {
  buildEntityListDescriptor,
  buildYjsTransportEnvelope,
  serializeYjsTransportEnvelope,
} from '@/lib/copilot/review-sessions/identity'
import type {
  ReviewEntityKind,
  ReviewTargetDescriptor,
  ReviewTargetRuntimeState,
} from '@/lib/copilot/review-sessions/types'
import { StructuredServerToolError } from '@/lib/copilot/server-tool-errors'
import { env, getInternalRealtimeUrl } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import type { SavedEntityKind } from '@/lib/yjs/entity-state'
import type { WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import {
  type DashboardLayoutDocumentContent,
  normalizeDashboardLayoutDocumentContent,
} from '@/widgets/layout-document'

const logger = createLogger('YjsSnapshotBridge')

interface YjsSnapshotResponse {
  snapshotBase64: string
  descriptor: ReviewTargetDescriptor
  runtime: ReviewTargetRuntimeState
  touchedAt?: number | null
}

type WorkflowPatch = {
  workflowState?: WorkflowSnapshot
  variables?: Record<string, any>
}

export class SocketServerBridgeError extends Error {
  status: number
  body: string

  constructor(status: number, body: string) {
    super(readSocketServerErrorMessage(status, body))
    this.name = 'SocketServerBridgeError'
    this.status = status
    this.body = body
  }
}

function readSocketServerErrorMessage(status: number, body: string): string {
  if (!body) return `Socket server bridge failed: ${status}`
  try {
    const error = (JSON.parse(body) as { error?: unknown }).error
    return typeof error === 'string' && error ? error : body
  } catch {
    return body
  }
}

function getSocketServerUrl(): string {
  return getInternalRealtimeUrl()
}

function getInternalSecret(): string {
  const secret = env.INTERNAL_API_SECRET
  if (!secret) {
    throw new Error('INTERNAL_API_SECRET is not configured')
  }
  return secret
}

async function fetchFromSocketServer(
  url: URL,
  init: RequestInit,
  timeoutMs = 5000,
  attempts = 1
): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('x-internal-secret', getInternalSecret())

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url.toString(), {
        ...init,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new SocketServerBridgeError(response.status, body)
      }

      return response
    } catch (error) {
      const canRetry =
        attempt < attempts && !(error instanceof SocketServerBridgeError && error.status < 500)
      if (!canRetry) {
        throw error
      }
    }
  }

  throw new Error('Socket server bridge failed')
}

async function postJsonToSocketServer(path: string, body: unknown): Promise<void> {
  await fetchFromSocketServer(
    new URL(path, getSocketServerUrl()),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    10000
  )
}

async function postJsonToSocketServerWithResponse<T>(path: string, body: unknown): Promise<T> {
  const response = await fetchFromSocketServer(
    new URL(path, getSocketServerUrl()),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    10000
  )
  return response.json() as Promise<T>
}

export async function getYjsSnapshot(
  sessionId: string,
  params?: Record<string, string>
): Promise<YjsSnapshotResponse> {
  const url = new URL(
    `/internal/yjs/sessions/${encodeURIComponent(sessionId)}/snapshot`,
    getSocketServerUrl()
  )
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
  }

  const response = await fetchFromSocketServer(url, { method: 'GET' }, 5000, 3)
  return response.json() as Promise<YjsSnapshotResponse>
}

export async function applyWorkflowPatchInSocketServer(
  workflowId: string,
  patch: WorkflowPatch
): Promise<void> {
  await postJsonToSocketServer(
    `/internal/yjs/workflows/${encodeURIComponent(workflowId)}/apply-state`,
    patch
  )
}

export async function notifyWorkspaceYjsAccessChanged(
  workspaceId: string,
  userIds?: string[]
): Promise<void> {
  try {
    await postJsonToSocketServer(
      `/internal/yjs/workspaces/${encodeURIComponent(workspaceId)}/access-changed`,
      { ...(userIds ? { userIds } : {}) }
    )
  } catch (error) {
    logger.warn('Failed to immediately reconcile workspace Yjs access', { workspaceId, error })
  }
}

export async function applyEntityStateInSocketServer(
  entityId: string,
  entityKind: Exclude<SavedEntityKind, 'dashboard_layout'>,
  fields: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const response = await postJsonToSocketServerWithResponse<{
    success?: unknown
    fields?: unknown
  }>(`/internal/yjs/entities/${encodeURIComponent(entityId)}/apply-state`, {
    entityKind,
    fields,
  })
  if (
    response.success !== true ||
    !response.fields ||
    typeof response.fields !== 'object' ||
    Array.isArray(response.fields)
  ) {
    throw new SocketServerBridgeError(502, 'Socket server returned malformed entity fields')
  }
  return response.fields as Record<string, unknown>
}

export async function importWatchlistDocumentInSocketServer(
  entityId: string,
  workspaceId: string,
  fields: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const response = await postJsonToSocketServerWithResponse<{
    success?: unknown
    fields?: unknown
  }>(`/internal/yjs/watchlists/${encodeURIComponent(entityId)}/import`, {
    workspaceId,
    fields,
  })
  if (
    response.success !== true ||
    !response.fields ||
    typeof response.fields !== 'object' ||
    Array.isArray(response.fields)
  ) {
    throw new SocketServerBridgeError(502, 'Socket server returned malformed watchlist fields')
  }
  return response.fields as Record<string, unknown>
}

function rethrowStructuredBridgeError(error: unknown): never {
  if (error instanceof SocketServerBridgeError) {
    try {
      const body = JSON.parse(error.body) as {
        error?: unknown
        code?: unknown
        hint?: unknown
        retryable?: unknown
      }
      if (typeof body.error === 'string' && typeof body.code === 'string') {
        throw new StructuredServerToolError({
          status: error.status,
          body: {
            error: body.error,
            code: body.code,
            ...(typeof body.hint === 'string' ? { hint: body.hint } : {}),
            ...(typeof body.retryable === 'boolean' ? { retryable: body.retryable } : {}),
          },
        })
      }
    } catch (parsedError) {
      if (parsedError instanceof StructuredServerToolError) throw parsedError
    }
  }
  throw error
}

async function applyDashboardEditInSocketServer(
  entityId: string,
  body: Record<string, unknown>
): Promise<DashboardLayoutDocumentContent> {
  try {
    const response = await postJsonToSocketServerWithResponse<{
      success?: unknown
      content?: unknown
    }>(`/internal/yjs/dashboard-layouts/${encodeURIComponent(entityId)}/edit`, body)
    if (response.success !== true || !response.content) {
      throw new SocketServerBridgeError(502, 'Socket server returned malformed dashboard content')
    }
    return normalizeDashboardLayoutDocumentContent(response.content)
  } catch (error) {
    rethrowStructuredBridgeError(error)
  }
}

export function applyDashboardLayoutEditInSocketServer(input: {
  entityId: string
  workspaceId: string
  ownerUserId: string
  entityDocument: string
  removedPanelIds: string[]
  expectedReviewBaseStateHash: string
}): Promise<DashboardLayoutDocumentContent> {
  return applyDashboardEditInSocketServer(input.entityId, {
    mutation: 'layout',
    workspaceId: input.workspaceId,
    ownerUserId: input.ownerUserId,
    entityDocument: input.entityDocument,
    removedPanelIds: input.removedPanelIds,
    expectedReviewBaseStateHash: input.expectedReviewBaseStateHash,
  })
}

export function applyDashboardWidgetEditInSocketServer(input: {
  entityId: string
  workspaceId: string
  ownerUserId: string
  panelId: string
  patch: {
    pairColor?: string
    params?: Record<string, unknown> | null
    colorPair?: Record<string, unknown> | null
  }
  expectedReviewBaseStateHash: string
}): Promise<DashboardLayoutDocumentContent> {
  return applyDashboardEditInSocketServer(input.entityId, {
    mutation: 'widget',
    workspaceId: input.workspaceId,
    ownerUserId: input.ownerUserId,
    panelId: input.panelId,
    patch: input.patch,
    expectedReviewBaseStateHash: input.expectedReviewBaseStateHash,
  })
}

export async function applyYjsUpdateInSocketServer(
  sessionId: string,
  search: string,
  updateBase64: string
): Promise<void> {
  await postJsonToSocketServer(
    `/internal/yjs/sessions/${encodeURIComponent(sessionId)}/apply-update${search}`,
    { updateBase64 }
  )
}

/**
 * Converge the live entity-list projection after a committed membership
 * mutation. The DB rows are canonical and the list doc is a disposable
 * projection, so this never rejects: a mutation's success must not depend on
 * projection fan-out. On refresh failure the projection is discarded instead,
 * which closes subscriber connections so every viewer rebootstraps a fresh
 * doc from canonical DB state.
 */
export async function refreshEntityListSession(
  entityKind: ReviewEntityKind,
  workspaceId: string,
  ownerUserId?: string | null
): Promise<void> {
  const descriptor = buildEntityListDescriptor(entityKind, workspaceId, { ownerUserId })
  const params = new URLSearchParams(
    serializeYjsTransportEnvelope(buildYjsTransportEnvelope(descriptor))
  )
  try {
    await postJsonToSocketServer(
      `/internal/yjs/sessions/${encodeURIComponent(descriptor.yjsSessionId)}/members?${params}`,
      {}
    )
  } catch (error) {
    logger.warn('Failed to refresh entity-list projection', { entityKind, workspaceId, error })
    await deleteYjsSessionInSocketServer(descriptor.yjsSessionId).catch((discardError) => {
      logger.error('Failed to discard stale entity-list projection', {
        entityKind,
        workspaceId,
        error: discardError,
      })
    })
  }
}

export async function deleteYjsSessionInSocketServer(sessionId: string): Promise<void> {
  await fetchFromSocketServer(
    new URL(`/internal/yjs/sessions/${encodeURIComponent(sessionId)}`, getSocketServerUrl()),
    { method: 'DELETE' },
    10000
  )
}
