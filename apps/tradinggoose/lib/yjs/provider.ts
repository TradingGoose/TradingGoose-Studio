import * as syncProtocol from '@y/protocols/sync'
import * as decoding from 'lib0/decoding'
import { isEqual, isPlainObject } from 'lodash'
import { messageSync, WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import {
  buildYjsTransportEnvelope,
  serializeYjsTransportEnvelope,
} from '@/lib/copilot/review-sessions/identity'
import {
  type ReviewAccessMode,
  type ReviewTargetDescriptor,
  YJS_CLOSE_CODE_AUTHORIZATION_REVOKED,
  YJS_CLOSE_CODE_DOCUMENT_REJECTED,
} from '@/lib/copilot/review-sessions/types'
import { getEnv } from '@/lib/env'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'

export interface YjsPendingLocalEdits {
  readonly base: Uint8Array
  readonly updates: readonly Uint8Array[]
}

export interface YjsProviderBootstrapResult {
  readonly doc: Y.Doc
  readonly provider: WebsocketProvider
  readonly descriptor: ReviewTargetDescriptor
  readonly lifecycle: Promise<YjsProviderLifecycleEvent>
  readonly dispose: () => void
}

export type YjsProviderError = Error & { retryable: false }
export type YjsProviderLifecycleEvent =
  | { type: 'resync-required'; pendingLocalEdits?: YjsPendingLocalEdits }
  | { type: 'terminal-failure'; error: YjsProviderError }

function terminalProviderError(message: string): YjsProviderError {
  return Object.assign(new Error(message), { retryable: false as const })
}

const SYNC_TIMEOUT_MS = 10_000

function connectionCloseError(event: unknown): YjsProviderError | null {
  const code = Number((event as { code?: unknown } | null)?.code)
  if (code === 1009) {
    return terminalProviderError('Yjs update exceeds the realtime transport payload limit')
  }
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

const MISSING_Y_MAP_VALUE = Symbol('missing-y-map-value')

const yValueJson = (value: unknown) =>
  value instanceof Y.Map || value instanceof Y.Text ? value.toJSON() : value
const yValuesEqual = (left: unknown, right: unknown) =>
  left instanceof Y.Map === right instanceof Y.Map &&
  left instanceof Y.Text === right instanceof Y.Text &&
  isEqual(yValueJson(left), yValueJson(right))

function mergeYMapValue(base: unknown, local: unknown, remote: unknown): unknown {
  if (base instanceof Y.Map && local instanceof Y.Map && remote instanceof Y.Map) {
    for (const key of new Set([...base.keys(), ...local.keys()])) {
      const remoteValue = remote.has(key) ? remote.get(key) : MISSING_Y_MAP_VALUE
      const merged = mergeYMapValue(
        base.has(key) ? base.get(key) : MISSING_Y_MAP_VALUE,
        local.has(key) ? local.get(key) : MISSING_Y_MAP_VALUE,
        remoteValue
      )
      if (merged === MISSING_Y_MAP_VALUE) {
        remote.delete(key)
      } else if (!yValuesEqual(remoteValue, merged)) {
        remote.set(
          key,
          merged instanceof Y.Map || merged instanceof Y.Text
            ? merged.clone()
            : structuredClone(merged)
        )
      }
    }
    return remote
  }
  if (yValuesEqual(local, base)) return remote
  if (yValuesEqual(remote, base)) return local
  if (isPlainObject(base) && isPlainObject(local) && isPlainObject(remote)) {
    const baseRecord = base as Record<string, unknown>
    const localRecord = local as Record<string, unknown>
    const remoteRecord = remote as Record<string, unknown>
    const merged = new Map(Object.entries(remoteRecord))
    for (const key of new Set([...Object.keys(baseRecord), ...Object.keys(localRecord)])) {
      const value = mergeYMapValue(
        Object.hasOwn(baseRecord, key) ? baseRecord[key] : MISSING_Y_MAP_VALUE,
        Object.hasOwn(localRecord, key) ? localRecord[key] : MISSING_Y_MAP_VALUE,
        Object.hasOwn(remoteRecord, key) ? remoteRecord[key] : MISSING_Y_MAP_VALUE
      )
      if (value === MISSING_Y_MAP_VALUE) merged.delete(key)
      else merged.set(key, value)
    }
    return Object.fromEntries(merged)
  }
  return [base, local, remote].every((value) => value instanceof Y.Text) ? local : remote
}

function applyYjsPendingLocalEdits(target: Y.Doc, pending: YjsPendingLocalEdits | undefined): void {
  if (!pending) return
  const baseState = Y.decodeStateVector(Y.encodeStateVectorFromUpdate(pending.base))
  const targetState = Y.decodeStateVector(Y.encodeStateVector(target))
  if (
    baseState.size > 0 &&
    [...baseState].every(([client, clock]) => (targetState.get(client) ?? 0) >= clock)
  ) {
    for (const update of pending.updates) Y.applyUpdate(target, update, YJS_ORIGINS.SYSTEM)
    return
  }
  const base = new Y.Doc()
  const current = new Y.Doc()
  try {
    Y.applyUpdate(base, pending.base, YJS_ORIGINS.SYSTEM)
    Y.applyUpdate(current, pending.base, YJS_ORIGINS.SYSTEM)
    target.transact(() => {
      for (const update of pending.updates) {
        Y.applyUpdate(current, update, YJS_ORIGINS.SYSTEM)
        for (const name of current.share.keys()) {
          if (name === 'metadata') continue
          mergeYMapValue(base.getMap(name), current.getMap(name), target.getMap(name))
        }
        Y.applyUpdate(base, update, YJS_ORIGINS.SYSTEM)
      }
    }, YJS_ORIGINS.SYSTEM)
  } finally {
    base.destroy()
    current.destroy()
  }
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
  accessMode: ReviewAccessMode = 'write',
  pendingLocalEdits?: YjsPendingLocalEdits
): Promise<YjsProviderBootstrapResult> {
  const envelopeParams = serializeYjsTransportEnvelope(buildYjsTransportEnvelope(descriptor))
  const token = await fetchSocketToken()
  const doc = new Y.Doc()
  const acknowledged = new Y.Doc()
  let active = true
  const provider = new WebsocketProvider(`${wsOrigin}/yjs`, descriptor.yjsSessionId, doc, {
    params: { token, accessMode, ...envelopeParams },
    connect: false,
    disableBc: true,
  })
  const localUpdates: Uint8Array[] = []
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== provider) localUpdates.push(update)
  })
  const applySyncMessage = provider.messageHandlers[messageSync]!
  provider.messageHandlers[messageSync] = (encoder, decoder, source, emitSynced, messageType) => {
    if (active) {
      const mirror = decoding.clone(decoder)
      const syncMessageType = decoding.readVarUint(mirror)
      if (
        syncMessageType === syncProtocol.messageYjsSyncStep2 ||
        syncMessageType === syncProtocol.messageYjsUpdate
      ) {
        Y.applyUpdate(acknowledged, decoding.readVarUint8Array(mirror), YJS_ORIGINS.SYSTEM)
      }
    }
    applySyncMessage(encoder, decoder, source, emitSynced, messageType)
  }
  provider.connect()
  let disposed = false
  let resolveLifecycle!: (event: YjsProviderLifecycleEvent) => void
  const lifecycle = new Promise<YjsProviderLifecycleEvent>((resolve) => {
    resolveLifecycle = resolve
  })

  function deactivate(): void {
    if (!active) return
    active = false
    provider.off('connection-close', handleConnectionLoss)
    provider.off('connection-error', handleConnectionLoss)
    doc.off('destroy', deactivate)
    acknowledged.destroy()
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

  function handleConnectionLoss(event?: unknown): void {
    const terminalError = connectionCloseError(event)
    if (terminalError) {
      finishLifecycle({ type: 'terminal-failure', error: terminalError })
      return
    }
    provider.shouldConnect = false
    queueMicrotask(() => {
      if (!active) return
      if (accessMode === 'read') finishLifecycle({ type: 'resync-required' })
      else
        finishLifecycle({
          type: 'resync-required',
          pendingLocalEdits: {
            base: Y.encodeStateAsUpdate(acknowledged),
            updates: localUpdates,
          },
        })
    })
  }

  provider.on('connection-close', handleConnectionLoss)
  provider.on('connection-error', handleConnectionLoss)
  doc.on('destroy', deactivate)

  try {
    await waitForYjsSync(provider)
    applyYjsPendingLocalEdits(doc, pendingLocalEdits)
  } catch (error) {
    dispose()
    throw error
  }

  return Object.freeze<YjsProviderBootstrapResult>({
    doc,
    provider,
    descriptor,
    lifecycle,
    dispose,
  })
}

function getDefaultWsOrigin(): string {
  return (getEnv('NEXT_PUBLIC_SOCKET_URL')?.trim() || 'http://localhost:3002')
    .replace(/^http:\/\//, 'ws://')
    .replace(/^https:\/\//, 'wss://')
}
