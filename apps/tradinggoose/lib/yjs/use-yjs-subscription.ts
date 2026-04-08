'use client'

/**
 * Shared Yjs subscription factory for useSyncExternalStore.
 *
 * Encapsulates the versionRef / cachedRef pattern so that every hook
 * subscribing to a Y.Map doesn't have to reimplement the same logic.
 */

import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react'

export function useYjsSubscription<T>(
  /** Registers a listener; returns an unsubscribe function. */
  subscribe: (cb: () => void) => () => void,
  /** Extracts the current value from the external store. */
  extract: () => T,
  /** SSR fallback value. */
  fallback: T,
  /** Optional equality check (default: Object.is). */
  isEqual: (a: T, b: T) => boolean = Object.is
): T {
  const versionRef = useRef(0)
  const cachedRef = useRef<{ version: number; value: T } | null>(null)
  const sourceRef = useRef<{
    subscribe: (cb: () => void) => () => void
    extract: () => T
    isEqual: (a: T, b: T) => boolean
  } | null>(null)

  const stableSubscribe = useMemo(() => {
    return (cb: () => void) => {
      return subscribe(() => {
        versionRef.current += 1
        cb()
      })
    }
  }, [subscribe])

  const getSnapshot = useCallback(() => {
    const sourceChanged =
      sourceRef.current?.subscribe !== stableSubscribe ||
      sourceRef.current?.extract !== extract ||
      sourceRef.current?.isEqual !== isEqual

    if (sourceChanged) {
      sourceRef.current = {
        subscribe: stableSubscribe,
        extract,
        isEqual,
      }
      cachedRef.current = null
    }

    const currentVersion = versionRef.current
    if (cachedRef.current && cachedRef.current.version === currentVersion) {
      return cachedRef.current.value
    }
    const value = extract()
    // Preserve referential identity when deeply equal
    if (cachedRef.current && isEqual(cachedRef.current.value, value)) {
      cachedRef.current = { version: currentVersion, value: cachedRef.current.value }
      return cachedRef.current.value
    }
    cachedRef.current = { version: currentVersion, value }
    return value
  }, [extract, isEqual])

  return useSyncExternalStore(stableSubscribe, getSnapshot, () => fallback)
}
