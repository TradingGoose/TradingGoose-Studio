import type { NextRequest } from 'next/server'
import { z } from 'zod'

export const nonEmptyString = z.string().trim().min(1)
export const optionalString = nonEmptyString.optional()
export const limitMax200 = z.coerce.number().int().positive().max(200).optional()
export const limitMax500 = z.coerce.number().int().positive().max(500).optional()

export const getQueryParam = (request: NextRequest, key: string) => {
  const value = request.nextUrl.searchParams.get(key)
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export const buildQueryParams = (request: NextRequest, keys: string[]) => {
  const params: Record<string, string | undefined> = {}
  for (const key of keys) {
    params[key] = getQueryParam(request, key)
  }
  return params
}

export const uniqueNonEmpty = (values: Array<string | null | undefined>) => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (!value || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

export const parseListParam = (searchParams: URLSearchParams, key: string) => {
  const rawValues = [
    ...searchParams.getAll(key),
    ...searchParams.getAll(`${key}[]`),
  ]
  if (!rawValues.length) return []

  const tokens: string[] = []
  const pushToken = (value: string) => {
    const cleaned = value.trim().replace(/^['"]|['"]$/g, '')
    if (cleaned) tokens.push(cleaned)
  }

  for (const raw of rawValues) {
    if (!raw) continue
    const trimmed = raw.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item === null || item === undefined) continue
            pushToken(String(item))
          }
          continue
        }
      } catch {
        // fall through to manual parsing
      }
      const inner = trimmed.slice(1, -1)
      if (inner) {
        inner.split(',').forEach((value) => pushToken(value))
      }
      continue
    }

    if (trimmed.includes(',')) {
      trimmed.split(',').forEach((value) => pushToken(value))
      continue
    }

    pushToken(trimmed)
  }

  return uniqueNonEmpty(tokens)
}
