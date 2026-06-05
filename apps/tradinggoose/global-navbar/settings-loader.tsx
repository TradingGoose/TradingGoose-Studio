'use client'

import { useEffect, useRef } from 'react'
import { useGeneralSettings } from '@/hooks/queries/general-settings'
import { replaceLocaleDocument } from '@/i18n/navigation'
import { stripLocaleFromPathname } from '@/i18n/utils'

export function SettingsLoader({ userId }: { userId: string | null }) {
  const { refetch } = useGeneralSettings()
  const loadedUserRef = useRef<string | null>(null)

  useEffect(() => {
    if (!userId || loadedUserRef.current === userId) return

    loadedUserRef.current = userId
    void refetch().then(({ data }) => {
      const preferredLocale = data?.preferredLocale
      if (!preferredLocale) return

      const { locale, pathname } = stripLocaleFromPathname(window.location.pathname)
      if (preferredLocale !== locale) {
        replaceLocaleDocument(preferredLocale, `${pathname}${window.location.search}`)
      }
    })
  }, [refetch, userId])

  return null
}
