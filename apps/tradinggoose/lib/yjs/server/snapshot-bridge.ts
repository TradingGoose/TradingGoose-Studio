import { randomUUID } from 'crypto'
import { db } from '@tradinggoose/db'
import { sql } from 'drizzle-orm'
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
import type { SavedEntityIdentityMutation } from '@/lib/saved-entities/identity'
import { type SavedEntityKind, SavedEntityRealtimeRequiredError } from '@/lib/yjs/entity-state'
import type { WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import {
  type DashboardLayoutProjectionContent,
  type DashboardLayoutStructureMutation,
  normalizeDashboardLayoutProjection,
} from '@/widgets/layout-document'

const logger = createLogger('YjsSnapshotBridge')
const DELETION_LEASE_ATTEMPTS = 3
const DELETION_LEASE_TTL_MS = 5 * 60_000
const DELETION_LEASE_RENEWAL_MS = 60_000
const DELETION_LEASE_COMMIT_FENCE_MS = 60_000
const SOCKET_SERVER_RETRY_BACKOFF_BASE_MS = 250

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

export type YjsSessionDeletionLease = {
  assertHeld: () => void
}

type YjsDeletionTransaction = Pick<typeof db, 'delete' | 'execute' | 'insert' | 'select' | 'update'>

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
  timeoutMs = 5000,
  attempts = 1,
  decode?: (response: Response) => Promise<T>
): Promise<T> {
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

      return decode ? await decode(response) : (response as T)
    } catch (error) {
      const canRetry =
        attempt < attempts &&
        !(
          error instanceof SocketServerBridgeError &&
          error.status < 500 &&
          error.status !== 408 &&
          error.status !== 429
        )
      if (!canRetry) {
        throw error
      }
      await new Promise((resolve) =>
        setTimeout(resolve, SOCKET_SERVER_RETRY_BACKOFF_BASE_MS * 2 ** (attempt - 1))
      )
    }
  }

  throw new Error('Socket server bridge failed')
}

async function postJsonToSocketServer<T = unknown>(
  path: string,
  body: unknown,
  attempts = 1,
  decode: (response: Response) => Promise<T> = (response) => response.json() as Promise<T>
): Promise<T> {
  return fetchFromSocketServer(
    new URL(path, getInternalRealtimeUrl()),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    10000,
    attempts,
    decode
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
    logger.warn('Failed to notify realtime server about workspace access changes', {
      error,
      workspaceId,
      userIds,
    })
  }
}

