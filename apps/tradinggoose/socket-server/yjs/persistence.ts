import { getRedisClient, getRedisStorageMode } from '@/lib/redis'

interface YjsSessionBlob {
  state: Buffer
  updatedAt: number
}

const TTL_MS = 7 * 24 * 60 * 60 * 1000
const TTL_SECONDS = Math.ceil(TTL_MS / 1000)
const REDIS_KEY_PREFIX = 'yjs:session:'
const MAX_LOCAL_ENTRIES = 100
const TTL_SWEEP_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

const localStore = new Map<string, YjsSessionBlob>()

function stateKey(sessionId: string): string {
  return `${REDIS_KEY_PREFIX}${sessionId}:state`
}

function updatedAtKey(sessionId: string): string {
  return `${REDIS_KEY_PREFIX}${sessionId}:updatedAt`
}

function isExpired(updatedAt: number | null): boolean {
  return updatedAt == null || Date.now() - updatedAt > TTL_MS
}

async function readRedisUpdatedAt(sessionId: string): Promise<number | null> {
  const redis = getRedisClient()
  if (!redis) {
    return null
  }

  const raw = await redis.get(updatedAtKey(sessionId))
  if (!raw) {
    return null
  }

  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

async function cleanupExpiredRedisSession(sessionId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) {
    return
  }

  await redis.del(stateKey(sessionId), updatedAtKey(sessionId))
}

function readLocalBlob(sessionId: string): YjsSessionBlob | null {
  const blob = localStore.get(sessionId)
  if (!blob) {
    return null
  }

  if (isExpired(blob.updatedAt)) {
    localStore.delete(sessionId)
    return null
  }

  // Move to end for LRU ordering
  localStore.delete(sessionId)
  localStore.set(sessionId, blob)

  return blob
}

export async function getState(sessionId: string): Promise<Uint8Array | null> {
  const mode = getRedisStorageMode()

  if (mode === 'redis') {
    const redis = getRedisClient()
    if (!redis) {
      return null
    }

    // Single Redis call — TTL-based expiry (set via pexpire in storeState)
    // handles staleness, so a separate updatedAt check is unnecessary and
    // avoids a second roundtrip plus a TOCTOU race between the two GETs.
    const buf = await redis.getBuffer(stateKey(sessionId))
    if (!buf) {
      return null
    }

    return new Uint8Array(buf)
  }

  const blob = readLocalBlob(sessionId)
  return blob ? new Uint8Array(blob.state) : null
}

export async function storeState(sessionId: string, state: Uint8Array): Promise<void> {
  const mode = getRedisStorageMode()
  const touchedAt = Date.now()

  if (mode === 'redis') {
    const redis = getRedisClient()
    if (!redis) {
      return
    }

    // Zero-copy Buffer wrapper — callers do not retain references to `state`
    // after calling storeState, so sharing the underlying ArrayBuffer is safe.
    const buf = Buffer.from(state.buffer, state.byteOffset, state.byteLength)

    await redis.multi()
      .set(stateKey(sessionId), buf)
      .pexpire(stateKey(sessionId), TTL_MS)
      .set(updatedAtKey(sessionId), String(touchedAt))
      .pexpire(updatedAtKey(sessionId), TTL_MS)
      .exec()
    return
  }

  // Delete first so re-insert moves to end for LRU ordering.
  // Copy is intentional here — the local Map retains this buffer long-term
  // and callers may reuse or mutate the original Uint8Array.
  localStore.delete(sessionId)
  localStore.set(sessionId, {
    state: Buffer.from(state),
    updatedAt: touchedAt,
  })

  // Evict oldest entries if over the limit
  while (localStore.size > MAX_LOCAL_ENTRIES) {
    const oldest = localStore.keys().next().value
    if (oldest) localStore.delete(oldest)
  }
}

export async function hasSession(sessionId: string): Promise<boolean> {
  const mode = getRedisStorageMode()

  if (mode === 'redis') {
    const redis = getRedisClient()
    if (!redis) {
      return false
    }

    // Single Redis call — TTL-based expiry handles staleness (see storeState).
    const exists = await redis.exists(stateKey(sessionId))
    return exists === 1
  }

  return readLocalBlob(sessionId) !== null
}

export async function deleteSession(sessionId: string): Promise<void> {
  const mode = getRedisStorageMode()

  if (mode === 'redis') {
    const redis = getRedisClient()
    if (!redis) {
      return
    }

    await redis.del(stateKey(sessionId), updatedAtKey(sessionId))
    return
  }

  localStore.delete(sessionId)
}

export async function getLastTouchedAt(sessionId: string): Promise<number | null> {
  const mode = getRedisStorageMode()

  if (mode === 'redis') {
    const updatedAt = await readRedisUpdatedAt(sessionId)
    if (isExpired(updatedAt)) {
      await cleanupExpiredRedisSession(sessionId)
      return null
    }

    return updatedAt
  }

  return readLocalBlob(sessionId)?.updatedAt ?? null
}

export function getPersistenceTtlMs(): number {
  return TTL_MS
}

export function getPersistenceTtlSeconds(): number {
  return TTL_SECONDS
}

// Periodic TTL sweep for local store to proactively clean expired entries.
// The interval handle is stored so it can be cleaned up in tests, and
// `.unref()` is called so the timer doesn't prevent process exit.
let ttlSweepInterval: ReturnType<typeof setInterval> | null = null

if (getRedisStorageMode() !== 'redis') {
  ttlSweepInterval = setInterval(() => {
    const now = Date.now()
    for (const [key, blob] of localStore) {
      if (now - blob.updatedAt > TTL_MS) {
        localStore.delete(key)
      }
    }
  }, TTL_SWEEP_INTERVAL_MS)

  // Allow the process to exit naturally even if this timer is still pending
  if (typeof ttlSweepInterval === 'object' && 'unref' in ttlSweepInterval) {
    ttlSweepInterval.unref()
  }
}

/**
 * Stops the TTL sweep interval and clears the local store.
 * Intended for test teardown to prevent open handles.
 */
export function cleanupPersistence(): void {
  if (ttlSweepInterval !== null) {
    clearInterval(ttlSweepInterval)
    ttlSweepInterval = null
  }
  localStore.clear()
}
