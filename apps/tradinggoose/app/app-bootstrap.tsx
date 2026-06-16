'use client'

import { useEffect } from 'react'
import { useLocale } from 'next-intl'
import { useSession } from '@/lib/auth-client'
import { useGeneralSettings } from '@/hooks/queries/general-settings'
import { replaceLocaleDocument, usePathname } from '@/i18n/navigation'
import { bootstrapProviderModels } from '@/stores/providers/store'
import { useGeneralStore } from '@/stores/settings/general/store'

const USER_LOCALE_OWNED_ROUTE_PREFIXES = ['/workspace', '/admin', '/chat'] as const
const PROVIDER_BOOTSTRAP_DELAY_MS = 1000

const isUserLocaleOwnedRoute = (pathname: string) =>
  USER_LOCALE_OWNED_ROUTE_PREFIXES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  )

export function AppBootstrap() {
  const pathname = usePathname() ?? '/'
  const locale = useLocale()
  const { data: session, isPending } = useSession()
  const userId = session?.user?.id ?? null
  const settingsQuery = useGeneralSettings({ enabled: !isPending, userId })
  const preferredLocale = settingsQuery.data?.preferredLocale

  useEffect(() => {
    useGeneralStore.setState({
      isLoading: isPending || (Boolean(userId) && settingsQuery.isPending),
    })
  }, [isPending, settingsQuery.isPending, userId])

  useEffect(() => {
    if (
      userId &&
      preferredLocale &&
      preferredLocale !== locale &&
      isUserLocaleOwnedRoute(pathname)
    ) {
      replaceLocaleDocument(preferredLocale, `${pathname}${window.location.search}`)
    }
  }, [locale, pathname, preferredLocale, userId])

  useEffect(() => {
    if (!isUserLocaleOwnedRoute(pathname)) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      bootstrapProviderModels()
    }, PROVIDER_BOOTSTRAP_DELAY_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [pathname])

  return null
}
