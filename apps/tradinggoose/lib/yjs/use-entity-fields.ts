'use client'

/**
 * React hooks for binding entity editor fields to a Yjs document.
 *
 * These hooks subscribe to the Yjs `fields` Y.Map and provide
 * [value, setter] tuples that work identically to useState but
 * read/write through the collaborative Yjs document when available.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import * as Y from 'yjs'
import {
  buildYjsTransportEnvelope,
  serializeYjsTransportEnvelope,
} from '@/lib/copilot/review-sessions/identity'
import { getFieldsMap, replaceEntityTextField, setEntityField } from '@/lib/yjs/entity-session'
import type { SavedEntityKind } from '@/lib/yjs/entity-state'
import { bootstrapYjsProvider, type YjsProviderBootstrapResult } from '@/lib/yjs/provider'
import { useYjsSubscription } from '@/lib/yjs/use-yjs-subscription'
import { customToolsKeys } from '@/hooks/queries/custom-tools'
import { indicatorKeys } from '@/hooks/queries/indicators'
import { skillsKeys } from '@/hooks/queries/skills'

type SavedEntityYjsSessionState = {
  key: string | null
  result: YjsProviderBootstrapResult | null
  error: string | null
}

export function useSavedEntityYjsSession(
  entityKind: SavedEntityKind,
  entityId: string | null | undefined,
  workspaceId: string | null | undefined
) {
  const queryClient = useQueryClient()
  const sessionKey = entityId && workspaceId ? `${entityKind}:${workspaceId}:${entityId}` : null
  const [state, setState] = useState<SavedEntityYjsSessionState>({
    key: null,
    result: null,
    error: null,
  })

  useEffect(() => {
    setState({ key: sessionKey, result: null, error: null })
    if (!entityId || !workspaceId || !sessionKey) return

    let active = true
    let current: YjsProviderBootstrapResult | null = null

    bootstrapYjsProvider({
      workspaceId,
      entityKind,
      entityId,
      draftSessionId: null,
      reviewSessionId: null,
      yjsSessionId: entityId,
    })
      .then((next) => {
        if (!active) {
          next.provider.disconnect()
          next.provider.destroy()
          next.doc.destroy()
          return
        }
        current = next
        setState({ key: sessionKey, result: next, error: null })
      })
      .catch((nextError) => {
        if (!active) return
        setState({
          key: sessionKey,
          result: null,
          error: nextError instanceof Error ? nextError.message : 'Failed to open entity session',
        })
      })

    return () => {
      active = false
      current?.provider.disconnect()
      current?.provider.destroy()
      current?.doc.destroy()
    }
  }, [entityId, entityKind, sessionKey, workspaceId])

  const activeState = state.key === sessionKey ? state : null
  const save = useCallback(async () => {
    if (!activeState?.result || !workspaceId) {
      throw new Error('Yjs session is not ready')
    }

    const { descriptor } = activeState.result
    const params = new URLSearchParams({
      ...serializeYjsTransportEnvelope(buildYjsTransportEnvelope(descriptor)),
      accessMode: 'write',
    })
    const update = Y.encodeStateAsUpdate(activeState.result.doc)
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

    if (entityKind === 'skill') {
      queryClient.invalidateQueries({ queryKey: skillsKeys.list(workspaceId) })
    } else if (entityKind === 'custom_tool') {
      queryClient.invalidateQueries({ queryKey: customToolsKeys.list(workspaceId) })
    } else if (entityKind === 'indicator') {
      queryClient.invalidateQueries({ queryKey: indicatorKeys.list(workspaceId) })
    }
  }, [activeState?.result, entityKind, queryClient, workspaceId])

  return {
    doc: activeState?.result?.doc ?? null,
    save,
    isLoading: Boolean(sessionKey && !activeState?.result && !activeState?.error),
    error: activeState?.error ?? null,
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
      const handler = () => cb()
      fields.observeDeep(handler)
      return () => fields.unobserveDeep(handler)
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
