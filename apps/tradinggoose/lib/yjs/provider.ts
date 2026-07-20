import { diffChars } from 'diff'
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
import {
  decodeYjsLifecycleMessage,
  encodeYjsPersistRequest,
  YJS_MESSAGE_LIFECYCLE,
} from '@/lib/yjs/lifecycle-protocol'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'

export interface YjsPendingLocalEdits {
  readonly base: Uint8Array
  readonly replay: ReadonlyArray<{ local: boolean; update: Uint8Array }>
}

export interface YjsProviderBootstrapResult {
  readonly doc: Y.Doc
  readonly provider: WebsocketProvider
  readonly lifecycle: Promise<YjsProviderLifecycleEvent>
  readonly persist: (identityName?: string) => Promise<void>
  readonly dispose: () => void
}

export type YjsProviderError = Error & { retryable: false }
export type YjsProviderLifecycleEvent =
  | { type: 'lineage-replaced'; pendingLocalEdits?: YjsPendingLocalEdits }
  | { type: 'terminal-failure'; error: YjsProviderError }

function terminalProviderError(message: string): YjsProviderError {
  return Object.assign(new Error(message), { retryable: false as const })
}

const SYNC_TIMEOUT_MS = 10_000
const RECONNECT_RETRY_MS = 1_000

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
type StableIdRecord = Record<string, unknown> & { id: string }

function indexStableIdArray(value: unknown): Map<string, StableIdRecord> | null {
  if (!Array.isArray(value)) return null
  const items = new Map<string, StableIdRecord>()
  for (const item of value) {
    if (!isPlainObject(item)) return null
    const id = (item as Record<string, unknown>).id
    if (typeof id !== 'string' || !id.trim() || items.has(id)) return null
    items.set(id, item as StableIdRecord)
  }
  return items
}

const yValueJson = (value: unknown) =>
  value instanceof Y.Map || value instanceof Y.Text ? value.toJSON() : value
const yValuesEqual = (left: unknown, right: unknown) =>
  left instanceof Y.Map === right instanceof Y.Map &&
  left instanceof Y.Text === right instanceof Y.Text &&
  isEqual(yValueJson(left), yValueJson(right))

function readTextBranch(base: string, next: string) {
  const kept = Array.from(base, () => false)
  const insertions = Array.from({ length: kept.length + 1 }, () => '')
  let baseIndex = 0

  for (const change of diffChars(base, next)) {
    if (change.added) {
      insertions[baseIndex] += change.value
      continue
    }
    const length = Array.from(change.value).length
    if (!change.removed) kept.fill(true, baseIndex, baseIndex + length)
    baseIndex += length
  }
  return { kept, insertions }
}

function mergeYTextValue(base: Y.Text, local: Y.Text, remote: Y.Text): Y.Text {
  const baseValue = base.toString()
  const localBranch = readTextBranch(baseValue, local.toString())
  const remoteBranch = readTextBranch(baseValue, remote.toString())
  let merged = ''

  for (const [index, character] of [...baseValue, ''].entries()) {
    merged += remoteBranch.insertions[index]! + localBranch.insertions[index]!
    if (character && remoteBranch.kept[index] && localBranch.kept[index]) merged += character
  }

  remote.applyDelta(
    diffChars(remote.toString(), merged).map((change) =>
      change.added
        ? { insert: change.value }
        : change.removed
          ? { delete: change.value.length }
          : { retain: change.value.length }
    )
  )
  return remote
}

