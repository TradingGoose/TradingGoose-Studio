'use client'

import { useLocale } from 'next-intl'
import { getAuthErrorCallbackPath } from '@/lib/auth/auth-error-copy'
import { getBaseUrl } from '@/lib/urls/utils'
import { localizeUrl, normalizeCallbackUrl } from '@/i18n/utils'

export function savePendingVerification(email: string, href: string) {
  const params = new URL(href, window.location.origin).searchParams
  params.set('email', email)
  sessionStorage.setItem('pendingVerification', params.toString())
  return { email, href }
}

export function getPendingVerification() {
  const params = new URLSearchParams(sessionStorage.getItem('pendingVerification') ?? '')
  const email = params.get('email')
  if (!email) return null
  params.delete('email')
  return { email, href: `/verify?${params}` }
}

export function clearPendingVerification() {
  sessionStorage.removeItem('pendingVerification')
}

export function useAuthRedirectUrls() {
  const locale = useLocale()

  return {
    providerCallbackPath(callbackPath: string | null | undefined) {
      return normalizeCallbackUrl(callbackPath) ?? '/workspace'
    },
    providerErrorPath(callbackPath: string | null | undefined) {
      return getAuthErrorCallbackPath(callbackPath) ?? '/error'
    },
    passwordResetUrl(callbackUrl?: string, isInviteFlow = false) {
      const url = new URL(localizeUrl(getBaseUrl(), locale, '/reset-password'))
      const destination = normalizeCallbackUrl(callbackUrl)
      if (destination) url.searchParams.set('callbackUrl', destination)
      if (isInviteFlow) url.searchParams.set('invite_flow', 'true')
      return url.toString()
    },
  }
}
