'use client'

import React, { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as Y from 'yjs'
import type { WebsocketProvider } from 'y-websocket'
import type { ReviewTargetDescriptor, ReviewTargetRuntimeState } from '@/lib/copilot/review-sessions/types'
import {
  getReviewTargetRuntimeState,
} from '@/lib/copilot/review-sessions/runtime'
import { deriveUserColor } from '@/lib/utils'
import { bootstrapYjsProvider, type YjsProviderBootstrapResult } from '@/lib/yjs/provider'
import { getFieldsMap, getEntityMetadataMap } from '@/lib/yjs/entity-session'
import { createYjsUndoTrackedOrigins } from '@/lib/yjs/transaction-origins'
import {
  getCurrentTabId,
  readSeed,
  clearSeed,
  clearStaleSeed,
} from '@/widgets/utils/draft-bootstrap-seeds'
import {
  registerEntitySession,
  unregisterEntitySession,
  updateRegisteredEntitySession,
} from '@/lib/yjs/entity-session-registry'

// ---------------------------------------------------------------------------
// Context value
// ---------------------------------------------------------------------------

export interface EntitySessionContextValue {
  doc: Y.Doc | null
  provider: WebsocketProvider | null
  awareness: any | null
  descriptor: ReviewTargetDescriptor | null
  runtime: ReviewTargetRuntimeState | null
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
  isSynced: boolean
  isLoading: boolean
  error: string | null
}

const EMPTY_ENTITY_SESSION_CONTEXT: EntitySessionContextValue = {
  doc: null,
  provider: null,
  awareness: null,
  descriptor: null,
  runtime: null,
  canUndo: false,
  canRedo: false,
  undo: () => {},
  redo: () => {},
  isSynced: false,
  isLoading: true,
  error: null,
}

const EntitySessionContext = createContext<EntitySessionContextValue>(EMPTY_ENTITY_SESSION_CONTEXT)

function syncEntitySessionUser(awareness: any | null | undefined, user?: EntitySessionUser): void {
  if (!awareness) {
    return
  }

  if (!user) {
    awareness.setLocalState(null)
    return
  }

  const userColor = deriveUserColor(user.id)
  awareness.setLocalState({
    user: {
      id: user.id,
      name: user.name ?? user.email ?? 'Anonymous',
      email: user.email,
      color: userColor,
    },
  })
}

function buildPendingEntitySessionState(
  descriptor: ReviewTargetDescriptor | null,
  overrides: Partial<EntitySessionContextValue> = {}
): EntitySessionContextValue {
  return {
    ...EMPTY_ENTITY_SESSION_CONTEXT,
    descriptor,
    isLoading: descriptor !== null,
    ...overrides,
  }
}

function isSameEntitySession(
  left: ReviewTargetDescriptor | null,
  right: ReviewTargetDescriptor | null
): boolean {
  if (!left || !right) {
    return left === right
  }

  return (
    left.reviewSessionId === right.reviewSessionId && left.yjsSessionId === right.yjsSessionId
  )
}

export function useEntitySession(): EntitySessionContextValue {
  return useContext(EntitySessionContext)
}

// ---------------------------------------------------------------------------
// Host component
// ---------------------------------------------------------------------------

export interface EntitySessionUser {
  id: string
  name?: string
  email?: string
}

interface EntitySessionHostProps {
  descriptor: ReviewTargetDescriptor
  user?: EntitySessionUser
  children: ReactNode
}

/**
 * Mounts an entity Yjs doc by the resolved yjsSessionId and provides the
 * doc/provider pair to descendant components via React context.
 *
 * Responsibilities:
 *   - Bootstraps the Yjs provider (snapshot fetch + WebSocket connection)
 *   - Tracks sync status
 *   - Cleans up the provider and doc on unmount or descriptor change
 */
export function EntitySessionHost({ descriptor, user, children }: EntitySessionHostProps) {
  const draftSeed = useMemo(() => {
    if (!descriptor.draftSessionId) {
      return null
    }

    clearStaleSeed(descriptor.draftSessionId, getCurrentTabId())
    const seed = readSeed(descriptor.draftSessionId)
    if (!seed || seed.entityKind !== descriptor.entityKind) {
      return null
    }

    return seed
  }, [descriptor.draftSessionId, descriptor.entityKind])
  const [state, setState] = useState<EntitySessionContextValue>(() =>
    buildPendingEntitySessionState(descriptor)
  )
  const visibleState = useMemo(() => {
    // When the requested review target changes, mask the previous doc
    // immediately so editors never render stale entity content under the
    // next descriptor while the new Yjs bootstrap is still in flight.
    if (!isSameEntitySession(state.descriptor, descriptor)) {
      return buildPendingEntitySessionState(descriptor)
    }

    return state
  }, [descriptor, state])

  useEffect(() => {
    if (!descriptor.yjsSessionId) return

    setState(buildPendingEntitySessionState(descriptor))

    let cancelled = false
    let result: YjsProviderBootstrapResult | null = null
    let undoManager: Y.UndoManager | null = null
    let syncUndoState: (() => void) | null = null
    let syncRuntimeState: (() => void) | null = null

    async function init() {
      try {
        result = await bootstrapYjsProvider(descriptor, {
          draftSeed: draftSeed
            ? {
                entityKind: draftSeed.entityKind,
                payload: draftSeed.payload,
              }
            : null,
        })
        if (cancelled) {
          result.provider.destroy()
          result.doc.destroy()
          return
        }

        const nextUndoManager = new Y.UndoManager([getFieldsMap(result.doc)], {
          trackedOrigins: createYjsUndoTrackedOrigins(),
        })
        nextUndoManager.clear()
        undoManager = nextUndoManager
        const applyUndoState = () => {
          if (cancelled) {
            return
          }

          const canUndo = nextUndoManager.canUndo()
          const canRedo = nextUndoManager.canRedo()

          setState((prev) => {
            if (prev.canUndo === canUndo && prev.canRedo === canRedo) return prev
            return { ...prev, canUndo, canRedo }
          })
          updateRegisteredEntitySession(result?.descriptor.reviewSessionId, {
            canUndo,
            canRedo,
          })
        }
        syncUndoState = applyUndoState

        syncRuntimeState = () => {
          if (cancelled || !result) {
            return
          }

          const runtime = getReviewTargetRuntimeState(result.doc)
          setState((prev) => ({
            ...prev,
            runtime,
          }))
          updateRegisteredEntitySession(result.descriptor.reviewSessionId, {
            runtime,
          })
        }

        nextUndoManager.on('stack-item-added', syncUndoState)
        nextUndoManager.on('stack-item-popped', syncUndoState)
        nextUndoManager.on('stack-cleared', syncUndoState)

        const metadata = getEntityMetadataMap(result.doc)
        metadata.observe(syncRuntimeState)

        // Track sync status
        result.provider.on('sync', (isSynced: boolean) => {
          if (!cancelled) {
            if (isSynced && result?.descriptor.draftSessionId) {
              const bootstrapTouch = getEntityMetadataMap(result.doc).get('bootstrap-touch')
              if (bootstrapTouch) {
                clearSeed(result.descriptor.draftSessionId)
              }
            }

            setState((prev) => ({ ...prev, isSynced }))
            updateRegisteredEntitySession(result?.descriptor.reviewSessionId, { isSynced })
          }
        })

        // Seed presence immediately when the user is already available on first bootstrap.
        syncEntitySessionUser(result.provider.awareness, user)

        const runtime = getReviewTargetRuntimeState(result.doc)
        registerEntitySession({
          descriptor: result.descriptor,
          doc: result.doc,
          provider: result.provider,
          runtime,
          isSynced: false,
          canUndo: false,
          canRedo: false,
        })

        const nextState: EntitySessionContextValue = {
          doc: result.doc,
          provider: result.provider,
          awareness: result.provider.awareness ?? null,
          descriptor: result.descriptor,
          runtime,
          canUndo: false,
          canRedo: false,
          undo: () => {
            nextUndoManager.undo()
            applyUndoState()
          },
          redo: () => {
            nextUndoManager.redo()
            applyUndoState()
          },
          isSynced: false,
          isLoading: false,
          error: null,
        }

        setState(nextState)
        syncRuntimeState()
      } catch (err) {
        if (!cancelled) {
          setState(
            buildPendingEntitySessionState(descriptor, {
              isLoading: false,
              descriptor,
              error: err instanceof Error ? err.message : 'Failed to initialize entity session',
            })
          )
        }
      }
    }

    init()

    return () => {
      cancelled = true
      if (result && undoManager && syncUndoState) {
        undoManager.off('stack-item-added', syncUndoState)
        undoManager.off('stack-item-popped', syncUndoState)
        undoManager.off('stack-cleared', syncUndoState)
      }
      if (result && syncRuntimeState) {
        getEntityMetadataMap(result.doc).unobserve(syncRuntimeState)
      }
      unregisterEntitySession(result?.descriptor.reviewSessionId ?? descriptor.reviewSessionId)
      if (result) {
        result.provider.disconnect()
        result.provider.destroy()
        result.doc.destroy()
      }
    }
  }, [descriptor.reviewSessionId, descriptor.yjsSessionId, descriptor.draftSessionId, draftSeed])

  useEffect(() => {
    syncEntitySessionUser(visibleState.awareness, user)
  }, [user, visibleState.awareness])

  return (
    <EntitySessionContext.Provider value={visibleState}>
      {children}
    </EntitySessionContext.Provider>
  )
}
