import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { APIError } from 'better-call'
import { auth, getSession } from '@/lib/auth'

export async function POST() {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const hdrs = await headers()
    const response = await auth.api.generateOneTimeToken({
      headers: hdrs,
    })

    if (!response) {
      return NextResponse.json({ error: 'Failed to generate token' }, { status: 500 })
    }

    return NextResponse.json({ token: response.token })
  } catch (error: unknown) {
    if (error instanceof APIError && error.code === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return NextResponse.json({ error: 'Failed to generate token' }, { status: 500 })
  }
}
