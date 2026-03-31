'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
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

export function ProviderModelsBootstrap() {
  const pathname = usePathname() ?? '/'

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