export async function applyEntityStateInSocketServer(
  entityId: string,
  entityKind: Exclude<SavedEntityKind, 'dashboard_layout'>,
  workspaceId: string,
  fields: Record<string, unknown>,
  options?: {
    expectedReviewBaseStateHash?: string
    identity?: SavedEntityIdentityMutation
  }
): Promise<Record<string, unknown>> {
  try {
    const response = await postJsonToSocketServer<{
      fields?: unknown
    }>(`/internal/yjs/entities/${encodeURIComponent(entityId)}/apply-state`, {
      entityKind,
      workspaceId,
      fields,
      ...(options?.expectedReviewBaseStateHash
        ? { expectedReviewBaseStateHash: options.expectedReviewBaseStateHash }
        : {}),
      ...(options?.identity ? { identity: options.identity } : {}),
    })
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
  body: Record<string, unknown>
): Promise<DashboardLayoutProjectionContent> {
  try {
    const response = await postJsonToSocketServer<{
      content?: unknown
    }>(`/internal/yjs/dashboard-layouts/${encodeURIComponent(entityId)}/edit`, body)
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
}): Promise<DashboardLayoutProjectionContent> {
  return applyDashboardEditInSocketServer(input.entityId, {
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
}): Promise<DashboardLayoutProjectionContent> {
  return applyDashboardEditInSocketServer(input.entityId, {
    mutation: 'structure',
    workspaceId: input.workspaceId,
    ownerUserId: input.ownerUserId,
    structure: input.mutation,
  })
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
): Promise<boolean> {
  const descriptor = buildEntityListDescriptor(entityKind, workspaceId, { ownerUserId })
  const params = new URLSearchParams(
    serializeYjsTransportEnvelope(buildYjsTransportEnvelope(descriptor))
  )
  try {
    const response = await postJsonToSocketServer<{
      applied?: unknown
    }>(
      `/internal/yjs/sessions/${encodeURIComponent(descriptor.yjsSessionId)}/members?${params}`,
      {},
      3
    )
    return response.applied === true
  } catch (error) {
    logger.warn('Failed to refresh entity-list projection', { entityKind, workspaceId, error })
    return false
  }
}

export async function withYjsSessionDeletionLease<T>(
  target: { sessionIds?: readonly string[]; workspaceIds?: readonly string[] },
  mutate: (lease: YjsSessionDeletionLease) => Promise<T>
): Promise<T> {
  const leaseId = randomUUID()
  const leaseUrl = new URL(
    `/internal/yjs/session-deletions/${encodeURIComponent(leaseId)}`,
    getInternalRealtimeUrl()
  )
  const abortLease = async () => {
    try {
      await fetchFromSocketServer(leaseUrl, { method: 'DELETE' }, 10000, DELETION_LEASE_ATTEMPTS)
    } catch (error) {
      logger.warn('Failed to abort Yjs session deletion lease', { error, leaseId })
    }
  }
  let lastConfirmedAt = 0
  const beginLease = async () => {
    await postJsonToSocketServer(
      '/internal/yjs/session-deletions',
      { leaseId, ...target },
      DELETION_LEASE_ATTEMPTS,
      async (response) => {
        const ready = (await response.json()) as { leaseId?: unknown }
        if (ready.leaseId !== leaseId) {
          throw new SocketServerBridgeError(502, 'Socket server returned malformed deletion lease')
        }
      }
    )
    lastConfirmedAt = Date.now()
  }
  try {
    await beginLease()
  } catch (error) {
    await abortLease()
    if (error instanceof SocketServerBridgeError && error.status < 500) throw error
    throw new SavedEntityRealtimeRequiredError()
  }

  let renewal: Promise<void> | null = null
  const renewalTimer = setInterval(() => {
    if (renewal) return
    renewal = beginLease()
      .catch((error) =>
        logger.warn('Failed to renew Yjs session deletion lease', { error, leaseId })
      )
      .finally(() => {
        renewal = null
      })
  }, DELETION_LEASE_RENEWAL_MS)
  const stopRenewal = async () => {
    clearInterval(renewalTimer)
    await renewal
  }

  let result: T
  try {
    result = await mutate({
      assertHeld: () => {
        if (
          Date.now() - lastConfirmedAt >
          DELETION_LEASE_TTL_MS - DELETION_LEASE_RENEWAL_MS - 2 * DELETION_LEASE_COMMIT_FENCE_MS
        ) {
          throw new Error('Yjs session deletion lease is no longer confirmed')
        }
      },
    })
  } catch (error) {
    await stopRenewal()
    await abortLease()
    throw error
  }
  await stopRenewal()

  try {
    await postJsonToSocketServer(
      `/internal/yjs/session-deletions/${encodeURIComponent(leaseId)}/commit`,
      {},
      DELETION_LEASE_ATTEMPTS
    )
  } catch (error) {
    logger.warn('Yjs session deletion committed without lease acknowledgement', { error, leaseId })
  }
  return result
}

export function runYjsDeletionFencedTransaction<T>(
  leases: readonly YjsSessionDeletionLease[],
  run: (tx: YjsDeletionTransaction) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    const timeout = String(DELETION_LEASE_COMMIT_FENCE_MS)
    await tx.execute(sql`
      select
        set_config('statement_timeout', ${timeout}, true),
        set_config('idle_in_transaction_session_timeout', ${timeout}, true)
    `)
    const result = await run(tx)
    for (const lease of leases) lease.assertHeld()
    return result
  })
}
