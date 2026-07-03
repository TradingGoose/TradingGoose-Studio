'use client'

/**
 * React hooks for binding entity editor fields to a Yjs document.
 *
 * These hooks subscribe to the Yjs `fields` Y.Map and provide
 * [value, setter] tuples that work identically to useState but
 * read/write through the collaborative Yjs document when available.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import * as Y from 'yjs'
import {
  buildEntityListDescriptor,
  buildSavedEntityDescriptor,
  buildYjsTransportEnvelope,
  serializeYjsTransportEnvelope,
} from '@/lib/copilot/review-sessions/identity'
import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import { MCP_TOOLS_CHANGED_EVENT } from '@/lib/mcp/utils'
import {
  type EntityListMember,
  getEntityListMembers,
  getFieldsMap,
  replaceEntityTextField,
  setEntityField,
} from '@/lib/yjs/entity-session'
import type { SavedEntityKind } from '@/lib/yjs/entity-state'
import { bootstrapYjsProvider, type YjsProviderBootstrapResult } from '@/lib/yjs/provider'
import { useYjsSubscription } from '@/lib/yjs/use-yjs-subscription'
import { getQueryClient } from '@/app/query-provider'
import { customToolsKeys } from '@/hooks/queries/custom-tools'
import { indicatorKeys } from '@/hooks/queries/indicators'
import { knowledgeKeys } from '@/hooks/queries/knowledge'
import { skillsKeys } from '@/hooks/queries/skills'

type SavedEntityYjsSessionState = {
  key: string | null
  result: YjsProviderBootstrapResult | null
  error: string | null
}

type SharedYjsSessionEntry = {
  key: string
  result: YjsProviderBootstrapResult | null
  error: string | null
  refCount: number
  initPromise: Promise<void> | null
  listeners: Set<() => void>
}

const sharedYjsSessionEntries = new Map<string, SharedYjsSessionEntry>()

function closeYjsSession(result: YjsProviderBootstrapResult): void {
  result.provider.disconnect()
  result.provider.destroy()
  result.doc.destroy()
}

async function saveYjsSessionSnapshot(result: YjsProviderBootstrapResult): Promise<void> {
  const { descriptor } = result
  const params = new URLSearchParams({
    ...serializeYjsTransportEnvelope(buildYjsTransportEnvelope(descriptor)),
    accessMode: 'write',
  })
  const update = Y.encodeStateAsUpdate(result.doc)
  const updateBase64 = btoa(Array.from(update, (byte) => String.fromCharCode(byte)).join(''))
  const response = await fetch(
    `/api/yjs/sessions/${encodeURIComponent(descriptor.yjsSessionId)}/snapshot?${params}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updateBase64 }),
    }
  )
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to save Yjs session')
  }
}

function readSharedYjsSessionEntry(entry: SharedYjsSessionEntry): SavedEntityYjsSessionState {
  return {
    key: entry.key,
    result: entry.result,
    error: entry.error,
  }
}

function emitSharedYjsSessionEntry(entry: SharedYjsSessionEntry): void {
  for (const listener of entry.listeners) {
    listener()
  }
}

function getSharedYjsSessionEntry(sessionKey: string): SharedYjsSessionEntry {
  const current = sharedYjsSessionEntries.get(sessionKey)
  if (current) return current

  const entry: SharedYjsSessionEntry = {
    key: sessionKey,
    result: null,
    error: null,
    refCount: 0,
    initPromise: null,
    listeners: new Set(),
  }
  sharedYjsSessionEntries.set(sessionKey, entry)
  return entry
}

function initializeSharedYjsSessionEntry(
  entry: SharedYjsSessionEntry,
  openSession: () => Promise<YjsProviderBootstrapResult>,
  errorMessage: string,
  staleResult?: YjsProviderBootstrapResult
): void {
  if (entry.initPromise || (!staleResult && entry.result)) return

  if (!staleResult) {
    entry.error = null
    emitSharedYjsSessionEntry(entry)
  }
  entry.initPromise = openSession()
    .then((next) => {
      if (
        sharedYjsSessionEntries.get(entry.key) !== entry ||
        entry.refCount === 0 ||
        (staleResult && entry.result !== staleResult)
      ) {
        closeYjsSession(next)
        return
      }

      entry.result = next
      entry.error = null
      if (next.accessMode === 'read') {
        attachReadSessionReopen(entry, next, openSession, errorMessage)
      }
      if (staleResult) {
        emitSharedYjsSessionEntry(entry)
        closeYjsSession(staleResult)
      }
    })
    .catch((nextError) => {
      if (sharedYjsSessionEntries.get(entry.key) !== entry || entry.refCount === 0) return
      entry.error = nextError instanceof Error ? nextError.message : errorMessage
    })
    .finally(() => {
      if (sharedYjsSessionEntries.get(entry.key) !== entry) return
      entry.initPromise = null
      emitSharedYjsSessionEntry(entry)
      if (staleResult ? entry.result === staleResult : !entry.result) {
        scheduleSharedYjsSessionReopen(entry, openSession, errorMessage, staleResult)
      }
    })
}

const SESSION_REOPEN_RETRY_MS = 1_000

function attachReadSessionReopen(
  entry: SharedYjsSessionEntry,
  result: YjsProviderBootstrapResult,
  openSession: () => Promise<YjsProviderBootstrapResult>,
  errorMessage: string
): void {
  let handled = false
  const handleConnectionLoss = () => {
    if (handled) return
    handled = true
    result.provider.off('connection-close', handleConnectionLoss)
    result.provider.off('connection-error', handleConnectionLoss)
    if (sharedYjsSessionEntries.get(entry.key) !== entry || entry.result !== result) return
    scheduleSharedYjsSessionReopen(entry, openSession, errorMessage, result)
  }
  result.provider.on('connection-close', handleConnectionLoss)
  result.provider.on('connection-error', handleConnectionLoss)
}

// A subscribed session converges to live: every failed open — initial or
// after connection loss — retries at the same 1s cadence write sessions use
// for token rotation, until the session is live or the entry is released.
function scheduleSharedYjsSessionReopen(
  entry: SharedYjsSessionEntry,
  openSession: () => Promise<YjsProviderBootstrapResult>,
  errorMessage: string,
  staleResult?: YjsProviderBootstrapResult
): void {
  setTimeout(() => {
    if (sharedYjsSessionEntries.get(entry.key) !== entry || entry.refCount === 0) return
    initializeSharedYjsSessionEntry(entry, openSession, errorMessage, staleResult)
  }, SESSION_REOPEN_RETRY_MS)
}

function releaseSharedYjsSessionEntry(entry: SharedYjsSessionEntry): void {
  entry.refCount = Math.max(0, entry.refCount - 1)
  if (entry.refCount > 0) return

  sharedYjsSessionEntries.delete(entry.key)
  if (entry.result) {
    closeYjsSession(entry.result)
    entry.result = null
  }
  entry.listeners.clear()
}

function invalidateSavedEntityQueries(
  entityKind: SavedEntityKind,
  entityId: string,
  workspaceId: string
): void {
  const queryClient = getQueryClient()

  switch (entityKind) {
    case 'skill':
      void queryClient.invalidateQueries({ queryKey: skillsKeys.list(workspaceId) })
      return
    case 'custom_tool':
      void queryClient.invalidateQueries({ queryKey: customToolsKeys.list(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: customToolsKeys.detail(entityId) })
      return
    case 'indicator':
      void queryClient.invalidateQueries({ queryKey: indicatorKeys.list(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: indicatorKeys.detail(entityId) })
      return
    case 'knowledge_base':
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.list(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.detail(entityId) })
      return
    case 'mcp_server':
      window.dispatchEvent(new CustomEvent(MCP_TOOLS_CHANGED_EVENT, { detail: { workspaceId } }))
      return
  }
}

function useYjsSession(
  sessionKey: string | null,
  openSession: (() => Promise<YjsProviderBootstrapResult>) | null,
  errorMessage: string
) {
  const [state, setState] = useState<SavedEntityYjsSessionState>({
    key: null,
    result: null,
    error: null,
  })

  useEffect(() => {
    if (!sessionKey || !openSession) {
      setState({ key: sessionKey, result: null, error: null })
      return
    }

    const entry = getSharedYjsSessionEntry(sessionKey)
    entry.refCount += 1

    const syncState = () => setState(readSharedYjsSessionEntry(entry))
    entry.listeners.add(syncState)
    syncState()
    initializeSharedYjsSessionEntry(entry, openSession, errorMessage)

    return () => {
      entry.listeners.delete(syncState)
      releaseSharedYjsSessionEntry(entry)
    }
  }, [errorMessage, openSession, sessionKey])

  return state.key === sessionKey ? state : null
}

export function useSavedEntityYjsSession(
  entityKind: SavedEntityKind,
  entityId: string | null | undefined,
  workspaceId: string | null | undefined
) {
  const sessionKey = entityId && workspaceId ? `${entityKind}:${workspaceId}:${entityId}` : null
  const openSession = useCallback(
    () => bootstrapYjsProvider(buildSavedEntityDescriptor(entityKind, entityId!, workspaceId!)),
    [entityId, entityKind, workspaceId]
  )
  const activeState = useYjsSession(
    sessionKey,
    sessionKey ? openSession : null,
    'Failed to open entity session'
  )
  const save = useCallback(async () => {
    if (!activeState?.result || !entityId || !workspaceId) {
      throw new Error('Yjs session is not ready')
    }

    await saveYjsSessionSnapshot(activeState.result)
    invalidateSavedEntityQueries(entityKind, entityId, workspaceId)
  }, [activeState?.result, entityId, entityKind, workspaceId])

  return {
    doc: activeState?.result?.doc ?? null,
    save,
    isLoading: Boolean(sessionKey && !activeState?.result && !activeState?.error),
    error: activeState?.error ?? null,
  }
}

export async function saveSavedEntityField(
  entityKind: SavedEntityKind,
  entityId: string,
  workspaceId: string,
  key: string,
  value: unknown
): Promise<void> {
  const result = await bootstrapYjsProvider(
    buildSavedEntityDescriptor(entityKind, entityId, workspaceId)
  )
  try {
    setEntityField(result.doc, key, value)
    await saveYjsSessionSnapshot(result)
    invalidateSavedEntityQueries(entityKind, entityId, workspaceId)
  } finally {
    closeYjsSession(result)
  }
}

export function useEntityList(
  entityKind: ReviewEntityKind,
  workspaceId: string | null | undefined
) {
  const sessionKey = workspaceId ? `list:${entityKind}:${workspaceId}` : null
  const openSession = useCallback(
    () =>
      bootstrapYjsProvider(buildEntityListDescriptor(entityKind, workspaceId!), undefined, 'read'),
    [entityKind, workspaceId]
  )
  const activeState = useYjsSession(
    sessionKey,
    sessionKey ? openSession : null,
    'Failed to open entity list'
  )
  const doc = activeState?.result?.doc ?? null

  const subscribe = useMemo(() => {
    if (!doc) return (cb: () => void) => () => {}
    const members = doc.getMap('members')
    return (cb: () => void) => {
      members.observe(cb)
      return () => members.unobserve(cb)
    }
  }, [doc])

  const extract = useCallback(() => (doc ? getEntityListMembers(doc) : []), [doc])
  const members = useYjsSubscription<EntityListMember[]>(subscribe, extract, [])

  return {
    members,
    isLoading: Boolean(sessionKey && !activeState?.result && !activeState?.error),
    error: members.length === 0 ? (activeState?.error ?? null) : null,
  }
}

/**
 * Subscribe to a single string field on the entity Yjs doc's `fields` Y.Map.
 * Returns [value, setter] like useState.
 * When `doc` is null/undefined, returns the fallback value and a no-op setter.
 */
