'use client'

import { client } from '@/lib/auth-client'
import { normalizeCallbackUrl } from '@/i18n/utils'

interface ConnectOAuthServiceOptions {
  providerId: string
  callbackURL: string
}

export async function startOAuthConnectFlow({
  providerId,
  callbackURL,
}: ConnectOAuthServiceOptions) {
  const canonicalCallbackURL = normalizeCallbackUrl(callbackURL, window.location.origin)
  if (!canonicalCallbackURL) {
    throw new Error('Expected an internal OAuth callback URL')
  }

  if (providerId === 'trello') {
    window.location.href = `/api/auth/trello/authorize?callbackURL=${encodeURIComponent(canonicalCallbackURL)}`
    return
  }

  await client.oauth2.link({
    providerId,
    callbackURL: canonicalCallbackURL,
    errorCallbackURL: canonicalCallbackURL,
  })
}
