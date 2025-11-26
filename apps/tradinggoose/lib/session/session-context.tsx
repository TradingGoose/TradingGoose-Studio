'use client'

import type React from 'react'
import { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import posthog from 'posthog-js'
import { handleAuthError, isAuthErrorStatus } from '@/lib/auth/auth-error-handler'
import { client } from '@/lib/auth-client'

export type AppSession = {
  user: {
    id: string
    email: string
    emailVerified?: boolean
    name?: string | null
    image?: string | null
    createdAt?: Date
    updatedAt?: Date
  } | null
  session?: {
    id?: string
    userId?: string
    activeOrganizationId?: string
  }
} | null

export type SessionHookResult = {
  data: AppSession
  isPending: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export const SessionContext = createContext<SessionHookResult | null>(null)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<AppSession>(null)
  const [isPending, setIsPending] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const loadSession = useCallback(async () => {
    try {
      setIsPending(true)
      setError(null)
      const res = await client.getSession()

      const responseError = (res as any)?.error
      if (isAuthErrorStatus(responseError?.status)) {
        await handleAuthError('unauthorized-session')
        setData(null)
        return
      }

      setData(res?.data ?? null)

      if (responseError) {
        setError(new Error(responseError?.message || 'Failed to fetch session'))
      }
    } catch (e) {
      const status = (e as any)?.status ?? (e as any)?.response?.status ?? (e as any)?.error?.status
      if (isAuthErrorStatus(status)) {
        await handleAuthError('unauthorized-session-error')
        setData(null)
        return
      }
      setError(e instanceof Error ? e : new Error('Failed to fetch session'))
    } finally {
      setIsPending(false)
    }
  }, [])

  useEffect(() => {
    loadSession()
  }, [loadSession])

  useEffect(() => {
    if (isPending || typeof posthog.identify !== 'function') {
      return
    }

    try {
      if (data?.user) {
        posthog.identify(data.user.id, {
          email: data.user.email,
          name: data.user.name,
          email_verified: data.user.emailVerified,
          created_at: data.user.createdAt,
        })
      } else {
        posthog.reset()
      }
    } catch {}
  }, [data, isPending])

  const value = useMemo<SessionHookResult>(
    () => ({ data, isPending, error, refetch: loadSession }),
    [data, isPending, error, loadSession]
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