export function useYjsStringField(
  doc: Y.Doc | null | undefined,
  key: string,
  fallback = ''
): [string, (v: string | ((prev: string) => string)) => void] {
  const subscribe = useMemo(() => {
    if (!doc) return (cb: () => void) => () => {}
    const fields = getFieldsMap(doc)
    return (cb: () => void) => {
      // Track the Y.Text currently bound to `key` so we can observe in-place
      // text edits directly and re-bind when the key's value is replaced.
      let boundText: Y.Text | null = null

      const textHandler = () => cb()

      const bindText = (next: Y.Text | null) => {
        if (next === boundText) return
        if (boundText) boundText.unobserve(textHandler)
        boundText = next
        if (boundText) boundText.observe(textHandler)
      }

      const mapHandler = (event: Y.YMapEvent<any>) => {
        if (!event.keysChanged.has(key)) return
        // The value at `key` was set/added/deleted: re-bind a Y.Text observer
        // (or clear it for plain-string values) and notify subscribers.
        const val = fields.get(key)
        bindText(val instanceof Y.Text ? val : null)
        cb()
      }

      fields.observe(mapHandler)
      const initial = fields.get(key)
      bindText(initial instanceof Y.Text ? initial : null)

      return () => {
        fields.unobserve(mapHandler)
        if (boundText) boundText.unobserve(textHandler)
      }
    }
  }, [doc, key])

  const extract = useCallback(() => {
    if (!doc) return fallback
    const val = getFieldsMap(doc).get(key)
    if (val instanceof Y.Text) {
      return val.toString()
    }
    return typeof val === 'string' ? val : fallback
  }, [doc, key, fallback])

  const value = useYjsSubscription(subscribe, extract, fallback)

  const setValue = useCallback(
    (next: string | ((prev: string) => string)) => {
      if (!doc) return
      const currentValue = getFieldsMap(doc).get(key)
      const current =
        currentValue instanceof Y.Text
          ? currentValue.toString()
          : typeof currentValue === 'string'
            ? currentValue
            : fallback
      const nextValue = typeof next === 'function' ? next(current) : next

      if (currentValue instanceof Y.Text) {
        replaceEntityTextField(doc, key, nextValue)
        return
      }

      setEntityField(doc, key, nextValue)
    },
    [doc, fallback, key]
  )

  return [value, setValue]
}

