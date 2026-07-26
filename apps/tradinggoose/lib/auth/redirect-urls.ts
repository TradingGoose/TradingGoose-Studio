'use client'

import { useLocale } from 'next-intl'
import { getAuthErrorCallbackPath } from '@/lib/auth/auth-error-copy'
import { getBaseUrl } from '@/lib/urls/utils'
import { localizeUrl, normalizeCallbackUrl } from '@/i18n/utils'

export function useAuthRedirectUrls() {
  const locale = useLocale()

  return {
    providerCallbackPath(callbackPath: string | null | undefined, fallbackPath = '/workspace') {
      const canonicalFallbackPath = normalizeCallbackUrl(fallbackPath) ?? '/workspace'
      return normalizeCallbackUrl(callbackPath) ?? canonicalFallbackPath
    },
    providerErrorPath(callbackPath: string | null | undefined) {
      return getAuthErrorCallbackPath(callbackPath) ?? '/error'
    },
    passwordResetUrl() {
      return localizeUrl(getBaseUrl(), locale, '/reset-password')
    },
  }
}