function mergeYMapValue(
  base: unknown,
  local: unknown,
  remote: unknown,
  allowStableIdCollection = false
): unknown {
  if (base instanceof Y.Map && local instanceof Y.Map && remote instanceof Y.Map) {
    for (const key of new Set([...base.keys(), ...local.keys()])) {
      const remoteValue = remote.has(key) ? remote.get(key) : MISSING_Y_MAP_VALUE
      const merged = mergeYMapValue(
        base.has(key) ? base.get(key) : MISSING_Y_MAP_VALUE,
        local.has(key) ? local.get(key) : MISSING_Y_MAP_VALUE,
        remoteValue,
        true
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
  if (base instanceof Y.Text && local instanceof Y.Text && remote instanceof Y.Text) {
    return mergeYTextValue(base, local, remote)
  }
  if (yValuesEqual(local, base)) return remote
  if (yValuesEqual(remote, base)) return local
  const baseItems = allowStableIdCollection ? indexStableIdArray(base) : null
  const localItems = allowStableIdCollection ? indexStableIdArray(local) : null
  const remoteItems = allowStableIdCollection ? indexStableIdArray(remote) : null
  if (baseItems && localItems && remoteItems) {
    const merged = new Map<string, unknown>(remoteItems)
    for (const id of new Set([...baseItems.keys(), ...localItems.keys()])) {
      const value = mergeYMapValue(
        baseItems.get(id) ?? MISSING_Y_MAP_VALUE,
        localItems.get(id) ?? MISSING_Y_MAP_VALUE,
        remoteItems.get(id) ?? MISSING_Y_MAP_VALUE,
        false
      )
      if (value === MISSING_Y_MAP_VALUE) merged.delete(id)
      else merged.set(id, value)
    }
    return [
      ...[...remoteItems.keys()].flatMap((id) => (merged.has(id) ? [merged.get(id)] : [])),
      ...[...localItems.keys()].flatMap((id) =>
        !baseItems.has(id) && !remoteItems.has(id) && merged.has(id) ? [merged.get(id)] : []
      ),
    ]
  }
  if (isPlainObject(base) && isPlainObject(local) && isPlainObject(remote)) {
    const baseRecord = base as Record<string, unknown>
    const localRecord = local as Record<string, unknown>
    const remoteRecord = remote as Record<string, unknown>
    const merged = new Map(Object.entries(remoteRecord))
    for (const key of new Set([...Object.keys(baseRecord), ...Object.keys(localRecord)])) {
      const value = mergeYMapValue(
        Object.hasOwn(baseRecord, key) ? baseRecord[key] : MISSING_Y_MAP_VALUE,
        Object.hasOwn(localRecord, key) ? localRecord[key] : MISSING_Y_MAP_VALUE,
        Object.hasOwn(remoteRecord, key) ? remoteRecord[key] : MISSING_Y_MAP_VALUE,
        false
      )
      if (value === MISSING_Y_MAP_VALUE) merged.delete(key)
      else merged.set(key, value)
    }
    return Object.fromEntries(merged)
  }
  return remote
}

function replayYjsPendingLocalEdits(
  target: Y.Doc,
  pending: YjsPendingLocalEdits | undefined
): void {
  if (!pending) return
  const base = new Y.Doc()
  const current = new Y.Doc()
  try {
    Y.applyUpdate(base, pending.base, YJS_ORIGINS.SYSTEM)
    Y.applyUpdate(current, pending.base, YJS_ORIGINS.SYSTEM)
    for (const { local, update } of pending.replay) {
      const alreadyApplied = local && Y.snapshotContainsUpdate(Y.snapshot(target), update)
      Y.applyUpdate(current, update, YJS_ORIGINS.SYSTEM)
      if (local && !alreadyApplied)
        target.transact(() => {
          for (const name of current.share.keys()) {
            if (name === 'metadata') continue
            mergeYMapValue(base.getMap(name), current.getMap(name), target.getMap(name))
          }
        }, YJS_ORIGINS.SYSTEM)
      Y.applyUpdate(base, update, YJS_ORIGINS.SYSTEM)
    }
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
  let active = true
  const provider = new WebsocketProvider(`${wsOrigin}/yjs`, descriptor.yjsSessionId, doc, {
    params: { token, accessMode, ...envelopeParams },
    connect: false,
    disableBc: true,
  })
  let localBase: Uint8Array | null = null
  const localUpdates: Uint8Array[] = []
  const replayUpdates: YjsPendingLocalEdits['replay'][number][] = []
  let lineageId: string | null = null
  let resolveLineage!: () => void
  const lineage = new Promise<void>((resolve) => {
    resolveLineage = resolve
  })
  let disposed = false
  let ready = false
  let reconnecting = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  const persistRequests = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void; updates: Uint8Array[] }
  >()
  let resolveLifecycle!: (event: YjsProviderLifecycleEvent) => void
  const lifecycle = new Promise<YjsProviderLifecycleEvent>((resolve) => {
    resolveLifecycle = resolve
  })

  function acceptPersistedSnapshot(snapshot: Y.Snapshot): void {
    if (
      active &&
      localUpdates.length > 0 &&
      localUpdates.every((update) => Y.snapshotContainsUpdate(snapshot, update))
    ) {
      localBase = null
      localUpdates.length = 0
      replayUpdates.length = 0
    }
  }

  function handleBeforeTransaction(transaction: Y.Transaction): void {
    if (active && transaction.origin !== provider && !localBase) {
      localBase = Y.encodeStateAsUpdate(doc)
    }
  }

  function handleDocumentUpdate(update: Uint8Array, origin: unknown): void {
    if (!active) return
    const local = origin !== provider
    if (local) localUpdates.push(update)
    if (localBase) replayUpdates.push({ local, update })
  }

  function getPendingLocalEdits(): YjsPendingLocalEdits | undefined {
    return localBase && localUpdates.length > 0
      ? { base: localBase, replay: [...replayUpdates] }
      : undefined
  }

  provider.messageHandlers[YJS_MESSAGE_LIFECYCLE] = (_encoder, decoder) => {
    if (!active) return
    const message = decodeYjsLifecycleMessage(decoder)
    if (message.type === 'persist-error') {
      const request = persistRequests.get(message.requestId)
      persistRequests.delete(message.requestId)
      request?.reject(new Error(message.error))
      return
    }
    if (message.type !== 'checkpoint') return
    if (lineageId && lineageId !== message.lineageId) {
      provider.messageHandlers[messageSync] = () => undefined
      finishLifecycle({
        type: 'lineage-replaced',
        pendingLocalEdits: getPendingLocalEdits(),
      })
      return
    }
    if (!lineageId) {
      lineageId = message.lineageId
      resolveLineage()
    }
    acceptPersistedSnapshot(message.snapshot)
    if (message.requestId) {
      const request = persistRequests.get(message.requestId)
      persistRequests.delete(message.requestId)
      if (request?.updates.every((update) => Y.snapshotContainsUpdate(message.snapshot, update))) {
        request.resolve()
      } else {
        request?.reject(new Error('Persistence checkpoint omitted requested Yjs updates'))
      }
    }
  }

  function rejectPersistRequests(error: Error): void {
    for (const request of persistRequests.values()) request.reject(error)
    persistRequests.clear()
  }

  function deactivate(): void {
    if (!active) return
    active = false
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = null
    provider.off('connection-close', handleConnectionLoss)
    provider.off('connection-error', handleConnectionError)
    rejectPersistRequests(new Error('Yjs session closed before persistence completed'))
    doc.off('beforeTransaction', handleBeforeTransaction)
    doc.off('update', handleDocumentUpdate)
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

  function scheduleReconnect(delayMs = 0): void {
    if (!active || reconnecting || reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void reconnect()
    }, delayMs)
  }

  async function reconnect(): Promise<void> {
    if (!active || reconnecting || !lineageId) return
    reconnecting = true
    let retry = false
    try {
      const nextToken = await fetchSocketToken()
      if (!active) return
      provider.params.token = nextToken
      provider.connect()
    } catch (error) {
      if (!active) return
      if ((error as { retryable?: unknown } | null)?.retryable === false) {
        finishLifecycle({
          type: 'terminal-failure',
          error: error as YjsProviderError,
        })
      } else {
        retry = true
      }
    } finally {
      reconnecting = false
    }
    if (retry) scheduleReconnect(RECONNECT_RETRY_MS)
  }

  function handleConnectionLoss(event?: unknown): void {
    rejectPersistRequests(new Error('Yjs connection closed before persistence completed'))
    const terminalError = connectionCloseError(event)
    if (terminalError) {
      finishLifecycle({ type: 'terminal-failure', error: terminalError })
      return
    }
    provider.shouldConnect = false
    if (ready) scheduleReconnect()
  }

  function handleConnectionError(): void {
    provider.disconnect()
  }

  function persist(identityName?: string): Promise<void> {
    if (
      !active ||
      accessMode !== 'write' ||
      !provider.wsconnected ||
      !provider.synced ||
      !provider.ws
    ) {
      return Promise.reject(new Error('Yjs session is not connected for persistence'))
    }
    const requestId = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      persistRequests.set(requestId, { resolve, reject, updates: [...localUpdates] })
      try {
        provider.ws!.send(encodeYjsPersistRequest(requestId, identityName))
      } catch (error) {
        persistRequests.delete(requestId)
        reject(error instanceof Error ? error : new Error('Failed to request Yjs persistence'))
      }
    })
  }

  provider.on('connection-close', handleConnectionLoss)
  provider.on('connection-error', handleConnectionError)
  doc.on('beforeTransaction', handleBeforeTransaction)
  doc.on('update', handleDocumentUpdate)
  doc.on('destroy', deactivate)

  try {
    const initialSync = waitForYjsSync(provider)
    provider.connect()
    await Promise.all([initialSync, lineage])
    replayYjsPendingLocalEdits(doc, pendingLocalEdits)
    ready = true
  } catch (error) {
    dispose()
    throw error
  }

  return Object.freeze<YjsProviderBootstrapResult>({
    doc,
    provider,
    lifecycle,
    persist,
    dispose,
  })
}

function getDefaultWsOrigin(): string {
  return (getEnv('NEXT_PUBLIC_SOCKET_URL')?.trim() || 'http://localhost:3002')
    .replace(/^http:\/\//, 'ws://')
    .replace(/^https:\/\//, 'wss://')
}
