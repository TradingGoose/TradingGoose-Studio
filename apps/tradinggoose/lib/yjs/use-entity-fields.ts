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
import type {
  ReviewAccessMode,
  ReviewEntityKind,
  ReviewTargetDescriptor,
} from '@/lib/copilot/review-sessions/types'
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
import { knowledgeKeys } from '@/hooks/queries/knowledge'
import { skillsKeys } from '@/hooks/queries/skills'
import { useLatestRef } from '@/hooks/use-latest-ref'

type SavedEntityYjsSessionState = {
  key: string | null
  result: YjsProviderBootstrapResult | null
  error: (Error & { retryable?: boolean }) | null
}

type SavedEntityYjsCollectionState = {
  key: string | null
  documents: ReadonlyMap<string, Y.Doc>
  error: string | null
}

type SharedYjsSessionEntry = {
  key: string
  result: YjsProviderBootstrapResult | null
  error: SavedEntityYjsSessionState['error']
  refCount: number
  initPromise: Promise<void> | null
  listeners: Set<() => void>
}

const sharedYjsSessionEntries = new Map<string, SharedYjsSessionEntry>()
const EMPTY_ENTITY_LIST_MEMBERS: EntityListMember[] = []

async function saveYjsSessionSnapshot(
  result: YjsProviderBootstrapResult,
  identityName?: string
): Promise<void> {
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
      body: JSON.stringify({
        updateBase64,
        ...(identityName ? { identity: { name: identityName } } : {}),
      }),
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

function areSavedEntityYjsSessionStatesEqual(
  left: SavedEntityYjsSessionState,
  right: SavedEntityYjsSessionState
): boolean {
  return left.key === right.key && left.result === right.result && left.error === right.error
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
  errorMessage: string
): void {
  if (entry.error?.retryable === false || entry.initPromise || entry.result) return

  entry.error = null
  emitSharedYjsSessionEntry(entry)
  entry.initPromise = openSession()
    .then((next) => {
      if (sharedYjsSessionEntries.get(entry.key) !== entry || entry.refCount === 0) {
        next.dispose()
        return
      }

      entry.result = next
      entry.error = null
      void next.lifecycle.then((event) => {
        if (sharedYjsSessionEntries.get(entry.key) !== entry || entry.result !== next) return
        if (event.type === 'resync-required') {
          entry.result = null
          next.dispose()
          emitSharedYjsSessionEntry(entry)
          scheduleSharedYjsSessionReopen(entry, openSession, errorMessage)
        } else {
          entry.result = null
          entry.error = event.error
          next.dispose()
          emitSharedYjsSessionEntry(entry)
        }
      })
    })
    .catch((nextError) => {
      if (sharedYjsSessionEntries.get(entry.key) !== entry || entry.refCount === 0) return
      const error = (nextError instanceof Error ? nextError : new Error(errorMessage)) as Error & {
        retryable?: boolean
      }
      entry.error = error
    })
    .finally(() => {
      if (sharedYjsSessionEntries.get(entry.key) !== entry) return
      entry.initPromise = null
      emitSharedYjsSessionEntry(entry)
      if (entry.error?.retryable !== false && !entry.result) {
        scheduleSharedYjsSessionReopen(entry, openSession, errorMessage)
      }
    })
}

const SESSION_REOPEN_RETRY_MS = 1_000

function scheduleSharedYjsSessionReopen(
  entry: SharedYjsSessionEntry,
  openSession: () => Promise<YjsProviderBootstrapResult>,
  errorMessage: string
): void {
  setTimeout(() => {
    if (sharedYjsSessionEntries.get(entry.key) !== entry || entry.refCount === 0) return
    initializeSharedYjsSessionEntry(entry, openSession, errorMessage)
  }, SESSION_REOPEN_RETRY_MS)
}

function releaseSharedYjsSessionEntry(entry: SharedYjsSessionEntry): void {
  entry.refCount = Math.max(0, entry.refCount - 1)
  if (entry.refCount > 0) return

  sharedYjsSessionEntries.delete(entry.key)
  if (entry.result) {
    entry.result.dispose()
    entry.result = null
  }
  entry.listeners.clear()
}

function retainSharedYjsSession(
  sessionKey: string,
  openSession: () => Promise<YjsProviderBootstrapResult>,
  errorMessage: string,
  listener: (entry: SharedYjsSessionEntry) => void
): () => void {
  const entry = getSharedYjsSessionEntry(sessionKey)
  const notify = () => listener(entry)
  entry.refCount += 1
  entry.listeners.add(notify)
  notify()
  initializeSharedYjsSessionEntry(entry, openSession, errorMessage)
  return () => {
    entry.listeners.delete(notify)
    releaseSharedYjsSessionEntry(entry)
  }
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
      return
    case 'knowledge_base':
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.list(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.detail(entityId) })
      return
    case 'mcp_server':
      window.dispatchEvent(new CustomEvent(MCP_TOOLS_CHANGED_EVENT, { detail: { workspaceId } }))
      return
    case 'watchlist':
      return
    case 'dashboard_layout':
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
      const next = { key: sessionKey, result: null, error: null }
      setState((current) => (areSavedEntityYjsSessionStatesEqual(current, next) ? current : next))
      return
    }

    return retainSharedYjsSession(sessionKey, openSession, errorMessage, (entry) => {
      const next = readSharedYjsSessionEntry(entry)
      setState((current) => (areSavedEntityYjsSessionStatesEqual(current, next) ? current : next))
    })
  }, [errorMessage, openSession, sessionKey])

  return state.key === sessionKey ? state : null
}

