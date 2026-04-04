'use client'

import * as Y from 'yjs'
import type { WebsocketProvider } from 'y-websocket'
import type { ReviewTargetDescriptor } from '@/lib/copilot/review-sessions/types'
import { deriveUserColor } from '@/lib/utils'
import { bootstrapYjsProvider, type YjsProviderBootstrapResult } from '@/lib/yjs/provider'
import { getVariablesMap, getWorkflowMap, getWorkflowTextFieldsMap } from '@/lib/yjs/workflow-session'
import {
  registerWorkflowSession,
  unregisterWorkflowSession,
} from '@/lib/yjs/workflow-session-registry'

export interface SharedWorkflowSessionState {
  doc: Y.Doc | null
  provider: WebsocketProvider | null
  awareness: any | null
  undoManager: Y.UndoManager | null
  canUndo: boolean
  canRedo: boolean
  isSynced: boolean
  isLoading: boolean
  error: string | null
}

export interface SharedWorkflowSessionUser {
  id: string
  name?: string
  email?: string
}

interface SharedWorkflowSessionEntry {
  workflowId: string
  workspaceId: string | null
  refCount: number
  destroyTimeout: ReturnType<typeof setTimeout> | null
  state: SharedWorkflowSessionState
  listeners: Set<() => void>
  initPromise: Promise<void> | null
  result: YjsProviderBootstrapResult | null
  syncUndoState: (() => void) | null
  cleanup: (() => void) | null
}

declare global {
  // eslint-disable-next-line no-var
  var __workflowYjsSessionEntries: Map<string, SharedWorkflowSessionEntry> | undefined
}

export const EMPTY_SHARED_WORKFLOW_SESSION_STATE: SharedWorkflowSessionState = {
  doc: null,
  provider: null,
  awareness: null,
  undoManager: null,
  canUndo: false,
  canRedo: false,
  isSynced: false,
  isLoading: true,
  error: null,
}

const SHARED_SESSION_DESTROY_GRACE_MS = 2_500

function getSharedSessionEntries(): Map<string, SharedWorkflowSessionEntry> {
  if (!globalThis.__workflowYjsSessionEntries) {
    globalThis.__workflowYjsSessionEntries = new Map()
  }

  return globalThis.__workflowYjsSessionEntries
}

function emitChange(entry: SharedWorkflowSessionEntry): void {
  for (const listener of entry.listeners) {
    listener()
  }
}

function setEntryState(
  entry: SharedWorkflowSessionEntry,
  patch: Partial<SharedWorkflowSessionState>
): void {
  const changed = Object.entries(patch).some(
    ([key, value]) => entry.state[key as keyof SharedWorkflowSessionState] !== value
  )

  if (!changed) {
    return
  }

  entry.state = {
    ...entry.state,
    ...patch,
  }
  emitChange(entry)
}

function destroyBootstrappedSession(result: YjsProviderBootstrapResult): void {
  result.provider.disconnect()
  result.provider.destroy()
  result.doc.destroy()
}

function cancelPendingDestroy(entry: SharedWorkflowSessionEntry): void {
  if (!entry.destroyTimeout) {
    return
  }

  clearTimeout(entry.destroyTimeout)
  entry.destroyTimeout = null
}

function createSessionEntry(args: {
  workflowId: string
  workspaceId: string | null
}): SharedWorkflowSessionEntry {
  return {
    workflowId: args.workflowId,
    workspaceId: args.workspaceId,
    refCount: 0,
    destroyTimeout: null,
    state: { ...EMPTY_SHARED_WORKFLOW_SESSION_STATE },
    listeners: new Set(),
    initPromise: null,
    result: null,
    syncUndoState: null,
    cleanup: null,
  }
}

function ensureSessionEntry(args: {
  workflowId: string
  workspaceId: string | null
}): SharedWorkflowSessionEntry {
  const entries = getSharedSessionEntries()
  const current = entries.get(args.workflowId)
  if (current) {
    cancelPendingDestroy(current)
    if (args.workspaceId != null) {
      current.workspaceId = args.workspaceId
    }
    return current
  }

  const entry = createSessionEntry(args)
  entries.set(args.workflowId, entry)
  return entry
}

