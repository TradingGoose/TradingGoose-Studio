import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { listCopilotApiKeys, revokeCopilotApiKey } from '@/lib/copilot/keys'

export async function GET() {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const now = Date.now()
    const rows = await listCopilotApiKeys(session.user.id)
    return NextResponse.json({
      keys: rows
        .filter(
          (key) =>
            key.status === 'active' &&
            !key.revokedAt &&
            (!key.expiresAt || Date.parse(key.expiresAt) > now)
        )
        .map((key) => ({ id: key.id, displayKey: `•••••${key.suffix ?? ''}` })),
    })
  } catch {
    return NextResponse.json({ error: 'Failed to get copilot API keys' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = request.nextUrl.searchParams.get('id')
  if (!id?.trim()) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  try {
    if (!(await revokeCopilotApiKey(id, session.user.id)))
      return NextResponse.json({ error: 'Active Copilot key not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to revoke copilot API key' }, { status: 500 })
  }
}