export function useYjsTargetSession(
  descriptor: ReviewTargetDescriptor | null,
  accessMode: ReviewAccessMode,
  errorMessage = 'Failed to open Yjs session'
) {
  const sessionKey = descriptor
    ? [
        descriptor.entityKind,
        accessMode,
        descriptor.workspaceId ?? '',
        descriptor.ownerUserId ?? '',
        descriptor.yjsSessionId,
      ].join(':')
    : null
  const openSession = useCallback(
    () => bootstrapYjsProvider(descriptor!, undefined, accessMode),
    [accessMode, descriptor]
  )
  const activeState = useYjsSession(sessionKey, sessionKey ? openSession : null, errorMessage)
  return {
    result: activeState?.result ?? null,
    doc: activeState?.result?.doc ?? null,
    isLoading: Boolean(sessionKey && !activeState?.result && !activeState?.error),
    error: activeState?.error?.message ?? null,
    isTerminalError: activeState?.error?.retryable === false,
  }
}

export function useSavedEntityYjsSession(
  entityKind: SavedEntityKind,
  entityId: string | null | undefined,
  workspaceId: string | null | undefined,
  ownerUserId: string | null | undefined,
  accessMode: ReviewAccessMode
) {
  const accessModeRef = useLatestRef(accessMode)
  const descriptor = useMemo(
    () =>
      entityId && workspaceId
        ? buildSavedEntityDescriptor(entityKind, entityId, workspaceId, { ownerUserId })
        : null,
    [entityId, entityKind, ownerUserId, workspaceId]
  )
  const targetSession = useYjsTargetSession(descriptor, accessMode, 'Failed to open entity session')
  const save = useCallback(
    async (identityName?: string) => {
      if (accessModeRef.current === 'read') {
        throw new Error('Cannot save a read-only Yjs session')
      }
      if (!targetSession.result || !entityId || !workspaceId) {
        throw new Error('Yjs session is not ready')
      }

      await saveYjsSessionSnapshot(targetSession.result, identityName)
      invalidateSavedEntityQueries(entityKind, entityId, workspaceId)
    },
    [accessModeRef, entityId, entityKind, targetSession.result, workspaceId]
  )

  return {
    doc: targetSession.doc,
    save,
    isLoading: targetSession.isLoading,
    error: targetSession.error,
    isTerminalError: targetSession.isTerminalError,
  }
}

