import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import {
  buildYjsTransportEnvelope,
  serializeYjsTransportEnvelope,
} from '@/lib/copilot/review-sessions/identity'
import type {
  ReviewAccessMode,
  ReviewTargetDescriptor,
  ReviewTargetRuntimeState,
} from '@/lib/copilot/review-sessions/types'
import { getEnv } from '@/lib/env'
import { applySnapshotToDoc } from './client'

export interface YjsProviderBootstrapResult {
  doc: Y.Doc
  provider: WebsocketProvider
  descriptor: ReviewTargetDescriptor
  runtime: ReviewTargetRuntimeState
  accessMode: ReviewAccessMode
}

type YjsProviderLifecycle = { dispose: () => void }
const providerLifecycles = new WeakMap<YjsProviderBootstrapResult, YjsProviderLifecycle>()

export function disposeYjsProvider(result: YjsProviderBootstrapResult): void {
  const lifecycle = providerLifecycles.get(result)
  if (!lifecycle) {
    throw new Error('Yjs provider result is not owned by this provider lifecycle')
  }
  lifecycle.dispose()
}

const SOCKET_TOKEN_RETRY_MS = 1_000
const SYNC_TIMEOUT_MS = 10_000

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
  envelopeParams: Record<string, string>,
  accessMode: ReviewAccessMode
): Promise<{
  snapshotBase64: string
  descriptor: ReviewTargetDescriptor
  runtime: ReviewTargetRuntimeState
}> {
  const params = new URLSearchParams({
    ...envelopeParams,
    accessMode,
  })
  const res = await fetch(`/api/yjs/sessions/${encodeURIComponent(sessionId)}/snapshot?${params}`, {
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`Snapshot fetch failed: ${res.status}`)
  }

  return res.json()
}

export function waitForYjsSync(provider: WebsocketProvider): Promise<void> {
  if (provider.synced) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null

    const finish = (error?: Error) => {
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
      provider.off('sync', handleSync)
      provider.off('connection-close', handleConnectionFailure)
      provider.off('connection-error', handleConnectionFailure)
      error ? reject(error) : resolve()
    }

    const handleSync = (isSynced: boolean) => {
      if (isSynced) {
        finish()
      }
    }

    const handleConnectionFailure = () => {
      finish(new Error('Failed to establish authorized Yjs sync'))
    }

    timeout = setTimeout(handleConnectionFailure, SYNC_TIMEOUT_MS)
    provider.on('sync', handleSync)
    provider.on('connection-close', handleConnectionFailure)
    provider.on('connection-error', handleConnectionFailure)

    if (provider.synced) {
      finish()
    }
  })
}

export async function bootstrapYjsProvider(
  descriptor: ReviewTargetDescriptor,
  wsOrigin = getDefaultWsOrigin(),
  accessMode: ReviewAccessMode = 'write'
): Promise<YjsProviderBootstrapResult> {
  const doc = new Y.Doc()

  const initialEnvelope = buildYjsTransportEnvelope(descriptor)
  const initialEnvelopeParams = serializeYjsTransportEnvelope(initialEnvelope)
  const snapshot = await fetchSnapshot(descriptor.yjsSessionId, initialEnvelopeParams, accessMode)
  const resolvedDescriptor = snapshot.descriptor
  const runtime = snapshot.runtime

  if (snapshot.snapshotBase64) {
    applySnapshotToDoc(doc, snapshot.snapshotBase64)
  }

  const serverUrl = `${wsOrigin}/yjs`

  const envelopeParams = serializeYjsTransportEnvelope(
    buildYjsTransportEnvelope(resolvedDescriptor)
  )
  const token = await fetchSocketToken()

  const provider = new WebsocketProvider(serverUrl, resolvedDescriptor.yjsSessionId, doc, {
    params: { token, accessMode, ...envelopeParams },
    connect: true,
  })
  let deactivated = false
  let disposed = false
  let reconnectDesired = accessMode === 'write'
  let reconnectGeneration = 0
  let tokenRefreshInFlight: Promise<void> | null = null
  let tokenRefreshRetryTimeout: ReturnType<typeof setTimeout> | null = null

  const reconnectWithFreshToken = () => {
    if (!reconnectDesired || deactivated || tokenRefreshInFlight || tokenRefreshRetryTimeout) return

    provider.shouldConnect = false
    const generation = reconnectGeneration
    tokenRefreshInFlight = (async () => {
      try {
        const nextToken = await fetchSocketToken()
        if (deactivated || !reconnectDesired || generation !== reconnectGeneration) return
        provider.params = { token: nextToken, accessMode, ...envelopeParams }
        provider.connect()
      } catch (error) {
        console.error('[YjsProvider] Failed to refresh socket token', error)
        if (deactivated || !reconnectDesired || generation !== reconnectGeneration) return
        tokenRefreshRetryTimeout = setTimeout(() => {
          tokenRefreshRetryTimeout = null
          reconnectWithFreshToken()
        }, SOCKET_TOKEN_RETRY_MS)
      } finally {
        tokenRefreshInFlight = null
      }
    })()
  }

  const handleConnectionLoss = () => {
    if (!provider.shouldConnect) return
    reconnectWithFreshToken()
  }
  if (accessMode === 'write') {
    provider.on('connection-close', handleConnectionLoss)
    provider.on('connection-error', handleConnectionLoss)
  }

  const deactivate = () => {
    if (deactivated) return
    deactivated = true
    reconnectDesired = false
    reconnectGeneration += 1
    if (tokenRefreshRetryTimeout) clearTimeout(tokenRefreshRetryTimeout)
    tokenRefreshRetryTimeout = null
    provider.off('connection-close', handleConnectionLoss)
    provider.off('connection-error', handleConnectionLoss)
    doc.off('destroy', deactivate)
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    deactivate()
    provider.disconnect()
    provider.destroy()
    doc.destroy()
  }
  doc.on('destroy', deactivate)

  if (accessMode === 'write') {
    try {
      await waitForYjsSync(provider)
    } catch (error) {
      dispose()
      throw error
    }
  }

  const result: YjsProviderBootstrapResult = {
    doc,
    provider,
    descriptor: resolvedDescriptor,
    runtime,
    accessMode,
  }
  providerLifecycles.set(result, { dispose })
  return result
}

function getDefaultWsOrigin(): string {
  return (getEnv('NEXT_PUBLIC_SOCKET_URL')?.trim() || 'http://localhost:3002')
    .replace(/^http:\/\//, 'ws://')
    .replace(/^https:\/\//, 'wss://')
}
