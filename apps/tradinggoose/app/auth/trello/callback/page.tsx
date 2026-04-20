'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function getSafeCallbackURL(rawCallbackURL: string | null) {
  const fallback = new URL('/', window.location.origin)

  if (!rawCallbackURL) {
    return fallback
  }

  try {
    const callbackURL = new URL(rawCallbackURL, window.location.origin)
    return callbackURL.origin === window.location.origin ? callbackURL : fallback
  } catch {
    return fallback
  }
}

function withStatus(callbackURL: URL, params: Record<string, string>) {
  const redirectURL = new URL(callbackURL.toString())
  for (const [key, value] of Object.entries(params)) {
    redirectURL.searchParams.set(key, value)
  }
  return `${redirectURL.pathname}${redirectURL.search}${redirectURL.hash}`
}

function TrelloCallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [message, setMessage] = useState('Connecting Trello...')

  useEffect(() => {
    const callbackURL = getSafeCallbackURL(searchParams.get('callbackURL'))
    const hash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash
    const hashParams = new URLSearchParams(hash)
    const token = hashParams.get('token')?.trim()
    const error = hashParams.get('error')?.trim()
    const state = searchParams.get('state')?.trim()

    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)

    if (error || !token || !state) {
      router.replace(
        withStatus(callbackURL, {
          error: error || 'trello_authorization_failed',
        })
      )
      return
    }

    async function saveToken() {
      const response = await fetch('/api/auth/trello/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token, state }),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error || 'Unable to connect Trello')
      }

      router.replace(
        withStatus(callbackURL, {
          trello_connected: '1',
        })
      )
    }

    saveToken().catch((saveError) => {
      setMessage(saveError instanceof Error ? saveError.message : 'Unable to connect Trello')
      router.replace(
        withStatus(callbackURL, {
          error: 'trello_connection_failed',
        })
      )
    })
  }, [router, searchParams])

  return (
    <main className='flex min-h-screen items-center justify-center p-6'>
      <p className='text-muted-foreground text-sm'>{message}</p>
    </main>
  )
}

export default function TrelloCallbackPage() {
  return (
    <Suspense
      fallback={
        <main className='flex min-h-screen items-center justify-center p-6'>
          <p className='text-muted-foreground text-sm'>Connecting Trello...</p>
        </main>
      }
    >
      <TrelloCallbackContent />
    </Suspense>
  )
}
