'use client'

import type { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import type { ReviewAccessMode, ReviewTargetDescriptor } from '@/lib/copilot/review-sessions/types'
import { deriveUserColor } from '@/lib/utils'
import {
  bootstrapYjsProvider,
  waitForYjsSync,
  type YjsProviderBootstrapResult,
} from '@/lib/yjs/provider'
import { createYjsUndoTrackedOrigins } from '@/lib/yjs/transaction-origins'
import {
  getVariablesMap,
  readWorkflowMap,
  readWorkflowTextFieldsMap,
} from '@/lib/yjs/workflow-session'
import {
  type RegisteredWorkflowSession,
  registerWorkflowSession,
  unregisterWorkflowSession,
} from '@/lib/yjs/workflow-session-registry'

export interface SharedWorkflowSessionState {
  doc: Y.Doc | null
  provider: WebsocketProvider | null
  awareness: WebsocketProvider['awareness'] | null
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
  key: string
  workflowId: string
  workspaceId: string | null
  accessMode: ReviewAccessMode
  refCount: number
  destroyTimeout: ReturnType<typeof setTimeout> | null
  reopenTimeout: ReturnType<typeof setTimeout> | null
  state: SharedWorkflowSessionState
  listeners: Set<() => void>
  initPromise: Promise<void> | null
  result: YjsProviderBootstrapResult | null
  undoManager: Y.UndoManager | null
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
  canUndo: false,
  canRedo: false,
  isSynced: false,
  isLoading: true,
  error: null,
}

const SHARED_SESSION_DESTROY_GRACE_MS = 2_500
const SESSION_REOPEN_RETRY_MS = 1_000

const getSharedSessionKey = (workflowId: string, accessMode: ReviewAccessMode) =>
  `${accessMode}:${workflowId}`

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

function cancelPendingReopen(entry: SharedWorkflowSessionEntry): void {
  if (!entry.reopenTimeout) return
  clearTimeout(entry.reopenTimeout)
  entry.reopenTimeout = null
}

function createSessionEntry(args: {
  workflowId: string
  workspaceId: string | null
  accessMode: ReviewAccessMode
}): SharedWorkflowSessionEntry {
  return {
    key: getSharedSessionKey(args.workflowId, args.accessMode),
    workflowId: args.workflowId,
    workspaceId: args.workspaceId,
    accessMode: args.accessMode,
    refCount: 0,
    destroyTimeout: null,
    reopenTimeout: null,
    state: { ...EMPTY_SHARED_WORKFLOW_SESSION_STATE },
    listeners: new Set(),
    initPromise: null,
    result: null,
    undoManager: null,
    syncUndoState: null,
    cleanup: null,
  }
}

function ensureSessionEntry(args: {
  workflowId: string
  workspaceId: string | null
  accessMode: ReviewAccessMode
}): SharedWorkflowSessionEntry {
  const entries = getSharedSessionEntries()
  const key = getSharedSessionKey(args.workflowId, args.accessMode)
  const current = entries.get(key)
  if (current) {
    cancelPendingDestroy(current)
    if (args.workspaceId != null) {
      current.workspaceId = args.workspaceId
    }
    return current
  }

  const entry = createSessionEntry(args)
  entries.set(key, entry)
  return entry
}

async function initializeSharedSession(entry: SharedWorkflowSessionEntry): Promise<void> {
  const descriptor: ReviewTargetDescriptor = {
    workspaceId: entry.workspaceId,
    ownerUserId: null,
    entityKind: 'workflow',
    entityId: entry.workflowId,
    draftSessionId: null,
    reviewSessionId: null,
    yjsSessionId: entry.workflowId,
  }

  try {
    const result = await bootstrapYjsProvider(descriptor, undefined, entry.accessMode)

    if (entry.refCount === 0 || getSharedSessionEntries().get(entry.key) !== entry) {
      destroyBootstrappedSession(result)
      return
    }
    cancelPendingReopen(entry)

    const undoManager =
      entry.accessMode === 'write'
        ? new Y.UndoManager(
            [
              readWorkflowMap(result.doc),
              readWorkflowTextFieldsMap(result.doc),
              getVariablesMap(result.doc),
            ],
            {
              trackedOrigins: createYjsUndoTrackedOrigins(),
            }
          )
        : null
    undoManager?.clear()

    const syncUndoState = undoManager
      ? () => {
          setEntryState(entry, {
            canUndo: undoManager.canUndo(),
            canRedo: undoManager.canRedo(),
          })
        }
      : null

    const syncStatus = (synced: boolean) => {
      setEntryState(entry, { isSynced: synced })
    }
    const handleConnectionLoss = () => replaceLostSession(entry, result)

    if (syncUndoState) {
      undoManager?.on('stack-item-added', syncUndoState)
      undoManager?.on('stack-item-popped', syncUndoState)
      undoManager?.on('stack-cleared', syncUndoState)
    }
    result.provider.on('sync', syncStatus)
    result.provider.on('connection-close', handleConnectionLoss)
    result.provider.on('connection-error', handleConnectionLoss)

    entry.result = result
    entry.workspaceId = result.descriptor.workspaceId ?? entry.workspaceId
    entry.undoManager = undoManager
    entry.syncUndoState = syncUndoState
    entry.cleanup = () => {
      if (syncUndoState) {
        undoManager?.off('stack-item-added', syncUndoState)
        undoManager?.off('stack-item-popped', syncUndoState)
        undoManager?.off('stack-cleared', syncUndoState)
      }
      result.provider.off('sync', syncStatus)
      result.provider.off('connection-close', handleConnectionLoss)
      result.provider.off('connection-error', handleConnectionLoss)
    }

    if (entry.accessMode === 'write') {
      registerWorkflowSession({
        workflowId: entry.workflowId,
        workspaceId: entry.workspaceId,
        doc: result.doc,
      })
    }

    setEntryState(entry, {
      doc: result.doc,
      provider: result.provider,
      awareness: result.provider.awareness ?? null,
      canUndo: false,
      canRedo: false,
      isSynced: result.provider.synced === true,
      isLoading: false,
      error: null,
    })
  } catch (error) {
    if (entry.refCount === 0 || getSharedSessionEntries().get(entry.key) !== entry) {
      return
    }

    setEntryState(entry, {
      isLoading: false,
      error: error instanceof Error ? error.message : 'Failed to initialize workflow session',
    })
    scheduleSessionReopen(entry)
  } finally {
    entry.initPromise = null
  }
}

function replaceLostSession(
  entry: SharedWorkflowSessionEntry,
  result: YjsProviderBootstrapResult
): void {
  if (
    entry.refCount === 0 ||
    getSharedSessionEntries().get(entry.key) !== entry ||
    entry.result !== result
  ) {
    return
  }

  entry.cleanup?.()
  entry.cleanup = null
  if (entry.accessMode === 'write') {
    unregisterWorkflowSession(entry.workflowId, result.doc)
  }
  entry.undoManager?.destroy()
  entry.undoManager = null
  entry.syncUndoState = null
  entry.result = null
  setEntryState(entry, {
    ...EMPTY_SHARED_WORKFLOW_SESSION_STATE,
    isLoading: true,
  })
  destroyBootstrappedSession(result)
  scheduleSessionReopen(entry)
}

function scheduleSessionReopen(entry: SharedWorkflowSessionEntry): void {
  if (entry.reopenTimeout || entry.refCount === 0) return
  entry.reopenTimeout = setTimeout(() => {
    entry.reopenTimeout = null
    if (entry.refCount === 0 || getSharedSessionEntries().get(entry.key) !== entry) return
    ensureSharedSessionInitialized(entry)
  }, SESSION_REOPEN_RETRY_MS)
}

function ensureSharedSessionInitialized(entry: SharedWorkflowSessionEntry): void {
  if (entry.initPromise || entry.result) {
    return
  }

  entry.initPromise = initializeSharedSession(entry)
}

function releaseSharedSession(key: string): void {
  const entries = getSharedSessionEntries()
  const entry = entries.get(key)
  if (!entry) {
    return
  }

  entry.refCount = Math.max(0, entry.refCount - 1)
  if (entry.refCount > 0) {
    return
  }

  cancelPendingDestroy(entry)
  entry.destroyTimeout = setTimeout(() => {
    const currentEntry = getSharedSessionEntries().get(key)
    if (!currentEntry || currentEntry !== entry || currentEntry.refCount > 0) {
      return
    }

    currentEntry.destroyTimeout = null
    entries.delete(key)
    cancelPendingReopen(currentEntry)

    currentEntry.cleanup?.()
    currentEntry.cleanup = null
    currentEntry.undoManager?.destroy()
    currentEntry.undoManager = null
    currentEntry.syncUndoState = null

    if (currentEntry.result) {
      if (currentEntry.accessMode === 'write') {
        unregisterWorkflowSession(currentEntry.workflowId, currentEntry.result.doc)
      }
      destroyBootstrappedSession(currentEntry.result)
      currentEntry.result = null
    } else if (currentEntry.accessMode === 'write') {
      unregisterWorkflowSession(currentEntry.workflowId)
    }

    currentEntry.listeners.clear()
    currentEntry.state = { ...EMPTY_SHARED_WORKFLOW_SESSION_STATE }
  }, SHARED_SESSION_DESTROY_GRACE_MS)
}

export function acquireSharedWorkflowSession(args: {
  workflowId: string
  workspaceId: string | null
  accessMode: ReviewAccessMode
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
    releaseSharedSession(entry.key)
  }
}

export async function acquireWritableWorkflowSessionLease(args: {
  workflowId: string
  workspaceId: string | null
}): Promise<{ session: RegisteredWorkflowSession; release: () => void }> {
  const entry = ensureSessionEntry({ ...args, accessMode: 'write' })
  entry.refCount += 1
  ensureSharedSessionInitialized(entry)

  let released = false
  const release = () => {
    if (released) {
      return
    }
    released = true
    releaseSharedSession(entry.key)
  }

  if (entry.initPromise) {
    await entry.initPromise
  }

  if (!entry.result?.doc) {
    release()
    throw new Error(entry.state.error || 'Failed to initialize workflow Yjs session')
  }

  try {
    await waitForYjsSync(entry.result.provider)
  } catch (error) {
    release()
    throw error
  }

  return {
    session: {
      workflowId: entry.workflowId,
      workspaceId: entry.workspaceId,
      doc: entry.result.doc,
    },
    release,
  }
}

export function subscribeToSharedWorkflowSession(
  workflowId: string,
  accessMode: ReviewAccessMode,
  listener: () => void
): () => void {
  const entry = getSharedSessionEntries().get(getSharedSessionKey(workflowId, accessMode))
  if (!entry) {
    return () => {}
  }

  entry.listeners.add(listener)
  return () => {
    entry.listeners.delete(listener)
  }
}

export function getSharedWorkflowSessionState(
  workflowId: string | null | undefined,
  accessMode: ReviewAccessMode
): SharedWorkflowSessionState {
  if (!workflowId) {
    return EMPTY_SHARED_WORKFLOW_SESSION_STATE
  }

  return (
    getSharedSessionEntries().get(getSharedSessionKey(workflowId, accessMode))?.state ??
    EMPTY_SHARED_WORKFLOW_SESSION_STATE
  )
}

export function setSharedWorkflowSessionUser(
  workflowId: string | null | undefined,
  accessMode: ReviewAccessMode,
  user?: SharedWorkflowSessionUser
): void {
  if (!workflowId || !user) {
    return
  }

  const awareness = getSharedSessionEntries().get(getSharedSessionKey(workflowId, accessMode))
    ?.state.provider?.awareness
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

export function undoSharedWorkflowSession(
  workflowId: string | null | undefined,
  accessMode: ReviewAccessMode
): void {
  if (!workflowId) {
    return
  }

  const entry = getSharedSessionEntries().get(getSharedSessionKey(workflowId, accessMode))
  const undoManager = entry?.undoManager
  if (!entry || !undoManager) {
    return
  }

  undoManager.undo()
  entry.syncUndoState?.()
}

export function redoSharedWorkflowSession(
  workflowId: string | null | undefined,
  accessMode: ReviewAccessMode
): void {
  if (!workflowId) {
    return
  }

  const entry = getSharedSessionEntries().get(getSharedSessionKey(workflowId, accessMode))
  const undoManager = entry?.undoManager
  if (!entry || !undoManager) {
    return
  }

  undoManager.redo()
  entry.syncUndoState?.()
}
