import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getPublicCopilotModels } from '@/lib/copilot/settings.server'

export const dynamic = 'force-dynamic'

const headers = { 'Cache-Control': 'no-store' }

export async function GET() {
  const session = await getSession()
  if (!session?.user?.id)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  try {
    const { models, defaultModel } = await getPublicCopilotModels()
    return NextResponse.json({ models, defaultModel }, { headers })
  } catch {
    return NextResponse.json({ error: 'Copilot models are unavailable' }, { status: 503, headers })
  }
}
