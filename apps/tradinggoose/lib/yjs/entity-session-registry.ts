'use client'

import { useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import type { WebsocketProvider } from 'y-websocket'
import type { ReviewTargetDescriptor, ReviewTargetRuntimeState } from '@/lib/copilot/review-sessions/types'

export interface RegisteredEntitySession {
  descriptor: ReviewTargetDescriptor
  doc: Y.Doc
  provider: WebsocketProvider | null
  runtime: ReviewTargetRuntimeState | null
  isSynced: boolean
  canUndo: boolean
  canRedo: boolean
}

const sessions = new Map<string, RegisteredEntitySession>()
const listeners = new Set<() => void>()

function emitChange(): void {
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function registerEntitySession(session: RegisteredEntitySession): void {
  if (!session.descriptor.reviewSessionId) {
    return
  }

  sessions.set(session.descriptor.reviewSessionId, { ...session })
  emitChange()
}

export function unregisterEntitySession(reviewSessionId: string | null | undefined): void {
  if (!reviewSessionId) {
    return
  }

  if (!sessions.delete(reviewSessionId)) {
    return
  }

  emitChange()
}

export function updateRegisteredEntitySession(
  reviewSessionId: string | null | undefined,
  patch: Partial<RegisteredEntitySession>
): void {
  if (!reviewSessionId) {
    return
  }

  const current = sessions.get(reviewSessionId)
  if (!current) {
    return
  }

  // Check if any value actually changed
  const changed = Object.entries(patch).some(
    ([key, value]) => current[key as keyof RegisteredEntitySession] !== value
  )
  if (!changed) return

  sessions.set(reviewSessionId, {
    ...current,
    ...patch,
  })
  emitChange()
}

export function getRegisteredEntitySession(
  reviewSessionId: string | null | undefined
): RegisteredEntitySession | null {
  if (!reviewSessionId) {
    return null
  }

  return sessions.get(reviewSessionId) ?? null
}

export function getRegisteredEntitySessionByIdentity(
  entityKind: RegisteredEntitySession['descriptor']['entityKind'],
  entityId: string | null | undefined,
  workspaceId?: string | null
): RegisteredEntitySession | null {
  if (!entityId) {
    return null
  }

  const matches = Array.from(sessions.values()).filter((session) => {
    if (session.descriptor.entityKind !== entityKind) {
      return false
    }

    if (session.descriptor.entityId !== entityId) {
      return false
    }

    if (workspaceId != null && session.descriptor.workspaceId !== workspaceId) {
      return false
    }

    return true
  })

  return matches.length === 1 ? matches[0] : null
}

export function useRegisteredEntitySession(
  reviewSessionId: string | null | undefined
): RegisteredEntitySession | null {
  return useSyncExternalStore(
    subscribe,
    () => getRegisteredEntitySession(reviewSessionId),
    () => null
  )
}
