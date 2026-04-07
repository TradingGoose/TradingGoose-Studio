import { type ReviewTargetDescriptor, type ReviewTargetRuntimeState } from '@/lib/copilot/review-sessions/types'
import { env } from '@/lib/env'
import type { WorkflowSnapshot } from '@/lib/yjs/workflow-session'

export interface YjsSnapshotResponse {
  snapshotBase64: string
  descriptor: ReviewTargetDescriptor
  runtime: ReviewTargetRuntimeState
}

export class SocketServerBridgeError extends Error {
  status: number
  body: string

  constructor(status: number, body: string) {
    super(`Socket server bridge failed: ${status}${body ? ` ${body}` : ''}`)
    this.name = 'SocketServerBridgeError'
    this.status = status
    this.body = body
  }
}

function getSocketServerUrl(): string {
  return env.SOCKET_SERVER_URL || 'http://localhost:3002'
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
  timeoutMs = 5000
): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('x-internal-secret', getInternalSecret())

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
}

export async function getYjsSnapshot(
  sessionId: string,
  params?: Record<string, string>
): Promise<YjsSnapshotResponse> {
  const url = new URL(`/internal/yjs/sessions/${encodeURIComponent(sessionId)}/snapshot`, getSocketServerUrl())
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
  }

  const response = await fetchFromSocketServer(url, { method: 'GET' })
  return response.json() as Promise<YjsSnapshotResponse>
}

export async function applyWorkflowStateInSocketServer(
  workflowId: string,
  workflowState: WorkflowSnapshot,
  variables?: Record<string, any>
): Promise<void> {
  const url = new URL(
    `/internal/yjs/workflows/${encodeURIComponent(workflowId)}/apply-state`,
    getSocketServerUrl()
  )

  await fetchFromSocketServer(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      workflowState,
      ...(variables === undefined ? {} : { variables }),
    }),
  }, 10000)
}

export async function deleteYjsSessionInSocketServer(sessionId: string): Promise<void> {
  const url = new URL(`/internal/yjs/sessions/${encodeURIComponent(sessionId)}`, getSocketServerUrl())

  await fetchFromSocketServer(url, {
    method: 'DELETE',
  }, 10000)
}

export async function clearYjsSessionReseededFromCanonicalInSocketServer(
  sessionId: string
): Promise<void> {
  const url = new URL(
    `/internal/yjs/sessions/${encodeURIComponent(sessionId)}/clear-reseeded`,
    getSocketServerUrl()
  )

  await fetchFromSocketServer(url, {
    method: 'POST',
  }, 10000)
}
