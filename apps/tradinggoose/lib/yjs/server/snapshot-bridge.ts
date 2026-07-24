import { randomUUID } from 'crypto'
import {
  buildEntityListDescriptor,
  buildYjsTransportEnvelope,
  serializeYjsTransportEnvelope,
} from '@/lib/copilot/review-sessions/identity'
import {
  INTERNAL_YJS_ACTOR_HEADER,
  INTERNAL_YJS_DEADLINE_HEADER,
  INTERNAL_YJS_REQUEST_ID_HEADER,
  type ReviewEntityKind,
  type ReviewTargetDescriptor,
  type ReviewTargetRuntimeState,
} from '@/lib/copilot/review-sessions/types'
import { StructuredServerToolError } from '@/lib/copilot/server-tool-errors'
import { env, getInternalRealtimeUrl } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import type { SavedEntityIdentityMutation } from '@/lib/saved-entities/identity'
import { type SavedEntityKind, SavedEntityRealtimeRequiredError } from '@/lib/yjs/entity-state'
import {
  runYjsRevocationTransaction,
  type YjsRevocationTarget,
  type YjsRevocationTransaction,
} from '@/lib/yjs/server/revocation-fence'
import type { WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import {
  type DashboardLayoutProjectionContent,
  type DashboardLayoutStructureMutation,
  normalizeDashboardLayoutProjection,
} from '@/widgets/layout-document'

const logger = createLogger('YjsSnapshotBridge')
const DRAIN_ATTEMPTS = 3
const SOCKET_SERVER_RETRY_BACKOFF_BASE_MS = 250
const TRANSIENT_CONFLICT_ATTEMPTS = 3
const SAVED_ENTITY_RESPONSE_DEADLINE_MS = 40_000
const DASHBOARD_RESPONSE_DEADLINE_MS = 70_000
const REPLAY_RESERVE_MS = 5_000

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

function getInternalSecret(): string {
  const secret = env.INTERNAL_API_SECRET
  if (!secret) {
    throw new Error('INTERNAL_API_SECRET is not configured')
  }
  return secret
}

async function fetchFromSocketServer<T = Response>(
  url: URL,
  init: RequestInit,
  timeoutMs?: number,
  attempts = 1,
  decode?: (response: Response) => Promise<T>
): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('x-internal-secret', getInternalSecret())
  const commitDeadline = Number(headers.get(INTERNAL_YJS_DEADLINE_HEADER)) || null
  const responseDeadline = commitDeadline ? commitDeadline + REPLAY_RESERVE_MS : null

  for (let attempt = 1; ; attempt++) {
    try {
      const attemptDeadline =
        commitDeadline && Date.now() < commitDeadline ? commitDeadline : responseDeadline
      const requestTimeout =
        attemptDeadline === null
          ? timeoutMs
          : Math.min(timeoutMs ?? Number.POSITIVE_INFINITY, attemptDeadline - Date.now())
      const response = await fetch(url.toString(), {
        ...init,
        headers,
        signal:
          requestTimeout === undefined
            ? undefined
            : AbortSignal.timeout(Math.max(1, requestTimeout)),
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new SocketServerBridgeError(response.status, body)
      }

      return decode ? await decode(response) : (response as T)
    } catch (error) {
      const backoffMs = SOCKET_SERVER_RETRY_BACKOFF_BASE_MS * 2 ** (attempt - 1)
      const attemptLimit =
        error instanceof SocketServerBridgeError && error.status === 425
          ? Math.max(attempts, TRANSIENT_CONFLICT_ATTEMPTS)
          : attempts
      const canRetry =
        (responseDeadline === null
          ? attempt < attemptLimit
          : Date.now() + backoffMs < responseDeadline) &&
        !(
          error instanceof SocketServerBridgeError &&
          error.status < 500 &&
          error.status !== 408 &&
          error.status !== 425 &&
          error.status !== 429
        )
      if (!canRetry) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
    }
  }
}

async function postJsonToSocketServer<T = unknown>(
  path: string,
  body: unknown,
  actorUserId: string | null,
  options?: { timeoutMs?: number; attempts?: number; responseDeadlineMs?: number }
): Promise<T> {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (actorUserId) headers.set(INTERNAL_YJS_ACTOR_HEADER, actorUserId)
  if (options?.responseDeadlineMs !== undefined) {
    headers.set(INTERNAL_YJS_REQUEST_ID_HEADER, randomUUID())
    headers.set(
      INTERNAL_YJS_DEADLINE_HEADER,
      String(Date.now() + options.responseDeadlineMs - REPLAY_RESERVE_MS)
    )
  }
  return fetchFromSocketServer(
    new URL(path, getInternalRealtimeUrl()),
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    },
    options?.timeoutMs ?? options?.responseDeadlineMs ?? 10_000,
    options?.attempts,
    (response) => response.json() as Promise<T>
  )
}

export async function getYjsSnapshot(
  sessionId: string,
  params?: Record<string, string>
): Promise<YjsSnapshotResponse> {
  const url = new URL(
    `/internal/yjs/sessions/${encodeURIComponent(sessionId)}/snapshot`,
    getInternalRealtimeUrl()
  )
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
  }

  return fetchFromSocketServer(
    url,
    { method: 'GET' },
    5000,
    3,
    (response) => response.json() as Promise<YjsSnapshotResponse>
  )
}

