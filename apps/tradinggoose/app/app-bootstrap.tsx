'use client'

import { useEffect } from 'react'
import { usePathname } from '@/i18n/navigation'
import { useGeneralSettings } from '@/hooks/queries/general-settings'
import { useSession } from '@/lib/auth-client'
import { bootstrapProviderModels } from '@/stores/providers/store'

const PUBLIC_LANDING_ROUTE_PREFIXES = [
  '/privacy',
  '/terms',
  '/careers',
  '/licenses',
  '/blog',
] as const
const PROVIDER_BOOTSTRAP_DELAY_MS = 1000

const isPublicLandingRoute = (pathname: string) =>
  pathname === '/' || PUBLIC_LANDING_ROUTE_PREFIXES.some((route) => pathname.startsWith(route))

export function AppBootstrap() {
  const pathname = usePathname() ?? '/'
  const { data: session, isPending } = useSession()

  useGeneralSettings({ enabled: !isPending && Boolean(session?.user?.id) })

  useEffect(() => {
    if (isPublicLandingRoute(pathname)) {
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
