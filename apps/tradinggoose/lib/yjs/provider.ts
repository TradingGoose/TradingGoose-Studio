import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import {
  buildReviewTargetDescriptorFromEnvelope,
  buildYjsTransportEnvelope,
  parseYjsTransportEnvelope,
  serializeYjsTransportEnvelope,
} from '@/lib/copilot/review-sessions/identity'
import {
  type ReviewAccessMode,
  type ReviewTargetDescriptor,
  YJS_CLOSE_CODE_AUTHORIZATION_REVOKED,
  YJS_CLOSE_CODE_DOCUMENT_REJECTED,
} from '@/lib/copilot/review-sessions/types'
import { getEnv } from '@/lib/env'

export interface YjsProviderBootstrapResult {
  readonly doc: Y.Doc
  readonly provider: WebsocketProvider
  readonly descriptor: ReviewTargetDescriptor
  readonly accessMode: ReviewAccessMode
  readonly lifecycle: Promise<YjsProviderLifecycleEvent>
  readonly dispose: () => void
}

export type YjsProviderError = Error & { retryable: false }
export type YjsProviderLifecycleEvent =
  | { type: 'reader-disconnected' }
  | { type: 'terminal-failure'; error: YjsProviderError }

function terminalProviderError(message: string): YjsProviderError {
  return Object.assign(new Error(message), { retryable: false as const })
}

const SOCKET_TOKEN_RETRY_MS = 1_000
const SYNC_TIMEOUT_MS = 10_000

function connectionCloseError(event: unknown): YjsProviderError | null {
  const code = Number((event as { code?: unknown } | null)?.code)
  return code === YJS_CLOSE_CODE_AUTHORIZATION_REVOKED || code === YJS_CLOSE_CODE_DOCUMENT_REJECTED
    ? terminalProviderError('Yjs session was rejected')
    : null
}

function requireSuccessfulResponse(response: Response, label: string): void {
  if (response.ok) return
  const message = `${label} failed: ${response.status}`
  if (response.status >= 500 || response.status === 408 || response.status === 429) {
    throw new Error(message)
  }
  throw terminalProviderError(message)
}

async function fetchSocketToken(): Promise<string> {
  const response = await fetch('/api/auth/socket-token', {
    method: 'POST',
    cache: 'no-store',
    credentials: 'include',
    headers: { 'cache-control': 'no-store' },
  })
  requireSuccessfulResponse(response, 'Socket token fetch')
  const data = (await response.json().catch(() => null)) as { token?: unknown } | null
  if (typeof data?.token !== 'string' || !data.token) {
    throw terminalProviderError('Socket token response is malformed')
  }
  return data.token
}

async function fetchSnapshot(
  sessionId: string,
  envelopeParams: Record<string, string>
): Promise<{ update: Uint8Array; descriptor: ReviewTargetDescriptor }> {
  const response = await fetch(
    `/api/yjs/sessions/${encodeURIComponent(sessionId)}/snapshot?${new URLSearchParams({ ...envelopeParams, accessMode: 'write' })}`,
    { cache: 'no-store' }
  )
  requireSuccessfulResponse(response, 'Snapshot fetch')
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null
  try {
    const snapshotBase64 = data?.snapshotBase64
    if (typeof snapshotBase64 !== 'string' || !snapshotBase64 || !data?.descriptor)
      throw new Error()
    const descriptor = buildReviewTargetDescriptorFromEnvelope(
      parseYjsTransportEnvelope(
        serializeYjsTransportEnvelope(
          buildYjsTransportEnvelope(data.descriptor as ReviewTargetDescriptor)
        )
      )
    )
    const runtime = data.runtime as Record<string, unknown>
    if (
      descriptor.yjsSessionId !== sessionId ||
      runtime?.docState !== 'active' ||
      ![runtime.replaySafe, runtime.reseededFromCanonical].every(
        (value) => typeof value === 'boolean'
      )
    )
      throw new Error()
    const update = Uint8Array.from(atob(snapshotBase64), (character) => character.charCodeAt(0))
    Y.decodeUpdate(update)
    return { update, descriptor }
  } catch {
    throw terminalProviderError('Snapshot response is malformed')
  }
}

