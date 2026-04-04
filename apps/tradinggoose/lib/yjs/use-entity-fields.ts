'use client'

/**
 * React hooks for binding entity editor fields to a Yjs document.
 *
 * These hooks subscribe to the Yjs `fields` Y.Map and provide
 * [value, setter] tuples that work identically to useState but
 * read/write through the collaborative Yjs document when available.
 */

import { useCallback, useMemo } from 'react'
import * as Y from 'yjs'
import { getFieldsMap, replaceEntityTextField, setEntityField } from '@/lib/yjs/entity-session'
import { useYjsSubscription } from '@/lib/yjs/use-yjs-subscription'

/**
 * Subscribe to a single string field on the entity Yjs doc's `fields` Y.Map.
 * Returns [value, setter] like useState.
 * When `doc` is null/undefined, returns the fallback value and a no-op setter.
 */
export function useYjsStringField(
  doc: Y.Doc | null | undefined,
  key: string,
  fallback: string = ''
): [string, (v: string) => void] {
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
    // Handle Y.Text instances (for Monaco-bound fields)
    if (val && typeof val === 'object' && typeof val.toString === 'function' && val.constructor?.name === 'Text') {
      return val.toString()
    }
    return typeof val === 'string' ? val : fallback
  }, [doc, key, fallback])

  const value = useYjsSubscription(subscribe, extract, fallback)

  const setValue = useCallback(
    (next: string) => {
      if (!doc) return
      const currentValue = getFieldsMap(doc).get(key)
      if (currentValue instanceof Y.Text) {
        replaceEntityTextField(doc, key, next)
        return
      }

      setEntityField(doc, key, next)
    },
    [doc, key]
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
  fallback: boolean = false
): [boolean, (v: boolean) => void] {
  return useYjsField(doc, key, fallback)
}

/**
 * Subscribe to a number field on the entity Yjs doc's `fields` Y.Map.
 */
export function useYjsNumberField(
  doc: Y.Doc | null | undefined,
  key: string,
  fallback: number = 0
): [number, (v: number) => void] {
  return useYjsField(doc, key, fallback)
}
