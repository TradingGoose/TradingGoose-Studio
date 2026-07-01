import { buildEntityListDescriptor } from '@/lib/copilot/review-sessions/identity'
import type {
  ReviewEntityKind,
  ReviewTargetDescriptor,
  ReviewTargetRuntimeState,
} from '@/lib/copilot/review-sessions/types'
import { env, getInternalRealtimeUrl } from '@/lib/env'
import type { WorkflowSnapshot } from '@/lib/yjs/workflow-session'

export interface YjsSnapshotResponse {
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

export async function applyEntityStateInSocketServer(
  entityId: string,
  entityKind: string,
  fields: Record<string, unknown>,
  listMember?: {
    name: string
    enabled?: boolean
    color?: string
  }
): Promise<void> {
  await postJsonToSocketServer(
    `/internal/yjs/entities/${encodeURIComponent(entityId)}/apply-state`,
    { entityKind, fields, listMember }
  )
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

async function postEntityListMembersToSocketServer(
  entityKind: ReviewEntityKind,
  workspaceId: string,
  body: unknown
): Promise<void> {
  const descriptor = buildEntityListDescriptor(entityKind, workspaceId)
  try {
    await postJsonToSocketServer(
      `/internal/yjs/sessions/${encodeURIComponent(descriptor.yjsSessionId)}/members`,
      body
    )
  } catch {
    // Entity-list sessions are DB-seeded projections; snapshot reads repair missed live publishes.
  }
}

export async function notifyEntityListMembersUpserted(
  entityKind: ReviewEntityKind,
  workspaceId: string,
  members: Array<{
    id: string
    name: string
    enabled?: boolean
    folderId?: string | null
    color?: string
  }>
): Promise<void> {
  await postEntityListMembersToSocketServer(entityKind, workspaceId, { members })
}

export async function notifyEntityListMemberRemoved(
  entityKind: ReviewEntityKind,
  workspaceId: string,
  entityId: string
): Promise<void> {
  await postEntityListMembersToSocketServer(entityKind, workspaceId, { remove: entityId })
}

export async function deleteYjsSessionInSocketServer(sessionId: string): Promise<void> {
  await fetchFromSocketServer(
    new URL(`/internal/yjs/sessions/${encodeURIComponent(sessionId)}`, getSocketServerUrl()),
    { method: 'DELETE' },
    10000
  )
}
