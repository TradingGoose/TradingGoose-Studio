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
