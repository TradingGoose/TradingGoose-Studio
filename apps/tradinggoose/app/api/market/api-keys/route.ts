import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { maskServiceKeys, proxyMarketApiKeysRequest } from './shared'

export async function GET() {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const res = await proxyMarketApiKeysRequest('/api/validate-key/get-api-keys', {
      userId: session.user.id,
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to get keys' }, { status: res.status || 500 })
    }

    const apiKeys = (await res.json().catch(() => null)) as { id: string; apiKey: string }[] | null

    if (!Array.isArray(apiKeys)) {
      return NextResponse.json(
        { error: 'Invalid response from TradingGoose Market' },
        { status: 500 }
      )
    }

    return NextResponse.json({ keys: maskServiceKeys(apiKeys) }, { status: 200 })
  } catch {
    return NextResponse.json({ error: 'Failed to get keys' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const id = new URL(request.url).searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const res = await proxyMarketApiKeysRequest('/api/validate-key/delete', {
      userId: session.user.id,
      apiKeyId: id,
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to delete key' }, { status: res.status || 500 })
    }

    const data = (await res.json().catch(() => null)) as { success?: boolean } | null
    if (!data?.success) {
      return NextResponse.json(
        { error: 'Invalid response from TradingGoose Market' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch {
    return NextResponse.json({ error: 'Failed to delete key' }, { status: 500 })
  }
}
