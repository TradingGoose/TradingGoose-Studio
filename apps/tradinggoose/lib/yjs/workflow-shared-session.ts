'use client'

import type { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import type { ReviewTargetDescriptor } from '@/lib/copilot/review-sessions/types'
import { deriveUserColor } from '@/lib/utils'
import {
  bootstrapYjsProvider,
  waitForYjsSync,
  type YjsPendingLocalEdits,
  type YjsProviderBootstrapResult,
} from '@/lib/yjs/provider'
import { createYjsUndoTrackedOrigins } from '@/lib/yjs/transaction-origins'
import {
  getVariablesMap,
  readWorkflowMap,
  readWorkflowSubBlockFieldsMap,
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
  workflowId: string
  workspaceId: string | null
  refCount: number
  destroyTimeout: ReturnType<typeof setTimeout> | null
  state: SharedWorkflowSessionState
  listeners: Set<() => void>
  initPromise: Promise<void> | null
  result: YjsProviderBootstrapResult | null
  isTerminal: boolean
  undoManager: Y.UndoManager | null
  syncUndoState: (() => void) | null
  cleanup: (() => void) | null
  pendingLocalEdits?: YjsPendingLocalEdits
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
    isTerminal: false,
    undoManager: null,
    syncUndoState: null,
    cleanup: null,
  }
}

function disposeWorkflowSessionEntry(entry: SharedWorkflowSessionEntry): void {
  const result = entry.result
  entry.cleanup?.()
  entry.cleanup = null
  entry.undoManager?.destroy()
  entry.undoManager = null
  entry.syncUndoState = null
  entry.result = null
  unregisterWorkflowSession(entry.workflowId, result?.doc)
  result?.dispose()
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
    yjsSessionId: entry.workflowId,
  }

  try {
    const result = await bootstrapYjsProvider(
      descriptor,
      undefined,
      'write',
      entry.pendingLocalEdits
    )

    if (entry.refCount === 0 || getSharedSessionEntries().get(entry.workflowId) !== entry) {
      result.dispose()
      return
    }

    entry.pendingLocalEdits = undefined
    entry.result = result
    void result.lifecycle.then((event) => {
      if (entry.result !== result) return
      disposeWorkflowSessionEntry(entry)
      if (event.type === 'reopen') {
        entry.pendingLocalEdits = event.pendingLocalEdits
        setEntryState(entry, EMPTY_SHARED_WORKFLOW_SESSION_STATE)
        if (entry.refCount > 0) entry.initPromise = initializeSharedSession(entry)
        return
      }
      entry.isTerminal = true
      setEntryState(entry, {
        ...EMPTY_SHARED_WORKFLOW_SESSION_STATE,
        isLoading: false,
        error: event.error.message,
      })
    })

    const undoManager = new Y.UndoManager(
      [
        readWorkflowMap(result.doc),
        readWorkflowSubBlockFieldsMap(result.doc),
        getVariablesMap(result.doc),
      ],
      {
        trackedOrigins: createYjsUndoTrackedOrigins(),
      }
    )

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

    entry.undoManager = undoManager
    entry.syncUndoState = syncUndoState
    entry.cleanup = () => {
      undoManager.off('stack-item-added', syncUndoState)
      undoManager.off('stack-item-popped', syncUndoState)
      undoManager.off('stack-cleared', syncUndoState)
      result.provider.off('sync', syncStatus)
    }

    registerWorkflowSession({
      workflowId: entry.workflowId,
      workspaceId: entry.workspaceId,
      doc: result.doc,
    })

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
    if (entry.refCount === 0 || getSharedSessionEntries().get(entry.workflowId) !== entry) {
      return
    }

    entry.isTerminal = (error as { retryable?: unknown } | null)?.retryable === false
    setEntryState(entry, {
      isLoading: false,
      error: error instanceof Error ? error.message : 'Failed to initialize workflow session',
    })
    if (!entry.isTerminal) scheduleWorkflowSessionReopen(entry)
  } finally {
    entry.initPromise = null
  }
}

function scheduleWorkflowSessionReopen(entry: SharedWorkflowSessionEntry): void {
  setTimeout(() => {
    if (getSharedSessionEntries().get(entry.workflowId) === entry && entry.refCount > 0) {
      ensureSharedSessionInitialized(entry)
    }
  }, SESSION_REOPEN_RETRY_MS)
}

function ensureSharedSessionInitialized(entry: SharedWorkflowSessionEntry): void {
  if (entry.isTerminal || entry.initPromise || entry.result) {
    return
  }

  entry.initPromise = initializeSharedSession(entry)
}

function retainWorkflowSession(
  entry: SharedWorkflowSessionEntry,
  listener?: () => void
): () => void {
  entry.refCount += 1
  if (listener) entry.listeners.add(listener)
  ensureSharedSessionInitialized(entry)
  let released = false
  return () => {
    if (released) return
    released = true
    if (listener) entry.listeners.delete(listener)
    entry.refCount -= 1
    if (entry.refCount > 0) return
    entry.destroyTimeout = setTimeout(() => {
      if (getSharedSessionEntries().get(entry.workflowId) !== entry || entry.refCount > 0) return
      getSharedSessionEntries().delete(entry.workflowId)
      disposeWorkflowSessionEntry(entry)
    }, SHARED_SESSION_DESTROY_GRACE_MS)
  }
}

export function acquireSharedWorkflowSession(
  args: { workflowId: string; workspaceId: string | null },
  listener?: () => void
): () => void {
  return retainWorkflowSession(ensureSessionEntry(args), listener)
}

export async function acquireWritableWorkflowSessionLease(args: {
  workflowId: string
  workspaceId: string | null
}): Promise<{ session: RegisteredWorkflowSession; release: () => void }> {
  const entry = ensureSessionEntry(args)
  const release = retainWorkflowSession(entry)

  if (entry.initPromise) {
    await entry.initPromise
  }

  const result = entry.result
  if (!result) {
    release()
    throw new Error(entry.state.error || 'Failed to initialize workflow Yjs session')
  }

  try {
    await waitForYjsSync(result.provider)
    if (entry.result !== result) {
      throw new Error(entry.state.error || 'Workflow Yjs session ended during sync')
    }
  } catch (error) {
    release()
    throw error
  }

  return {
    session: {
      workflowId: entry.workflowId,
      workspaceId: entry.workspaceId,
      doc: result.doc,
    },
    release,
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
  const undoManager = entry?.undoManager
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
  const undoManager = entry?.undoManager
  if (!entry || !undoManager) {
    return
  }

  undoManager.redo()
  entry.syncUndoState?.()
}
