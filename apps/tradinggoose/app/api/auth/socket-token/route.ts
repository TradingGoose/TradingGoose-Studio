import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { auth, getSession } from '@/lib/auth'

export async function POST() {
  try {
    const hdrs = await headers()
    const session = await getSession(hdrs, { disableCookieCache: true })

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const response = await auth.api.generateOneTimeToken({
      headers: hdrs,
    })

    if (!response) {
      return NextResponse.json({ error: 'Failed to generate token' }, { status: 500 })
    }

    return NextResponse.json({ token: response.token })
  } catch (_error: unknown) {
    return NextResponse.json({ error: 'Failed to generate token' }, { status: 500 })
  }
}
