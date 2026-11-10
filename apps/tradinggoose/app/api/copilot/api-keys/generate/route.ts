import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createCopilotApiKey } from '@/lib/copilot/keys'

export async function POST() {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(
      { success: true, key: await createCopilotApiKey(session.user.id) },
      { status: 201 }
    )
  } catch {
    return NextResponse.json({ error: 'Failed to generate copilot API key' }, { status: 500 })
  }
}