export async function applyWorkflowPatchInSocketServer(
  workflowId: string,
  actorUserId: string,
  patch: WorkflowPatch
): Promise<void> {
  await postJsonToSocketServer(
    `/internal/yjs/workflows/${encodeURIComponent(workflowId)}/apply-state`,
    patch,
    actorUserId
  )
}

export async function applyEntityStateInSocketServer(
  entityId: string,
  entityKind: Exclude<SavedEntityKind, 'dashboard_layout'>,
  workspaceId: string,
  actorUserId: string,
  fields: Record<string, unknown>,
  options?: {
    expectedReviewBaseStateHash?: string
    identity?: SavedEntityIdentityMutation
  }
): Promise<Record<string, unknown>> {
  try {
    const response = await postJsonToSocketServer<{
      fields?: unknown
    }>(
      `/internal/yjs/entities/${encodeURIComponent(entityId)}/apply-state`,
      {
        entityKind,
        workspaceId,
        fields,
        ...(options?.expectedReviewBaseStateHash
          ? { expectedReviewBaseStateHash: options.expectedReviewBaseStateHash }
          : {}),
        ...(options?.identity ? { identity: options.identity } : {}),
      },
      actorUserId,
      {
        responseDeadlineMs: SAVED_ENTITY_RESPONSE_DEADLINE_MS,
      }
    )
    if (!response.fields || typeof response.fields !== 'object' || Array.isArray(response.fields)) {
      throw new SocketServerBridgeError(502, 'Socket server returned malformed entity fields')
    }
    return response.fields as Record<string, unknown>
  } catch (error) {
    rethrowStructuredBridgeError(error)
  }
}

function rethrowStructuredBridgeError(error: unknown): never {
  if (error instanceof SocketServerBridgeError) {
    try {
      const body = JSON.parse(error.body) as {
        error?: unknown
        code?: unknown
        hint?: unknown
        retryable?: unknown
        issues?: Array<{ path: string; message: string }>
      }
      if (typeof body.error === 'string' && typeof body.code === 'string') {
        throw new StructuredServerToolError({
          status: error.status,
          body: {
            error: body.error,
            code: body.code,
            ...(typeof body.hint === 'string' ? { hint: body.hint } : {}),
            ...(typeof body.retryable === 'boolean' ? { retryable: body.retryable } : {}),
            ...(Array.isArray(body.issues) ? { issues: body.issues } : {}),
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
  actorUserId: string,
  body: Record<string, unknown>
): Promise<DashboardLayoutProjectionContent> {
  try {
    const response = await postJsonToSocketServer<{
      content?: unknown
    }>(`/internal/yjs/dashboard-layouts/${encodeURIComponent(entityId)}/edit`, body, actorUserId, {
      responseDeadlineMs: DASHBOARD_RESPONSE_DEADLINE_MS,
    })
    if (!response.content) {
      throw new SocketServerBridgeError(502, 'Socket server returned malformed dashboard content')
    }
    return normalizeDashboardLayoutProjection(response.content)
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
}): Promise<DashboardLayoutProjectionContent> {
  return applyDashboardEditInSocketServer(input.entityId, input.ownerUserId, {
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
}): Promise<DashboardLayoutProjectionContent> {
  return applyDashboardEditInSocketServer(input.entityId, input.ownerUserId, {
    mutation: 'widget',
    workspaceId: input.workspaceId,
    ownerUserId: input.ownerUserId,
    panelId: input.panelId,
    patch: input.patch,
    expectedReviewBaseStateHash: input.expectedReviewBaseStateHash,
  })
}

export function applyDashboardStructureMutationInSocketServer(input: {
  entityId: string
  workspaceId: string
  ownerUserId: string
  mutation: DashboardLayoutStructureMutation
}): Promise<void> {
  return postJsonToSocketServer(
    `/internal/yjs/dashboard-layouts/${encodeURIComponent(input.entityId)}/edit`,
    {
      mutation: 'structure',
      workspaceId: input.workspaceId,
      ownerUserId: input.ownerUserId,
      structure: input.mutation,
    },
    input.ownerUserId,
    {
      responseDeadlineMs: DASHBOARD_RESPONSE_DEADLINE_MS,
    }
  ).then(() => undefined)
}

/**
 * Converge the live entity-list projection after a committed membership
 * mutation. The DB rows are canonical and the list doc is a disposable
 * projection, so this never rejects: a mutation's success must not depend on
 * projection fan-out. A later reader admission reseeds a failed projection
 * without disrupting the live document already held by other readers.
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
      {},
      null,
      { timeoutMs: 10_000, attempts: 3 }
    )
  } catch (error) {
    logger.warn('Failed to refresh entity-list projection', { entityKind, workspaceId, error })
  }
}

export function runYjsDrainFencedTransaction<T>(
  target: YjsRevocationTarget,
  mutate: (tx: YjsRevocationTransaction) => Promise<T>,
  tx?: YjsRevocationTransaction
): Promise<T> {
  return runYjsRevocationTransaction(
    target,
    async (normalized) => {
      try {
        await postJsonToSocketServer('/internal/yjs/session-drains', normalized, null, {
          timeoutMs: 10_000,
          attempts: DRAIN_ATTEMPTS,
        })
      } catch (error) {
        if (error instanceof SocketServerBridgeError && error.status < 500) throw error
        throw new SavedEntityRealtimeRequiredError()
      }
    },
    mutate,
    tx ? { tx } : undefined
  )
}