async function initializeSharedSession(entry: SharedWorkflowSessionEntry): Promise<void> {
  const descriptor: ReviewTargetDescriptor = {
    workspaceId: entry.workspaceId,
    entityKind: 'workflow',
    entityId: entry.workflowId,
    draftSessionId: null,
    reviewSessionId: null,
    reviewModel: null,
    yjsSessionId: entry.workflowId,
  }

  try {
    const result = await bootstrapYjsProvider(descriptor)

    if (entry.refCount === 0 || getSharedSessionEntries().get(entry.workflowId) !== entry) {
      destroyBootstrappedSession(result)
      return
    }

    const undoManager = new Y.UndoManager([
      getWorkflowMap(result.doc),
      getWorkflowTextFieldsMap(result.doc),
      getVariablesMap(result.doc),
    ])
    undoManager.clear()

    const syncUndoState = () => {
      setEntryState(entry, {
        canUndo: undoManager.canUndo(),
        canRedo: undoManager.canRedo(),
      })
    }

    const syncStatus = (synced: boolean) => {
      setEntryState(entry, { isSynced: synced })
    }

    undoManager.on('stack-item-added', syncUndoState)
    undoManager.on('stack-item-popped', syncUndoState)
    undoManager.on('stack-cleared', syncUndoState)
    result.provider.on('sync', syncStatus)

    entry.result = result
    entry.syncUndoState = syncUndoState
    entry.cleanup = () => {
      undoManager.off('stack-item-added', syncUndoState)
      undoManager.off('stack-item-popped', syncUndoState)
      undoManager.off('stack-cleared', syncUndoState)
      result.provider.off('sync', syncStatus)
    }

    registerWorkflowSession({
      workflowId: entry.workflowId,
      doc: result.doc,
    })

    setEntryState(entry, {
      doc: result.doc,
      provider: result.provider,
      awareness: result.provider.awareness ?? null,
      undoManager,
      canUndo: false,
      canRedo: false,
      isSynced: false,
      isLoading: false,
      error: null,
    })
  } catch (error) {
    if (entry.refCount === 0 || getSharedSessionEntries().get(entry.workflowId) !== entry) {
      return
    }

    setEntryState(entry, {
      isLoading: false,
      error: error instanceof Error ? error.message : 'Failed to initialize workflow session',
    })
  } finally {
    entry.initPromise = null
  }
}

function ensureSharedSessionInitialized(entry: SharedWorkflowSessionEntry): void {
  if (entry.initPromise || entry.result) {
    return
  }

  entry.initPromise = initializeSharedSession(entry)
}

function releaseSharedSession(workflowId: string): void {
  const entries = getSharedSessionEntries()
  const entry = entries.get(workflowId)
  if (!entry) {
    return
  }

  entry.refCount = Math.max(0, entry.refCount - 1)
  if (entry.refCount > 0) {
    return
  }

  cancelPendingDestroy(entry)
  entry.destroyTimeout = setTimeout(() => {
    const currentEntry = getSharedSessionEntries().get(workflowId)
    if (!currentEntry || currentEntry !== entry || currentEntry.refCount > 0) {
      return
    }

    currentEntry.destroyTimeout = null
    entries.delete(workflowId)

    currentEntry.cleanup?.()
    currentEntry.cleanup = null
    currentEntry.syncUndoState = null

    if (currentEntry.result) {
      unregisterWorkflowSession(currentEntry.workflowId, currentEntry.result.doc)
      destroyBootstrappedSession(currentEntry.result)
      currentEntry.result = null
    } else {
      unregisterWorkflowSession(currentEntry.workflowId)
    }

    currentEntry.listeners.clear()
    currentEntry.state = { ...EMPTY_SHARED_WORKFLOW_SESSION_STATE }
  }, SHARED_SESSION_DESTROY_GRACE_MS)
}

export function acquireSharedWorkflowSession(args: {
  workflowId: string
  workspaceId: string | null
}): () => void {
  const entry = ensureSessionEntry(args)
  entry.refCount += 1
  ensureSharedSessionInitialized(entry)

  let released = false

  return () => {
    if (released) {
      return
    }
    released = true
    releaseSharedSession(args.workflowId)
  }
}

export function subscribeToSharedWorkflowSession(
  workflowId: string,
  listener: () => void
): () => void {
  const entry = getSharedSessionEntries().get(workflowId)
  if (!entry) {
    return () => {}
  }

  entry.listeners.add(listener)
  return () => {
    entry.listeners.delete(listener)
  }
}

export function getSharedWorkflowSessionState(
  workflowId: string | null | undefined
): SharedWorkflowSessionState {
  if (!workflowId) {
    return EMPTY_SHARED_WORKFLOW_SESSION_STATE
  }

  return getSharedSessionEntries().get(workflowId)?.state ?? EMPTY_SHARED_WORKFLOW_SESSION_STATE
}

export function setSharedWorkflowSessionUser(
  workflowId: string | null | undefined,
  user?: SharedWorkflowSessionUser
): void {
  if (!workflowId || !user) {
    return
  }

  const awareness = getSharedSessionEntries().get(workflowId)?.state.provider?.awareness
  if (!awareness) {
    return
  }

  const nextUser = {
    id: user.id,
    name: user.name ?? user.email ?? 'Anonymous',
    email: user.email,
    color: deriveUserColor(user.id),
  }
  const currentState = awareness.getLocalState() ?? {}
  const currentUser = currentState.user

  if (
    currentUser?.id === nextUser.id &&
    currentUser?.name === nextUser.name &&
    currentUser?.email === nextUser.email &&
    currentUser?.color === nextUser.color
  ) {
    return
  }

  awareness.setLocalState({
    ...currentState,
    user: nextUser,
  })
}

export function undoSharedWorkflowSession(workflowId: string | null | undefined): void {
  if (!workflowId) {
    return
  }

  const entry = getSharedSessionEntries().get(workflowId)
  const undoManager = entry?.state.undoManager
  if (!entry || !undoManager) {
    return
  }

  undoManager.undo()
  entry.syncUndoState?.()
}

export function redoSharedWorkflowSession(workflowId: string | null | undefined): void {
  if (!workflowId) {
    return
  }

  const entry = getSharedSessionEntries().get(workflowId)
  const undoManager = entry?.state.undoManager
  if (!entry || !undoManager) {
    return
  }

  undoManager.redo()
  entry.syncUndoState?.()
}
