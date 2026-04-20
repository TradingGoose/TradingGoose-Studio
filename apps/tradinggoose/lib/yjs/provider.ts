import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import {
  buildYjsTransportEnvelope,
  serializeYjsTransportEnvelope,
} from '@/lib/copilot/review-sessions/identity'
import type {
  ReviewEntityKind,
  ReviewTargetDescriptor,
  ReviewTargetRuntimeState,
} from '@/lib/copilot/review-sessions/types'
import { getEnv } from '@/lib/env'
import { seedEntitySession } from '@/lib/yjs/entity-session'
import { applySnapshotToDoc } from './client'

export interface YjsProviderBootstrapResult {
  doc: Y.Doc
  provider: WebsocketProvider
  descriptor: ReviewTargetDescriptor
  runtime: ReviewTargetRuntimeState
}

interface DraftBootstrapSeedInput {
  entityKind: ReviewEntityKind
  payload: Record<string, any>
}

const SOCKET_TOKEN_RETRY_MS = 1_000

async function fetchSocketToken(): Promise<string> {
  const res = await fetch('/api/auth/socket-token', {
    method: 'POST',
    cache: 'no-store',
    credentials: 'include',
    headers: { 'cache-control': 'no-store' },
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch socket token: ${res.status}`)
  }

  const data = await res.json()
  return data.token
}

async function fetchSnapshot(
  sessionId: string,
  envelopeParams: Record<string, string>
): Promise<{
  snapshotBase64: string
  descriptor: ReviewTargetDescriptor
  runtime: ReviewTargetRuntimeState
}> {
  const params = new URLSearchParams(envelopeParams)
  const res = await fetch(`/api/yjs/sessions/${encodeURIComponent(sessionId)}/snapshot?${params}`, {
    cache: 'no-store',
  })

  if (res.status === 410) {
    const body = await res.json()
    throw new YjsExpiredDraftError(body)
  }

  if (!res.ok) {
    throw new Error(`Snapshot fetch failed: ${res.status}`)
  }

  return res.json()
}

export async function bootstrapYjsProvider(
  descriptor: ReviewTargetDescriptor,
  options?: {
    wsOrigin?: string
    draftSeed?: DraftBootstrapSeedInput | null
  }
): Promise<YjsProviderBootstrapResult> {
  const doc = new Y.Doc()

  const initialEnvelope = buildYjsTransportEnvelope(descriptor)
  const initialEnvelopeParams = serializeYjsTransportEnvelope(initialEnvelope)
  let snapshot: {
    snapshotBase64: string
    descriptor: ReviewTargetDescriptor
    runtime: ReviewTargetRuntimeState
  } | null = null
  let resolvedDescriptor = descriptor
  let runtime: ReviewTargetRuntimeState = {
    docState: 'active',
    replaySafe: true,
    reseededFromCanonical: false,
  }
  let localOnlyRecovery = false

  try {
    snapshot = await fetchSnapshot(descriptor.yjsSessionId, initialEnvelopeParams)
    resolvedDescriptor = snapshot.descriptor
    runtime = snapshot.runtime
  } catch (error) {
    if (!(error instanceof YjsExpiredDraftError) || !options?.draftSeed) {
      throw error
    }

    const expiredBody = error.body as
      | {
          descriptor?: ReviewTargetDescriptor
          runtime?: ReviewTargetRuntimeState
        }
      | undefined

    resolvedDescriptor = expiredBody?.descriptor ?? descriptor
    runtime = expiredBody?.runtime ?? {
      docState: 'expired',
      replaySafe: false,
      reseededFromCanonical: false,
    }

    seedEntitySession(doc, {
      entityKind: options.draftSeed.entityKind,
      payload: options.draftSeed.payload,
    })
    localOnlyRecovery = true
  }

  if (snapshot?.snapshotBase64) {
    applySnapshotToDoc(doc, snapshot.snapshotBase64)
  }

  const wsOrigin = options?.wsOrigin ?? getDefaultWsOrigin()
  const serverUrl = `${wsOrigin}/yjs`

  if (localOnlyRecovery) {
    const provider = new WebsocketProvider(serverUrl, resolvedDescriptor.yjsSessionId, doc, {
      connect: false,
    })

    return {
      doc,
      provider,
      descriptor: resolvedDescriptor,
      runtime,
    }
  }

  const envelopeParams = serializeYjsTransportEnvelope(
    buildYjsTransportEnvelope(resolvedDescriptor)
  )
  const token = await fetchSocketToken()

  const provider = new WebsocketProvider(serverUrl, resolvedDescriptor.yjsSessionId, doc, {
    params: { token, ...envelopeParams },
    connect: true,
  })

  let tokenRefreshInFlight: Promise<void> | null = null
  let tokenRefreshRetryTimeout: ReturnType<typeof setTimeout> | null = null

  const scheduleReconnectWithFreshToken = (currentProvider: WebsocketProvider) => {
    if (!currentProvider.shouldConnect || tokenRefreshInFlight || tokenRefreshRetryTimeout) {
      return
    }

    // Better Auth one-time tokens are consumed on verify, so every reconnect
    // must rotate the token before y-websocket attempts the next connection.
    currentProvider.shouldConnect = false
    tokenRefreshInFlight = (async () => {
      try {
        const nextToken = await fetchSocketToken()
        currentProvider.params = {
          token: nextToken,
          ...envelopeParams,
        }
        currentProvider.connect()
      } catch (error) {
        console.error('[YjsProvider] Failed to refresh socket token', error)
        tokenRefreshRetryTimeout = setTimeout(() => {
          tokenRefreshRetryTimeout = null
          scheduleReconnectWithFreshToken(currentProvider)
        }, SOCKET_TOKEN_RETRY_MS)
      } finally {
        tokenRefreshInFlight = null
      }
    })()
  }

  provider.on(
    'connection-close',
    (_event: CloseEvent | null, currentProvider: WebsocketProvider) => {
      scheduleReconnectWithFreshToken(currentProvider)
    }
  )
  provider.on('connection-error', (_event: Event, currentProvider: WebsocketProvider) => {
    scheduleReconnectWithFreshToken(currentProvider)
  })

  return {
    doc,
    provider,
    descriptor: resolvedDescriptor,
    runtime,
  }
}

function getDefaultWsOrigin(): string {
  return (getEnv('NEXT_PUBLIC_SOCKET_URL')?.trim() || 'http://localhost:3002')
    .replace(/^http:\/\//, 'ws://')
    .replace(/^https:\/\//, 'wss://')
}

export class YjsExpiredDraftError extends Error {
  body: any

  constructor(body: any) {
    super('Draft session has expired')
    this.name = 'YjsExpiredDraftError'
    this.body = body
  }
}
