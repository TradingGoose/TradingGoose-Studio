'use client'

import { useMemo } from 'react'
import { getBaseUrl } from '@/lib/urls/utils'
import { normalizeCallbackUrl } from '@/i18n/utils'

export function useAuthRedirectUrls() {
  return useMemo(
    () => ({
      providerCallbackPath(callbackPath: string | null | undefined, fallbackPath = '/workspace') {
        const canonicalFallbackPath = normalizeCallbackUrl(fallbackPath) ?? '/workspace'
        return normalizeCallbackUrl(callbackPath) ?? canonicalFallbackPath
      },
      providerErrorPath(path: string) {
        return normalizeCallbackUrl(path) ?? '/sso'
      },
      passwordResetUrl() {
        return new URL('/reset-password', getBaseUrl()).toString()
      },
    }),
    []
  )
}