/**
 * Subscribe to a single field of any type on the entity Yjs doc's `fields` Y.Map.
 */
export function useYjsField<T>(
  doc: Y.Doc | null | undefined,
  key: string,
  fallback: T
): [T, (v: T) => void] {
  const subscribe = useMemo(() => {
    if (!doc) return (cb: () => void) => () => {}
    const fields = getFieldsMap(doc)
    return (cb: () => void) => {
      const handler = (event: Y.YMapEvent<any>) => {
        if (!event.keysChanged.has(key)) return
        cb()
      }
      fields.observe(handler)
      return () => fields.unobserve(handler)
    }
  }, [doc, key])

  const extract = useCallback(() => {
    if (!doc) return fallback
    const val = getFieldsMap(doc).get(key)
    return (val ?? fallback) as T
  }, [doc, key, fallback])

  const value = useYjsSubscription(subscribe, extract, fallback)

  const setValue = useCallback(
    (next: T) => {
      if (!doc) return
      setEntityField(doc, key, next)
    },
    [doc, key]
  )

  return [value, setValue]
}

/**
 * Subscribe to a boolean field on the entity Yjs doc's `fields` Y.Map.
 */
export function useYjsBooleanField(
  doc: Y.Doc | null | undefined,
  key: string,
  fallback = false
): [boolean, (v: boolean) => void] {
  return useYjsField(doc, key, fallback)
}

/**
 * Subscribe to a number field on the entity Yjs doc's `fields` Y.Map.
 */
export function useYjsNumberField(
  doc: Y.Doc | null | undefined,
  key: string,
  fallback = 0
): [number, (v: number) => void] {
  return useYjsField(doc, key, fallback)
}
