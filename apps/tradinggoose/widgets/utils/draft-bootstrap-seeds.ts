import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'

/**
 * Transient bootstrap-seed map for unsaved entity drafts.
 *
 * Lifecycle:
 * 1. List-widget opener writes the seed via writeSeed() with the new draftSessionId
 * 2. entity-session-host.tsx reads the seed to populate the Yjs doc on first mount
 * 3. After the Yjs doc is bootstrapped (bootstrap-touch marker + sync=true), the host clears the seed
 *
 * First-writer-wins per draftSessionId. Secondary tabs read the existing seed.
 * Seeds are mirrored into sessionStorage for tab-reload resilience.
 */

export interface DraftBootstrapSeed {
  draftSessionId: string
  entityKind: ReviewEntityKind
  payload: Record<string, any>
  ownerTabId: string
  createdAt: number
}

const SESSION_STORAGE_PREFIX = 'draft-seed:'
const STALE_THRESHOLD_MS = 30 * 60 * 1000 // 30 minutes

// In-memory map
const seedMap = new Map<string, DraftBootstrapSeed>()

// Unique tab id for ownership tracking
const currentTabId =
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`

function sessionStorageKey(draftSessionId: string): string {
  return `${SESSION_STORAGE_PREFIX}${draftSessionId}`
}

/**
 * Write a bootstrap seed for a draft. Returns false if a seed already exists (first-writer-wins).
 */
export function writeSeed(seed: DraftBootstrapSeed): boolean {
  // First-writer-wins check
  if (seedMap.has(seed.draftSessionId)) {
    return false
  }

  // Check sessionStorage too
  try {
    const existing = sessionStorage.getItem(sessionStorageKey(seed.draftSessionId))
    if (existing) {
      // Populate in-memory from sessionStorage
      const parsed = JSON.parse(existing) as DraftBootstrapSeed
      seedMap.set(seed.draftSessionId, parsed)
      return false
    }
  } catch {
    // sessionStorage unavailable - proceed with in-memory only
  }

  const seedWithOwner: DraftBootstrapSeed = {
    ...seed,
    ownerTabId: currentTabId,
    createdAt: Date.now(),
  }

  seedMap.set(seed.draftSessionId, seedWithOwner)

  // Mirror to sessionStorage
  try {
    sessionStorage.setItem(sessionStorageKey(seed.draftSessionId), JSON.stringify(seedWithOwner))
  } catch {
    // sessionStorage write failed - in-memory map is sole authority
  }

  return true
}

/**
 * Read a bootstrap seed by draftSessionId. Returns null if not found.
 */
export function readSeed(draftSessionId: string): DraftBootstrapSeed | null {
  const inMemory = seedMap.get(draftSessionId)
  if (inMemory) return inMemory

  // Fall back to sessionStorage
  try {
    const stored = sessionStorage.getItem(sessionStorageKey(draftSessionId))
    if (stored) {
      const parsed = JSON.parse(stored) as DraftBootstrapSeed
      seedMap.set(draftSessionId, parsed)
      return parsed
    }
  } catch {
    // sessionStorage unavailable
  }

  return null
}

/**
 * Clear a bootstrap seed from both in-memory and sessionStorage.
 */
export function clearSeed(draftSessionId: string): void {
  seedMap.delete(draftSessionId)
  try {
    sessionStorage.removeItem(sessionStorageKey(draftSessionId))
  } catch {
    // sessionStorage unavailable
  }
}

/**
 * Clear a stale seed if it was owned by a different tab and is older than the threshold.
 * Returns true if the seed was cleared.
 */
export function clearStaleSeed(
  draftSessionId: string,
  currentTab: string = currentTabId,
  maxAgeMs: number = STALE_THRESHOLD_MS
): boolean {
  const seed = readSeed(draftSessionId)
  if (!seed) return false

  if (seed.ownerTabId !== currentTab && Date.now() - seed.createdAt > maxAgeMs) {
    clearSeed(draftSessionId)
    return true
  }

  return false
}

/**
 * Get the current tab's id for ownership tracking.
 */
export function getCurrentTabId(): string {
  return currentTabId
}

// Cleanup on beforeunload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    // Clear seeds owned by this tab that haven't been consumed
    seedMap.forEach((seed, key) => {
      if (seed.ownerTabId === currentTabId) {
        clearSeed(key)
      }
    })
  })
}