export function waitForYjsSync(provider: WebsocketProvider): Promise<void> {
  if (provider.synced) return Promise.resolve()

  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null
    const finish = (error?: Error) => {
      if (timeout) clearTimeout(timeout)
      timeout = null
      provider.off('sync', handleSync)
      provider.off('connection-close', handleConnectionFailure)
      provider.off('connection-error', handleConnectionFailure)
      error ? reject(error) : resolve()
    }
    const handleSync = (isSynced: boolean) => {
      if (isSynced) finish()
    }
    const handleConnectionFailure = (event?: unknown) => {
      finish(connectionCloseError(event) ?? new Error('Failed to establish authorized Yjs sync'))
    }

    timeout = setTimeout(handleConnectionFailure, SYNC_TIMEOUT_MS)
    provider.on('sync', handleSync)
    provider.on('connection-close', handleConnectionFailure)
    provider.on('connection-error', handleConnectionFailure)
    if (provider.synced) finish()
  })
}

export async function bootstrapYjsProvider(
  descriptor: ReviewTargetDescriptor,
  wsOrigin = getDefaultWsOrigin(),
  accessMode: ReviewAccessMode = 'write'
): Promise<YjsProviderBootstrapResult> {
  const snapshot =
    accessMode === 'write'
      ? await fetchSnapshot(
          descriptor.yjsSessionId,
          serializeYjsTransportEnvelope(buildYjsTransportEnvelope(descriptor))
        )
      : null
  const resolvedDescriptor = snapshot?.descriptor ?? descriptor
  const envelopeParams = serializeYjsTransportEnvelope(
    buildYjsTransportEnvelope(resolvedDescriptor)
  )
  const token = await fetchSocketToken()
  const doc = new Y.Doc()
  if (snapshot) Y.applyUpdate(doc, snapshot.update)

  const provider = new WebsocketProvider(`${wsOrigin}/yjs`, resolvedDescriptor.yjsSessionId, doc, {
    params: { token, accessMode, ...envelopeParams },
    connect: true,
  })
  let active = true
  let disposed = false
  let reconnectRetry: ReturnType<typeof setTimeout> | null = null
  let reconnectInFlight: Promise<void> | null = null
  let resolveLifecycle!: (event: YjsProviderLifecycleEvent) => void
  const lifecycle = new Promise<YjsProviderLifecycleEvent>((resolve) => {
    resolveLifecycle = resolve
  })

  function deactivate(): void {
    if (!active) return
    active = false
    if (reconnectRetry) clearTimeout(reconnectRetry)
    reconnectRetry = null
    provider.off('connection-close', handleConnectionLoss)
    provider.off('connection-error', handleConnectionLoss)
    doc.off('destroy', deactivate)
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    deactivate()
    provider.disconnect()
    provider.destroy()
    doc.destroy()
  }

  function finishLifecycle(event: YjsProviderLifecycleEvent): void {
    if (!active) return
    deactivate()
    provider.shouldConnect = false
    provider.disconnect()
    resolveLifecycle(event)
  }

  function reauthorizeAndReconnect(): void {
    if (!active || reconnectRetry || reconnectInFlight) return
    provider.shouldConnect = false
    reconnectInFlight = (async () => {
      try {
        await fetchSnapshot(resolvedDescriptor.yjsSessionId, envelopeParams)
        if (!active) return
        const nextToken = await fetchSocketToken()
        if (!active) return
        provider.params = { token: nextToken, accessMode, ...envelopeParams }
        provider.connect()
      } catch (error) {
        console.error('[YjsProvider] Failed to reauthorize connection', error)
        if ((error as { retryable?: unknown } | null)?.retryable === false) {
          finishLifecycle({ type: 'terminal-failure', error: error as YjsProviderError })
        } else if (active) {
          reconnectRetry = setTimeout(() => {
            reconnectRetry = null
            reauthorizeAndReconnect()
          }, SOCKET_TOKEN_RETRY_MS)
        }
      } finally {
        reconnectInFlight = null
      }
    })()
  }

  function handleConnectionLoss(event?: unknown): void {
    const terminalError = connectionCloseError(event)
    if (terminalError) {
      finishLifecycle({ type: 'terminal-failure', error: terminalError })
      return
    }
    if (accessMode === 'read') {
      finishLifecycle({ type: 'reader-disconnected' })
    } else if (provider.shouldConnect) {
      reauthorizeAndReconnect()
    }
  }

  provider.on('connection-close', handleConnectionLoss)
  provider.on('connection-error', handleConnectionLoss)
  doc.on('destroy', deactivate)

  try {
    await waitForYjsSync(provider)
  } catch (error) {
    dispose()
    throw error
  }

  return Object.freeze<YjsProviderBootstrapResult>({
    doc,
    provider,
    descriptor: resolvedDescriptor,
    accessMode,
    lifecycle,
    dispose,
  })
}

function getDefaultWsOrigin(): string {
  return (getEnv('NEXT_PUBLIC_SOCKET_URL')?.trim() || 'http://localhost:3002')
    .replace(/^http:\/\//, 'ws://')
    .replace(/^https:\/\//, 'wss://')
}
