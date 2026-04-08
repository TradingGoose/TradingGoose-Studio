import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { proxyMarketApiKeysRequest } from '../shared'

export async function POST() {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const res = await proxyMarketApiKeysRequest('/api/validate-key/generate', {
      userId: session.user.id,
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Failed to generate market API key' },
        { status: res.status || 500 }
      )
    }

    const data = (await res.json().catch(() => null)) as { apiKey?: string; id?: string } | null

    if (!data?.apiKey) {
      return NextResponse.json(
        { error: 'Invalid response from TradingGoose Market' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { success: true, key: { id: data.id || 'new', apiKey: data.apiKey } },
      { status: 201 }
    )
  } catch {
    return NextResponse.json({ error: 'Failed to generate market API key' }, { status: 500 })
  }
}
