'use client'

import { useLocale } from 'next-intl'
import { getBaseUrl } from '@/lib/urls/utils'
import { localizeUrl, normalizeCallbackUrl } from '@/i18n/utils'

export function useAuthRedirectUrls() {
  const locale = useLocale()

  return {
    providerCallbackPath(callbackPath: string | null | undefined, fallbackPath = '/workspace') {
      const canonicalFallbackPath = normalizeCallbackUrl(fallbackPath) ?? '/workspace'
      return normalizeCallbackUrl(callbackPath) ?? canonicalFallbackPath
    },
    providerErrorPath(path: string) {
      return normalizeCallbackUrl(path) ?? '/sso'
    },
    passwordResetUrl() {
      return localizeUrl(getBaseUrl(), locale, '/reset-password')
    },
  }
}
