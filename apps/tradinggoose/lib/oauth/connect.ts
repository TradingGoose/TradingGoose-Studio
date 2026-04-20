'use client'

import { client } from '@/lib/auth-client'

interface ConnectOAuthServiceOptions {
  providerId: string
  callbackURL: string
}

export async function startOAuthConnectFlow({
  providerId,
  callbackURL,
}: ConnectOAuthServiceOptions) {
  if (providerId === 'trello') {
    window.location.href = `/api/auth/trello/authorize?callbackURL=${encodeURIComponent(callbackURL)}`
    return
  }

  await client.oauth2.link({
    providerId,
    callbackURL,
    errorCallbackURL: callbackURL,
  })
}
