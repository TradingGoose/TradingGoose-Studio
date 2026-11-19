import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

export async function POST() {
  try {
    const hdrs = await headers()
    const session = await auth.api.getSession({ headers: hdrs })

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const { token } = await auth.api.generateOneTimeToken({ headers: hdrs })
    return NextResponse.json({ token, userId: session.user.id })
  } catch {
    return NextResponse.json({ error: 'Failed to generate token' }, { status: 500 })
  }
}
