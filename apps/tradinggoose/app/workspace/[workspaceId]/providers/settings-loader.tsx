'use client'

import { useEffect, useRef } from 'react'
import { useSession } from '@/lib/auth-client'
import { useGeneralSettings } from '@/hooks/queries/general-settings'

/**
 * Loads user settings from database once per workspace session.
 * React Query handles fetching and syncing to the general settings store.
 */
export function SettingsLoader() {
  const { data: session, isPending: isSessionPending } = useSession()
  const { refetch } = useGeneralSettings()
  const hasLoadedRef = useRef(false)

  useEffect(() => {
    // Only load settings once per session for authenticated users
    if (!isSessionPending && session?.user && !hasLoadedRef.current) {
      hasLoadedRef.current = true
      // Force refetch from DB on initial workspace entry
      void refetch()
    }
  }, [isSessionPending, session?.user, refetch])

  return null
}
