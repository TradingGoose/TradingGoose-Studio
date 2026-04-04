import type {
  ReviewTargetDescriptor,
  ReviewTargetRuntimeState,
} from '@/lib/copilot/review-sessions/types'
import { env } from '@/lib/env'

export interface YjsSnapshotResponse {
  snapshotBase64: string
  descriptor: ReviewTargetDescriptor
  runtime: ReviewTargetRuntimeState
}

export class YjsSnapshotBridgeError extends Error {
  status: number
  body: string

  constructor(status: number, body: string) {
    super(`Snapshot bridge failed: ${status}${body ? ` ${body}` : ''}`)
    this.name = 'YjsSnapshotBridgeError'
    this.status = status
    this.body = body
  }
}

export async function getYjsSnapshot(
  sessionId: string,
  params?: Record<string, string>
): Promise<YjsSnapshotResponse> {
  const socketUrl = env.SOCKET_SERVER_URL || 'http://localhost:3002'
  const internalSecret = env.INTERNAL_API_SECRET

  if (!internalSecret) {
    throw new Error('INTERNAL_API_SECRET is not configured')
  }

  const url = new URL(`/internal/yjs/sessions/${encodeURIComponent(sessionId)}/snapshot`, socketUrl)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'x-internal-secret': internalSecret,
    },
    signal: AbortSignal.timeout(5000),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new YjsSnapshotBridgeError(response.status, body)
  }

  return response.json() as Promise<YjsSnapshotResponse>
}