export function useSavedEntityYjsSessionCollection(
  entityKind: SavedEntityKind,
  entityIds: readonly string[],
  workspaceId: string | null | undefined,
  ownerUserId: string | null | undefined,
  accessMode: ReviewAccessMode
) {
  const entityIdsKey = entityIds.join('\u0000')
  const collectionKey = workspaceId
    ? [entityKind, accessMode, workspaceId, ownerUserId ?? '', entityIdsKey].join(':')
    : null
  const descriptors = useMemo(
    () =>
      workspaceId
        ? entityIds.map((entityId) =>
            buildSavedEntityDescriptor(entityKind, entityId, workspaceId, { ownerUserId })
          )
        : [],
    [entityIdsKey, entityKind, ownerUserId, workspaceId]
  )
  const [state, setState] = useState<SavedEntityYjsCollectionState>({
    key: null,
    documents: new Map(),
    error: null,
  })

  useEffect(() => {
    if (!collectionKey) {
      setState({ key: null, documents: new Map(), error: null })
      return
    }

    const bindings = descriptors.map((descriptor) => {
      const sessionKey = [
        descriptor.entityKind,
        accessMode,
        descriptor.workspaceId ?? '',
        descriptor.ownerUserId ?? '',
        descriptor.yjsSessionId,
      ].join(':')
      return {
        descriptor,
        sessionKey,
        entry: null as SharedYjsSessionEntry | null,
        unobserve: null as (() => void) | null,
        release: null as (() => void) | null,
      }
    })

    const publish = () => {
      setState({
        key: collectionKey,
        documents: new Map(
          bindings.flatMap(({ descriptor, entry }) =>
            entry?.result ? [[descriptor.entityId as string, entry.result.doc] as const] : []
          )
        ),
        error: bindings.find(({ entry }) => entry?.error)?.entry?.error?.message ?? null,
      })
    }
    const bindDocument = (binding: (typeof bindings)[number]) => {
      binding.unobserve?.()
      binding.unobserve = null
      const doc = binding.entry?.result?.doc
      if (!doc) return
      const onUpdate = () => publish()
      doc.on('update', onUpdate)
      binding.unobserve = () => doc.off('update', onUpdate)
    }

    for (const binding of bindings) {
      binding.release = retainSharedYjsSession(
        binding.sessionKey,
        () => bootstrapYjsProvider(binding.descriptor, undefined, accessMode),
        `Failed to open ${entityKind} entity session`,
        (entry) => {
          binding.entry = entry
          bindDocument(binding)
          publish()
        }
      )
    }
    publish()

    return () => {
      for (const binding of bindings) {
        binding.unobserve?.()
        binding.release?.()
      }
    }
  }, [accessMode, collectionKey, descriptors, entityKind])

  const current = state.key === collectionKey ? state : null
  return {
    documents: current?.documents ?? new Map<string, Y.Doc>(),
    isLoading: Boolean(
      collectionKey && !current?.error && current?.documents.size !== entityIds.length
    ),
    error: current?.error ?? null,
  }
}

export function useEntityList(
  entityKind: ReviewEntityKind,
  workspaceId: string | null | undefined,
  ownerUserId?: string | null | undefined
) {
  const descriptor = useMemo(() => {
    if (!workspaceId) return null
    try {
      return buildEntityListDescriptor(entityKind, workspaceId, { ownerUserId })
    } catch {
      return null
    }
  }, [entityKind, ownerUserId, workspaceId])
  const sessionKey = descriptor ? descriptor.yjsSessionId : null
  const openSession = useCallback(
    () => bootstrapYjsProvider(descriptor!, undefined, 'read'),
    [descriptor]
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

  const extract = useCallback(
    () => (doc ? getEntityListMembers(doc, entityKind) : EMPTY_ENTITY_LIST_MEMBERS),
    [doc, entityKind]
  )
  const members = useYjsSubscription<EntityListMember[]>(
    subscribe,
    extract,
    EMPTY_ENTITY_LIST_MEMBERS
  )

  return {
    members,
    isLoading: Boolean(sessionKey && !activeState?.result && !activeState?.error),
    error: activeState?.error?.message ?? null,
    isTerminalError: activeState?.error?.retryable === false,
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
