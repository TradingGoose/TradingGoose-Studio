import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { proxyCopilotRequest } from '@/app/api/copilot/proxy'

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    const res = await proxyCopilotRequest({
      endpoint: '/api/validate-key/get-api-keys',
      body: { userId },
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to get keys' }, { status: res.status || 500 })
    }

    const apiKeys = (await res.json().catch(() => null)) as { id: string; apiKey: string }[] | null

    if (!Array.isArray(apiKeys)) {
      return NextResponse.json({ error: 'Invalid response from TradingGoose Agent' }, { status: 500 })
    }

    const keys = apiKeys.map((k) => {
      const value = typeof k.apiKey === 'string' ? k.apiKey : ''
      const last6 = value.slice(-6)
      const displayKey = `•••••${last6}`
      return { id: k.id, displayKey }
    })

    return NextResponse.json({ keys }, { status: 200 })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to get keys' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const res = await proxyCopilotRequest({
      endpoint: '/api/validate-key/delete',
      body: { userId, apiKeyId: id },
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to delete key' }, { status: res.status || 500 })
    }

    const data = (await res.json().catch(() => null)) as { success?: boolean } | null
    if (!data?.success) {
      return NextResponse.json({ error: 'Invalid response from TradingGoose Agent' }, { status: 500 })
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete key' }, { status: 500 })
  }
}
