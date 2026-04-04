'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useOptionalWorkflowSession,
} from '@/lib/yjs/workflow-session-host'

// UI presence user for components
type PresenceUser = {
  connectionId: string | number
  name?: string
  color?: string
  info?: string
}

interface UsePresenceReturn {
  users: PresenceUser[]
  currentUser: PresenceUser | null
  isConnected: boolean
}

/**
 * Hook for managing user presence in collaborative workflows using Yjs Awareness.
 * Replaces the previous Socket.IO-based presence implementation.
 *
 * Yjs Awareness automatically tracks connected users per document session,
 * handles cleanup on disconnect, and syncs over the same WebSocket transport.
 */
export function usePresence(): UsePresenceReturn {
  const session = useOptionalWorkflowSession()
  const awareness = session?.awareness
  const isSynced = session?.isSynced ?? false

  const rafRef = useRef(0)
  const [users, setUsers] = useState<PresenceUser[]>([])
  // Keep a ref so the onChange callback can read the latest users without
  // needing `users` in its dependency array (avoids stale closure).
  const usersRef = useRef(users)
  usersRef.current = users

  // Cache the previous raw awareness states to bail out early when nothing changed.
  const prevStatesRef = useRef<Map<number, any> | null>(null)

  // Derive users from awareness, returning same reference if unchanged.
  // Only identity-level fields (connectionId, name, color) are compared for
  // referential stability -- transient fields like `info` (cursor / selection
  // state) are updated in-place so downstream consumers that only care about
  // *who* is present don't re-render on every cursor move.
  const deriveUsers = useCallback((): PresenceUser[] => {
    if (!awareness) return []

    const states = awareness.getStates() as Map<number, any>

    // Shallow equality check on raw awareness states -- if the Map reference
    // and size haven't changed and every entry is identical, skip re-derivation.
    const prevStates = prevStatesRef.current
    if (prevStates && prevStates.size === states.size) {
      let unchanged = true
      states.forEach((value, key) => {
        if (unchanged && prevStates.get(key) !== value) {
          unchanged = false
        }
      })
      if (unchanged) return usersRef.current
    }
    prevStatesRef.current = new Map(states)

    const result: PresenceUser[] = []
    const seenUserIds = new Set<string>()

    states.forEach((state, clientId) => {
      if (!state?.user) return
      if (clientId === awareness.clientID) return
      if (state.user.id && seenUserIds.has(state.user.id)) return
      if (state.user.id) seenUserIds.add(state.user.id)

      result.push({
        connectionId: state.user.id ?? clientId,
        name: state.user.name ?? state.user.email,
        color: state.user.color,
        info: state.selection?.type ? `Editing ${state.selection.type}` : undefined,
      })
    })

    // Identity-level structural equality check: only compare fields that
    // represent user presence (connectionId, name, color). Transient fields
    // like `info` (cursor/selection) are patched onto the existing array
    // objects so the array reference stays stable.
    const prev = usersRef.current
    const identityMatch =
      prev.length === result.length &&
      prev.every(
        (u, i) =>
          u.connectionId === result[i].connectionId &&
          u.name === result[i].name &&
          u.color === result[i].color
      )

    if (identityMatch) {
      const infoChanged = prev.some((p, i) => p.info !== result[i].info)
      if (!infoChanged) return prev
      return prev.map((p, i) => p.info === result[i].info ? p : { ...p, info: result[i].info })
    }

    return result
  }, [awareness])

  // Subscribe to awareness changes, throttled to one update per animation frame
  useEffect(() => {
    if (!awareness) return

    // Compute initial users
    const initial = deriveUsers()
    if (initial !== usersRef.current) {
      setUsers(initial)
    }

    const onChange = () => {
      if (rafRef.current) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0
        const prevUsers = usersRef.current
        const newUsers = deriveUsers()
        if (newUsers !== prevUsers) {
          setUsers(newUsers)
        }
      })
    }
    awareness.on('change', onChange)
    return () => {
      awareness.off('change', onChange)
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
    }
  }, [awareness, deriveUsers])

  return {
    users,
    currentUser: null,
    isConnected: isSynced,
  }
}

/**
 * Set the local user's awareness state (cursor, selection, user info).
 * Call this from workflow editor components that need to broadcast presence.
 */
export function useAwarenessActions() {
  const session = useOptionalWorkflowSession()
  const awareness = session?.awareness

  const setUser = useCallback(
    (user: { id: string; name?: string; email?: string; color?: string }) => {
      if (!awareness) return
      const current = awareness.getLocalState() ?? {}
      awareness.setLocalState({ ...current, user })
    },
    [awareness]
  )

  const setCursor = useCallback(
    (cursor: { x: number; y: number } | null) => {
      if (!awareness) return
      const current = awareness.getLocalState() ?? {}
      awareness.setLocalState({ ...current, cursor })
    },
    [awareness]
  )

  const setSelection = useCallback(
    (selection: { type: 'block' | 'edge' | 'none'; id?: string } | null) => {
      if (!awareness) return
      const current = awareness.getLocalState() ?? {}
      awareness.setLocalState({ ...current, selection })
    },
    [awareness]
  )

  return { setUser, setCursor, setSelection }
}
